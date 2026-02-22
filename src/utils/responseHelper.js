/**
 * Response Helper Utility
 * Standardizes API success and error responses across all routes
 * 
 * Ensures consistent response structure:
 * - Success: { success: true, data: {...}, timestamp: ISO8601 }
 * - Error: { success: false, error: { code, message }, timestamp: ISO8601 }
 */

/**
 * Send a standardized success response
 * 
 * @param {Object} res - Express response object
 * @param {Object|Array} data - Response data payload
 * @param {number} [statusCode=200] - HTTP status code
 * @param {string} [message] - Optional success message
 * @returns {Object} Express response
 * 
 * @example
 * sendSuccess(res, { id: 123, name: 'John' });
 * // Returns: { success: true, data: { id: 123, name: 'John' }, timestamp: '2024-...' }
 * 
 * @example
 * sendSuccess(res, users, 200, 'Users retrieved successfully');
 * // Returns: { success: true, data: [...], message: '...', timestamp: '2024-...' }
 */
function sendSuccess(res, data, statusCode = 200, message = null) {
  const response = {
    success: true,
    data,
    timestamp: new Date().toISOString()
  };

  // Include optional message if provided
  if (message) {
    response.message = message;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send a standardized error response
 * 
 * @param {Object} res - Express response object
 * @param {string} code - Error code (e.g., 'INVALID_REQUEST', 'NOT_FOUND')
 * @param {string} message - Human-readable error message
 * @param {number} [statusCode=400] - HTTP status code
 * @param {Object} [details] - Optional additional error details
 * @returns {Object} Express response
 * 
 * @example
 * sendError(res, 'NOT_FOUND', 'User not found', 404);
 * // Returns: { success: false, error: { code: 'NOT_FOUND', message: '...' }, timestamp: '...' }
 * 
 * @example
 * sendError(res, 'VALIDATION_ERROR', 'Invalid input', 400, { field: 'email' });
 * // Returns: { success: false, error: { code: '...', message: '...', details: {...} }, timestamp: '...' }
 */
function sendError(res, code, message, statusCode = 400, details = null) {
  const response = {
    success: false,
    error: {
      code,
      message
    },
    timestamp: new Date().toISOString()
  };

  // Include optional details if provided
  if (details) {
    response.error.details = details;
  }

  return res.status(statusCode).json(response);
}

/**
 * Send a paginated success response
 * 
 * @param {Object} res - Express response object
 * @param {Array} data - Array of items for current page
 * @param {Object} pagination - Pagination metadata
 * @param {number} pagination.page - Current page number
 * @param {number} pagination.limit - Items per page
 * @param {number} pagination.total - Total number of items
 * @param {number} [statusCode=200] - HTTP status code
 * @returns {Object} Express response
 * 
 * @example
 * sendPaginatedSuccess(res, donations, { page: 1, limit: 10, total: 100 });
 * // Returns: { 
 * //   success: true, 
 * //   data: [...], 
 * //   pagination: { page: 1, limit: 10, total: 100, totalPages: 10 },
 * //   timestamp: '...'
 * // }
 */
function sendPaginatedSuccess(res, data, pagination, statusCode = 200) {
  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);

  return res.status(statusCode).json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    timestamp: new Date().toISOString()
  });
}

/**
 * Send a standardized "no content" success response
 * Used for successful DELETE operations or operations with no return data
 * 
 * @param {Object} res - Express response object
 * @param {string} [message] - Optional success message
 * @returns {Object} Express response
 * 
 * @example
 * sendNoContent(res, 'Donation deleted successfully');
 * // Returns: HTTP 204 with optional message in body
 */
function sendNoContent(res, message = null) {
  if (message) {
    return res.status(204).json({
      success: true,
      message,
      timestamp: new Date().toISOString()
    });
  }
  return res.status(204).end();
}

/**
 * Send a standardized "created" success response
 * Used for POST operations that create new resources
 * 
 * @param {Object} res - Express response object
 * @param {Object} data - Created resource data
 * @param {string} [location] - Optional location header value (resource URL)
 * @returns {Object} Express response
 * 
 * @example
 * sendCreated(res, { id: 456, ...donationData }, '/api/donations/456');
 * // Returns: HTTP 201 with Location header and data
 */
function sendCreated(res, data, location = null) {
  if (location) {
    res.setHeader('Location', location);
  }

  return res.status(201).json({
    success: true,
    data,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  sendSuccess,
  sendError,
  sendPaginatedSuccess,
  sendNoContent,
  sendCreated
};
