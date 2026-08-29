'use strict';

/**
 * SSRF Protection Utility — Issue #1119 / #1529
 *
 * Validates outbound URLs before any HTTP request to prevent Server-Side
 * Request Forgery attacks. Blocks private/loopback/link-local/metadata ranges,
 * enforces HTTPS, and rejects dangerous schemes.
 */

const dns = require('dns').promises;
const { URL } = require('url');
const net = require('net');
const log = require('./log');

class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.code = 'SSRF_BLOCKED';
    this.errorCode = 'SSRF_BLOCKED';
    this.status = 400;
    this.statusCode = 400;
  }
}

/** Blocked IPv4 CIDR ranges as [network_int, mask_int] pairs */
const BLOCKED_IPV4_CIDRS = [
  ['0.0.0.0',    8],   // This-network
  ['10.0.0.0',   8],   // Private class A
  ['100.64.0.0', 10],  // Shared address (RFC 6598)
  ['127.0.0.0',  8],   // Loopback
  ['169.254.0.0',16],  // Link-local / AWS metadata
  ['172.16.0.0', 12],  // Private class B
  ['192.0.0.0',  24],  // IETF protocol assignments
  ['192.168.0.0',16],  // Private class C
  ['198.18.0.0', 15],  // Benchmarking
  ['198.51.100.0',24], // TEST-NET-2
  ['203.0.113.0',24],  // TEST-NET-3
  ['224.0.0.0',  4],   // Multicast
  ['240.0.0.0',  4],   // Reserved
  ['255.255.255.255', 32], // Broadcast
].map(([ip, bits]) => [ipv4ToInt(ip), ~((1 << (32 - bits)) - 1) >>> 0]);

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc * 256 + parseInt(oct, 10)) >>> 0, 0);
}

function isBlockedIPv4(ip) {
  const ipInt = ipv4ToInt(ip);
  // The bitwise AND yields a signed 32-bit value for networks with the high bit
  // set (e.g. 192.168.0.0/16, 172.16.0.0/12); coerce back to unsigned so the
  // comparison with the unsigned network address is correct.
  return BLOCKED_IPV4_CIDRS.some(([net, mask]) => ((ipInt & mask) >>> 0) === net);
}

function isBlockedIPv6(ip) {
  // Normalize and check common blocked IPv6 ranges
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === '::1' ||                        // loopback
    normalized === '::' ||                         // unspecified
    normalized.startsWith('fc') ||                 // ULA fc00::/7
    normalized.startsWith('fd') ||                 // ULA fd00::/8
    normalized.startsWith('fe8') ||                // link-local fe80::/10
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||                 // multicast ff00::/8
    normalized.startsWith('2001:db8:') ||          // documentation
    normalized.startsWith('2001:10:') ||           // ORCHID
    normalized.startsWith('64:ff9b:')              // IPv4/IPv6 translation
  ) {
    return true;
  }

  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.slice(7);
    if (net.isIPv4(ipv4Part)) {
      return isBlockedIPv4(ipv4Part);
    }
  }

  return false;
}

/**
 * Log SSRF block event
 */
function logSsrfBlocked(target, reason) {
  log.warn('SECURITY', 'SSRF blocked outbound request', {
    target,
    reason,
    timestamp: new Date().toISOString(),
  });

  try {
    const AuditLogService = require('../services/AuditLogService');
    AuditLogService.log({
      category: AuditLogService.CATEGORY.ABUSE_DETECTION,
      action: 'SSRF_BLOCKED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'FAILURE',
      details: { target, reason },
      reason,
    }).catch(() => {});
  } catch (_) {
    // AuditLogService may not be available in all contexts
  }
}

/**
 * Resolve hostname to IP addresses and check each against blocked ranges.
 * @param {string} hostname
 * @returns {Promise<void>} Resolves if safe, rejects if blocked.
 */
async function assertSafeHost(hostname) {
  // If already a literal IP, check directly without DNS
  if (net.isIPv4(hostname)) {
    if (isBlockedIPv4(hostname)) {
      const msg = `SSRF: blocked IPv4 address: ${hostname}`;
      logSsrfBlocked(hostname, msg);
      throw new SsrfError(msg);
    }
    return;
  }
  if (net.isIPv6(hostname)) {
    if (isBlockedIPv6(hostname)) {
      const msg = `SSRF: blocked IPv6 address: ${hostname}`;
      logSsrfBlocked(hostname, msg);
      throw new SsrfError(msg);
    }
    return;
  }

  // DNS resolution — check all returned addresses
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    const msg = `SSRF: DNS resolution failed for ${hostname}: ${err.message}`;
    logSsrfBlocked(hostname, msg);
    throw new SsrfError(msg);
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isBlockedIPv4(address)) {
      const msg = `SSRF: hostname ${hostname} resolves to blocked IPv4 ${address}`;
      logSsrfBlocked(hostname, msg);
      throw new SsrfError(msg);
    }
    if (family === 6 && isBlockedIPv6(address)) {
      const msg = `SSRF: hostname ${hostname} resolves to blocked IPv6 ${address}`;
      logSsrfBlocked(hostname, msg);
      throw new SsrfError(msg);
    }
  }
}

/**
 * Assert that a URL is safe for outbound requests.
 *
 * Enforces:
 * - HTTPS scheme only (no http, file, ftp, etc.)
 * - Host not in private/loopback/link-local/metadata ranges
 * - DNS rebinding protection (resolves and validates all IPs)
 *
 * @param {string} urlStr - The target URL string
 * @returns {Promise<URL>} The parsed URL if safe
 * @throws {SsrfError} If the URL is unsafe
 */
async function assertSafeOutboundUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    const msg = `SSRF: invalid URL: ${urlStr}`;
    logSsrfBlocked(urlStr, msg);
    throw new SsrfError(msg);
  }

  if (parsed.protocol !== 'https:') {
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isDev = process.env.NODE_ENV !== 'production';
    if (!(isLocalhost && isDev)) {
      const msg = `SSRF: only HTTPS is allowed, got ${parsed.protocol} in ${urlStr}`;
      logSsrfBlocked(urlStr, msg);
      throw new SsrfError(msg);
    }
  }

  await assertSafeHost(parsed.hostname);

  return parsed;
}

module.exports = {
  assertSafeOutboundUrl,
  assertSafeHost,
  isBlockedIPv4,
  isBlockedIPv6,
  SsrfError,
};
