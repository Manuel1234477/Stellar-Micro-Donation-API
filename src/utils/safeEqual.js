/**
 * Safe Constant-Time Comparison Utility
 *
 * Provides constant-time comparison for secrets to prevent timing side-channel attacks.
 * Compares HMAC-SHA256 digests of both inputs to ensure consistent length.
 */

const crypto = require('crypto');

/**
 * Constant-time comparison of two values using HMAC-SHA256 digests.
 * Prevents timing side-channels by always comparing fixed-length digests.
 *
 * @param {string|Buffer} incoming - The incoming value (API key, secret, signature, etc.)
 * @param {string|Buffer} stored - The stored/expected value
 * @returns {boolean} True if values match, false otherwise
 *
 * @example
 * const apiKey = req.headers['x-api-key'];
 * const storedKey = await getStoredApiKey();
 * if (!safeEqual(apiKey, storedKey)) {
 *   throw new UnauthorizedError();
 * }
 */
function safeEqual(incoming, stored) {
  // Convert to strings if needed
  const a = typeof incoming === 'string' ? incoming : String(incoming || '');
  const b = typeof stored === 'string' ? stored : String(stored || '');

  // Compute HMAC-SHA256 digests of fixed length
  const incomingDigest = crypto.createHmac('sha256', 'constant-time-compare')
    .update(a)
    .digest();

  const storedDigest = crypto.createHmac('sha256', 'constant-time-compare')
    .update(b)
    .digest();

  // Use Node's built-in constant-time comparison
  try {
    return crypto.timingSafeEqual(incomingDigest, storedDigest);
  } catch {
    // timingSafeEqual throws if lengths differ; treat as not equal
    return false;
  }
}

module.exports = { safeEqual };
