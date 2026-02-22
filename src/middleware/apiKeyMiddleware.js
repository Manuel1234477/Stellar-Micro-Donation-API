/**
 * API Key Authentication Middleware
 * 
 * Validates incoming requests by checking for a valid API key in the request headers.
 * This provides a simple authentication layer for API endpoints.
 * 
 * Configuration:
 * - API keys are loaded from the API_KEYS environment variable
 * - Multiple keys can be provided as a comma-separated list
 * - Example: API_KEYS="key1,key2,key3"
 * 
 * Usage:
 * - Client must include 'x-api-key' header with a valid API key
 * - Example: headers: { 'x-api-key': 'your-api-key-here' }
 * 
 * Response codes:
 * - 401 UNAUTHORIZED: Missing or invalid API key
 * - Passes control to next middleware if validation succeeds
 */

// Parse and validate API keys from environment variables
// Split comma-separated keys, trim whitespace, and remove empty entries
const validKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

/**
 * Middleware function to require API key authentication
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void} Responds with 401 if unauthorized, or calls next() to continue
 */
function requireApiKey(req, res, next) {
  // Extract API key from request headers
  const key = req.headers['x-api-key'];

  // Validate: Check if keys are configured, key is provided, and key matches
  if (!validKeys.length || !key || !validKeys.includes(key)) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Valid API key required. Provide it via the x-api-key header.'
      }
    });
  }

  // Key is valid - pass control to next middleware
  next();
}

module.exports = requireApiKey;
