/**
 * SignedUrlService - Single implementation of signed export download URLs
 *
 * RESPONSIBILITY: HMAC-SHA256 signing and verification for export downloads (#1950)
 * OWNER: Security Team
 * DEPENDENCIES: crypto, signingSecrets
 *
 * Every export service (CSV/JSON donations, wallets, audit logs) signs its
 * download links through this module, so there is one payload format, one
 * comparison routine and one secret source.
 *
 * A signature covers: purpose (resource), resource id, principal id (the
 * owner the URL was issued to) and expiry. A URL therefore cannot be replayed
 * for another export, by another principal, or after it expires.
 *
 * Rotation: EXPORT_SIGNING_SECRET is used for new signatures. Secrets listed
 * in EXPORT_SIGNING_SECRET_PREVIOUS (comma-separated) are still accepted for
 * verification until they are removed.
 */

const crypto = require('crypto');
const { getSigningSecret } = require('../utils/signingSecrets');

const PAYLOAD_VERSION = 'v1';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const SECRET_ENV_VARS = ['EXPORT_SIGNING_SECRET', 'ENCRYPTION_SECRET'];

/**
 * Secrets accepted for verification, current first.
 * @returns {string[]}
 */
function getVerificationSecrets() {
  const current = getSigningSecret('EXPORT_SIGNING_SECRET', SECRET_ENV_VARS);
  const previous = (process.env.EXPORT_SIGNING_SECRET_PREVIOUS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [current, ...previous];
}

/**
 * Canonical payload that is signed.
 * @returns {string}
 */
function buildPayload({ resource, resourceId, principalId, expires }) {
  return [PAYLOAD_VERSION, resource, String(resourceId), String(principalId), String(expires)].join('|');
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

class SignedUrlService {
  /**
   * Sign a download for one resource and principal.
   *
   * @param {object} params
   * @param {string} params.resource - Purpose, e.g. 'export', 'donation-export', 'audit-export'
   * @param {string|number} params.resourceId - Export/job identifier
   * @param {string|number} params.principalId - Owner the link is issued to (required)
   * @param {number} [params.ttlMs] - Lifetime in milliseconds
   * @param {number} [params.now] - Clock override (tests)
   * @returns {{ expires: string, signature: string, expiresAt: string }}
   */
  static sign({ resource, resourceId, principalId, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
    if (!resource || resourceId === undefined || resourceId === null || !principalId) {
      throw new Error('SignedUrlService.sign requires resource, resourceId and principalId');
    }
    const expiresMs = now + ttlMs;
    const expires = String(expiresMs);
    const secret = getVerificationSecrets()[0];
    const signature = hmac(secret, buildPayload({ resource, resourceId, principalId, expires }));
    return { expires, signature, expiresAt: new Date(expiresMs).toISOString() };
  }

  /**
   * Verify a signed download request.
   *
   * @param {object} params
   * @param {string} params.resource
   * @param {string|number} params.resourceId
   * @param {string|number} params.principalId - Principal making the request
   * @param {string} params.expires - Expiry in epoch milliseconds, as issued
   * @param {string} params.signature - Hex signature, as issued
   * @param {number} [params.now] - Clock override (tests)
   * @returns {boolean}
   */
  static verify({ resource, resourceId, principalId, expires, signature, now = Date.now() }) {
    if (!resource || resourceId === undefined || resourceId === null || !principalId) return false;
    if (typeof expires !== 'string' && typeof expires !== 'number') return false;
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;

    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs <= now) return false;

    const provided = Buffer.from(signature.toLowerCase(), 'hex');
    const payload = buildPayload({ resource, resourceId, principalId, expires: String(expires) });

    let matched = false;
    for (const secret of getVerificationSecrets()) {
      const expected = Buffer.from(hmac(secret, payload), 'hex');
      if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) {
        matched = true;
      }
    }
    return matched;
  }

  /**
   * Build the query string for a signed link.
   * @param {{ expires: string, signature: string }} signed
   * @returns {string} e.g. "expires=1700000000000&signature=abc..."
   */
  static toQueryString({ expires, signature }) {
    return `expires=${encodeURIComponent(expires)}&signature=${signature}`;
  }
}

SignedUrlService.DEFAULT_TTL_MS = DEFAULT_TTL_MS;

module.exports = SignedUrlService;
