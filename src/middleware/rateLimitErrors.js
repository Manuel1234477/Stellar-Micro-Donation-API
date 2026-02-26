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
  const isProduction = process.env.NODE_ENV === 'production';
  
  const errorResponse = {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded. Please try again later'
    }
  };

  // Only expose rate limit details in development to prevent timing attacks
  if (!isProduction) {
    const resetAtString = resetAt instanceof Date ? resetAt.toISOString() : resetAt;
    errorResponse.error.limit = limit;
    errorResponse.error.resetAt = resetAtString;
  }

  return errorResponse;
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
