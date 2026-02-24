/**
 * Global Error Handler Middleware
 * Catches all errors and formats them consistently
 */

const { AppError } = require('../utils/errors');
const log = require('../utils/log');

/**
 * Error handler middleware
 * Should be registered last in the middleware chain
 */
function errorHandler(err, req, res, next) {
  void next;

  // Task: Include request ID in logs
  log.error('ERROR_HANDLER', 'Error occurred', {
    requestId: req.id, // <--- New unique identifier
    path: req.path,
    method: req.method,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Handle AppError instances
  if (err instanceof AppError) {
    const errorBody = err.toJSON();
    errorBody.error.requestId = req.id; // <--- Attach to response
    return res.status(err.statusCode).json(errorBody);
  }

  // Handle default errors
  const statusCode = err.statusCode || err.status || 500;
  const isValidationError = err.name === 'ValidationError';
  res.status(statusCode).json({
    success: false,
    error: {
      code: isValidationError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' && !isValidationError
        ? 'An unexpected error occurred' 
        : err.message,
      requestId: req.id, // <--- Task: Include in error responses
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `Endpoint not found: ${req.method} ${req.path}`,
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
