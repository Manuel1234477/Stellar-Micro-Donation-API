/**
 * Schema Version Middleware
 * 
 * RESPONSIBILITY: Parse X-Schema-Version header and attach schema version info to request
 * OWNER: Backend Team
 * 
 * This middleware extracts the X-Schema-Version header from incoming requests and stores it
 * on the request object for use by schema validation middleware. If no header is provided,
 * defaults to version 1.
 */

/**
 * Schema version middleware factory
 * Parses X-Schema-Version header (defaults to 1 if not provided)
 * @returns {Function} Express middleware
 */
function apiVersionMiddleware(req, res, next) {
  // Parse X-Schema-Version header, default to '1'
  const schemaVersion = req.get('X-Schema-Version') || '1';
  
  // Validate that it's a positive integer
  const parsedVersion = parseInt(schemaVersion, 10);
  if (isNaN(parsedVersion) || parsedVersion < 1) {
    // Invalid version format, but let schemaValidation middleware handle the error
    // Store as-is for validation middleware to reject
    req.schemaVersion = schemaVersion;
  } else {
    req.schemaVersion = String(parsedVersion);
  }
  
  next();
}

module.exports = apiVersionMiddleware;
