/**
 * Error response builders for rate limiting
 */

/**
 * Build error response for rate limit exceeded
 * @param {number} limit - The rate limit value
 * @param {Date|string} resetAt - When the rate limit resets (Date object or ISO string)
 * @returns {Object} Error response object
 */
function buildRateLimitError(limit, resetAt) {
  // Convert Date to ISO string if needed
  const resetAtString = resetAt instanceof Date ? resetAt.toISOString() : resetAt;

  return {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded. Please try again later',
      limit: limit,
      resetAt: resetAtString
    }
  };
}

/**
 * Build error response for missing API key
 * @returns {Object} Error response object
 */
function buildMissingApiKeyError() {
  return {
    success: false,
    error: {
      code: 'MISSING_API_KEY',
      message: 'API key is required. Please provide X-API-Key header'
    }
  };
}

module.exports = {
  buildRateLimitError,
  buildMissingApiKeyError
};
