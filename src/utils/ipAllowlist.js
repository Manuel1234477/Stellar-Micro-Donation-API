/**
 * IP Allowlist Utility
 *
 * Checks whether a client IP address is permitted by an allowlist of IPs and CIDR ranges.
 * Supports IPv4, IPv6, and CIDR notation (e.g. 192.168.1.0/24, 2001:db8::/32).
 *
 * Security note: `clientIp` must be sourced from a trusted location (e.g. req.ip with
 * Express `trust proxy` configured correctly). Do NOT use X-Forwarded-For directly
 * without proxy trust configuration, as it can be spoofed.
 */

const { isIPv4, isIPv6 } = require('net');

/**
 * Converts an IPv4 address string to a 32-bit unsigned integer.
 * @param {string} ip - IPv4 address (e.g. "192.168.1.1")
 * @returns {number}
 */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

/**
 * Converts an IPv6 address string to a BigInt for numeric comparison.
 * Handles compressed notation (::) by expanding it first.
 * @param {string} ip - Full or compressed IPv6 address
 * @returns {BigInt}
 */
function ipv6ToBigInt(ip) {
  // Expand :: shorthand
  const halves = ip.split('::');
  let left = halves[0] ? halves[0].split(':') : [];
  let right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  const middle = Array(missing).fill('0');
  const groups = [...left, ...middle, ...right];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g || '0', 16)), 0n);
}

/**
 * Checks whether `clientIp` falls within the given CIDR range.
 * @param {string} clientIp
 * @param {string} cidr - e.g. "10.0.0.0/8" or "2001:db8::/32"
 * @returns {boolean}
 */
function isInCidr(clientIp, cidr) {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  if (isIPv4(network) && isIPv4(clientIp)) {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipv4ToInt(clientIp) & mask) === (ipv4ToInt(network) & mask);
  }

  if (isIPv6(network) && isIPv6(clientIp)) {
    const mask = prefix === 0 ? 0n : (~0n << BigInt(128 - prefix)) & ((1n << 128n) - 1n);
    return (ipv6ToBigInt(clientIp) & mask) === (ipv6ToBigInt(network) & mask);
  }

  return false;
}

/**
 * Determines whether `clientIp` is permitted by the given allowlist.
 *
 * Each entry in `allowedIps` may be:
 *   - An exact IPv4 address: "1.2.3.4"
 *   - An exact IPv6 address: "2001:db8::1"
 *   - A CIDR range:          "10.0.0.0/8" or "2001:db8::/32"
 *
 * Returns `true` (allow all) when `allowedIps` is null, undefined, or empty.
 *
 * @param {string} clientIp - The client's IP address
 * @param {string[]|null|undefined} allowedIps - The allowlist configured on the API key
 * @returns {boolean}
 */
function isIpAllowed(clientIp, allowedIps) {
  if (!allowedIps || allowedIps.length === 0) return true;
  if (!clientIp) return false;

  for (const entry of allowedIps) {
    if (entry.includes('/')) {
      if (isInCidr(clientIp, entry)) return true;
    } else if (entry === clientIp) {
      return true;
    }
  }

  return false;
}

module.exports = { isIpAllowed, isInCidr };
