/**
 * Request Signing Utility
 *
 * Implements HMAC-SHA256 request signing to prevent replay attacks and
 * man-in-the-middle interception. Signing scheme:
 *   HMAC-SHA256(secret, METHOD + "\n" + path + "\n" + timestamp + "\n" + bodyHash)
 *
 * Headers used:
 *   X-Timestamp  - Unix timestamp in seconds (string)
 *   X-Signature  - Hex-encoded HMAC-SHA256 signature
 */

const crypto = require('crypto');

/** Maximum age of a signed request before it is rejected (5 minutes). */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Compute the SHA-256 hash of a string body.
 *
 * @param {string} body - Raw request body string (use '' for no body).
 * @returns {string} Lowercase hex digest.
 */
function hashBody(body) {
  return crypto.createHash('sha256').update(body || '').digest('hex');
}

/**
 * Build the canonical string that is signed.
 *
 * @param {string} method    - HTTP method in uppercase (e.g. 'POST').
 * @param {string} path      - Request path including query string (e.g. '/donations?limit=5').
 * @param {string} timestamp - Unix timestamp in seconds as a string.
 * @param {string} bodyHash  - Hex SHA-256 hash of the raw body.
 * @returns {string} Canonical string.
 */
function buildCanonicalString(method, path, timestamp, bodyHash) {
  return [method.toUpperCase(), path, timestamp, bodyHash].join('\n');
}

/**
 * Sign a request payload with HMAC-SHA256.
 *
 * @param {object} params
 * @param {string} params.secret    - The API key secret used as the HMAC key.
 * @param {string} params.method    - HTTP method (e.g. 'POST').
 * @param {string} params.path      - Request path + query string.
 * @param {string} params.timestamp - Unix timestamp in seconds as a string.
 * @param {string} [params.body]    - Raw request body string (default: '').
 * @returns {{ signature: string, timestamp: string }} Signature and timestamp to attach as headers.
 */
function sign({ secret, method, path, timestamp, body = '' }) {
  const bodyHash = hashBody(body);
  const canonical = buildCanonicalString(method, path, timestamp, bodyHash);
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  return { signature, timestamp };
}

/**
 * Verify a signed request.
 *
 * Uses a constant-time comparison to prevent timing attacks.
 *
 * @param {object} params
 * @param {string} params.secret             - The API key secret.
 * @param {string} params.method             - HTTP method.
 * @param {string} params.path               - Request path + query string.
 * @param {string} params.timestamp          - Timestamp from X-Timestamp header.
 * @param {string} params.signature          - Signature from X-Signature header.
 * @param {string} [params.body]             - Raw request body string (default: '').
 * @param {number} [params.maxAgeMs]         - Override max age in ms (default: 5 min).
 * @param {number} [params.nowMs]            - Override current time in ms (for testing).
 * @returns {{ valid: boolean, reason?: string }}
 */
function verify({ secret, method, path, timestamp, signature, body = '', maxAgeMs = SIGNATURE_MAX_AGE_MS, nowMs }) {
  if (!timestamp || !signature) {
    return { valid: false, reason: 'Missing X-Timestamp or X-Signature header' };
  }

  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs)) {
    return { valid: false, reason: 'Invalid X-Timestamp value' };
  }

  const now = nowMs !== undefined ? nowMs : Date.now();
  const age = now - tsMs;

  if (age > maxAgeMs || age < -30000) {
    // also reject timestamps more than 30s in the future (clock skew guard)
    return { valid: false, reason: 'Request timestamp expired or too far in the future' };
  }

  const bodyHash = hashBody(body);
  const canonical = buildCanonicalString(method, path, timestamp, bodyHash);
  const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

  // Constant-time comparison
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature.length === expected.length ? signature : expected, 'hex');

  let mismatch = 0;
  for (let i = 0; i < expectedBuf.length; i++) {
    mismatch |= expectedBuf[i] ^ (actualBuf[i] || 0);
  }
  // Also check length equality separately to avoid length oracle
  if (signature.length !== expected.length) mismatch = 1;

  if (mismatch !== 0) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

module.exports = { sign, verify, hashBody, buildCanonicalString, SIGNATURE_MAX_AGE_MS };
