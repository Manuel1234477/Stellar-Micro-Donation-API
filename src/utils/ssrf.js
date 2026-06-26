'use strict';

/**
 * SSRF Protection Utility — Issue #1119
 *
 * Validates outbound URLs before any HTTP request to prevent Server-Side
 * Request Forgery attacks. Blocks private/loopback/link-local/metadata ranges,
 * enforces HTTPS, and rejects dangerous schemes.
 */

const dns = require('dns').promises;
const { URL } = require('url');
const net = require('net');

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
  return BLOCKED_IPV4_CIDRS.some(([net, mask]) => (ipInt & mask) === net);
}

function isBlockedIPv6(ip) {
  // Normalize and check common blocked IPv6 ranges
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === '::1' ||                        // loopback
    normalized.startsWith('fc') ||                 // ULA fc00::/7
    normalized.startsWith('fd') ||                 // ULA fd00::/8
    normalized.startsWith('fe80') ||               // link-local
    normalized.startsWith('::ffff:') ||            // IPv4-mapped — checked separately
    normalized === '::' ||                         // unspecified
    normalized.startsWith('ff')                    // multicast
  );
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
      throw new Error(`SSRF: blocked IPv4 address: ${hostname}`);
    }
    return;
  }
  if (net.isIPv6(hostname)) {
    if (isBlockedIPv6(hostname)) {
      throw new Error(`SSRF: blocked IPv6 address: ${hostname}`);
    }
    return;
  }

  // DNS resolution — check all returned addresses
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`SSRF: DNS resolution failed for ${hostname}: ${err.message}`);
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isBlockedIPv4(address)) {
      throw new Error(`SSRF: hostname ${hostname} resolves to blocked IPv4 ${address}`);
    }
    if (family === 6 && isBlockedIPv6(address)) {
      throw new Error(`SSRF: hostname ${hostname} resolves to blocked IPv6 ${address}`);
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
 * @throws {Error} If the URL is unsafe
 */
async function assertSafeOutboundUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`SSRF: invalid URL: ${urlStr}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`SSRF: only HTTPS is allowed, got ${parsed.protocol} in ${urlStr}`);
  }

  await assertSafeHost(parsed.hostname);

  return parsed;
}

module.exports = { assertSafeOutboundUrl, assertSafeHost, isBlockedIPv4, isBlockedIPv6 };
