/**
 * Trust-proxy configuration helpers (#1954).
 *
 * Express derives req.ip from X-Forwarded-For only for hops it trusts. The
 * default, 'loopback', trusts only 127.0.0.1/::1. Behind an ingress or load
 * balancer that means req.ip is the proxy address for every client, so per-IP
 * rate limits, abuse detection and brute-force lockouts apply to all users at
 * once. Setting `trust proxy` to `true` is not the fix: it lets clients spoof
 * X-Forwarded-For. The operator must list the proxy addresses in TRUSTED_PROXIES.
 */

'use strict';

const DEFAULT_TRUST_PROXY = 'loopback';

/**
 * Convert the TRUSTED_PROXIES value into the argument for Express `trust proxy`.
 *
 * @param {string|undefined|null} rawValue - Raw TRUSTED_PROXIES value.
 * @returns {string|string[]} 'loopback' when unset, otherwise the trimmed list of addresses/CIDRs.
 */
function resolveTrustProxy(rawValue) {
  if (!rawValue) return DEFAULT_TRUST_PROXY;
  return rawValue.split(',').map(ip => ip.trim());
}

/**
 * Warning to log at startup when production runs without TRUSTED_PROXIES.
 *
 * @param {{ NODE_ENV?: string, TRUSTED_PROXIES?: string|null }} values
 * @returns {string|null} Warning text, or null when no warning is needed.
 */
function trustProxyStartupWarning(values) {
  if (values.NODE_ENV !== 'production') return null;
  if (values.TRUSTED_PROXIES && values.TRUSTED_PROXIES.trim()) return null;
  return 'TRUSTED_PROXIES is not set; trust proxy defaults to loopback. ' +
    'If this API runs behind a load balancer or ingress, every client will share the proxy IP ' +
    'for rate limiting, abuse detection and brute-force protection. ' +
    'Set TRUSTED_PROXIES to the proxy addresses or CIDRs (see docs/PRODUCTION_DEPLOYMENT.md).';
}

module.exports = { DEFAULT_TRUST_PROXY, resolveTrustProxy, trustProxyStartupWarning };
