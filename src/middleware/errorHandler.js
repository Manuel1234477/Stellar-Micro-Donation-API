/**
 * Global Error Handler Middleware - Error Management Layer
 * 
 * RESPONSIBILITY: Centralized error handling, sanitization, and response formatting
 * OWNER: Backend Team
 * DEPENDENCIES: Logger, error utilities, data masker
 * 
 * Provides secure catch-all for all application errors, preventing sensitive data leaks
 * and ensuring consistent JSON error responses with request correlation.
 * 
 * Intent: Provide a centralized, secure catch-all for all application errors to 
 * prevent leaking sensitive stack traces and ensure a consistent JSON error format.
 * Flow:
 * 1. Log the error with high-context metadata (Request ID, Method, Path).
 * 2. Distinguish between operational errors (AppError) and unexpected system crashes.
 * 3. Sanitize error messages based on the environment (Production vs. Development).
 * 4. Inject the unique Request ID into every error response for easier support correlation.
 * 5. Mask sensitive information in production environments.
 */

const { AppError, ERROR_CODES } = require("../utils/errors");
const log = require('../utils/log');

/**
 * Production-safe message sanitizer
 * Intent: Remove sensitive information from error messages in production
 * @param {string} message - Original error message
 * @param {string} errorCode - Error code for context
 * @returns {string} - Sanitized message safe for production
 */
function sanitizeMessage(message, errorCode = 'INTERNAL_ERROR') {
  if (process.env.NODE_ENV !== 'production') {
    return message;
  }

  // List of patterns that might expose sensitive information
  const sensitivePatterns = [
    /database|db|sql|query/gi,
    /file|path|directory|folder/gi,
    /internal|system|server|infrastructure/gi,
    /stack|trace|exception/gi,
    /password|secret|key|token|credential/gi,
    /localhost|127\.0\.0\.1|internal|private/gi,
    /\.js|\.json|\.env|config/gi
  ];

  // Check if message contains sensitive patterns
  const hasSensitiveContent = sensitivePatterns.some(pattern => pattern.test(message));
  
  if (hasSensitiveContent && errorCode === 'INTERNAL_ERROR') {
    return 'An internal error occurred. Please try again later.';
  }

  // For validation errors, keep the message but remove potential sensitive details
  if (errorCode === 'VALIDATION_ERROR') {
    return message.replace(/\b(file|path|database|system|internal)\b/gi, 'input');
  }

  return message;
}

/**
 * Enhanced error response formatter
 * Intent: Create consistent, secure error responses
 * @param {Object} error - Error object
 * @param {string} requestId - Request ID for tracing
 * @returns {Object} - Formatted error response
 */
function formatErrorResponse(error, requestId) {
  const isProduction = process.env.NODE_ENV === 'production';
  const errorCode = error.errorCode || error.code || "INTERNAL_ERROR";
  const numericCode = error.numericCode || 9000;
  
  return {
    success: false,
    error: {
      code: errorCode,
      numericCode: numericCode,
      message: sanitizeMessage(error.message || "An error occurred", errorCode),
      requestId,
      timestamp: new Date().toISOString(),
      // Include details for AppError instances even in production (they're meant to be user-safe)
      ...(error.details && { details: error.details }),
      ...(isProduction
        ? {}
        : {
            debug: {
              name: error.name,
            },
          }),
    },
  };
}

/**
 * Main Error Dispatcher
 * Intent: Handle the final stage of the request/response lifecycle when an error occurs.
 * Flow:
 * - Captures the error object from the 'next(err)' pipeline.
 * - Logs detailed stack traces in development but suppresses them in production.
 * - Formats response body with 'success: false' and relevant error codes.
 */
function errorHandler(err, req, res, next) {
  void next;

  const isProduction = process.env.NODE_ENV === 'production';

  // Log 1: detailed context
  log.error("ERROR_HANDLER", "Error occurred", {
    requestId: req.id,
    path: req.path,
    method: req.method,
    error: {
      name: err.name,
      message: err.message,
      code: err.errorCode || err.code,
      numericCode: err.numericCode,
      statusCode: err.statusCode || err.status,
      ...(!isProduction && { stack: err.stack }),
      ...(err.details && { details: err.details }),
    },
    ...(req.get && { userAgent: req.get("User-Agent") }),
    ...(req.ip && { ip: req.ip }),
    timestamp: new Date().toISOString(),
  });

  // Log 2: simple audit trail
  log.error('ERROR_HANDLER', 'Error occurred', {
    requestId: req.id,
    path: req.path,
    method: req.method,
    error: err.message,
    code: err.errorCode || err.code,
    numericCode: err.numericCode,
  });

  // Handle known operational errors (AppError instances)
  if (err instanceof AppError) {
    const errorBody = err.toJSON();
    errorBody.error.requestId = req.id;
    if (!isProduction) {
      errorBody.error.debug = { name: err.name };
    }
    return res.status(err.statusCode).json(errorBody);
  }

  // Handle named validation errors
  if (err.name === "ValidationError" || err.name === "SchemaValidationError") {
    return res.status(400).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR.code,
        numericCode: ERROR_CODES.VALIDATION_ERROR.numeric,
        message: err.message,
        requestId: req.id,
        timestamp: new Date().toISOString(),
        ...(!isProduction && { debug: { name: err.name } }),
      },
    });
  }

  // Default: unexpected errors
  const statusCode = err.statusCode || err.status || 500;
  const message = isProduction
    ? 'An unexpected error occurred. Please try again later.'
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR.code,
      numericCode: ERROR_CODES.INTERNAL_ERROR.numeric,
      message,
      requestId: req.id,
      timestamp: new Date().toISOString(),
      ...(!isProduction && { debug: { name: 'InternalError' } }),
    },
  });
}

/**
 * 404 Not Found Handler
 * Intent: Gracefully catch requests to undefined routes.
 * Flow: Triggered when no routes in app.js match the requested URL. Returns 404 JSON.
 */
function notFoundHandler(req, res) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(404).json({
    success: false,
    error: {
      code: ERROR_CODES.ENDPOINT_NOT_FOUND.code,
      numericCode: ERROR_CODES.ENDPOINT_NOT_FOUND.numeric,
      message: `Endpoint not found: ${req.method} ${req.path}`,
      requestId: req.id,
      timestamp: new Date().toISOString(),
      ...(!isProduction && { debug: { name: 'NotFoundError' } }),
    },
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  formatErrorResponse
};
