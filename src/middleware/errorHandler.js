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
const { parseLanguage, getMessage } = require('../utils/i18n');
const { maskSensitiveData } = require('../utils/dataMasker');

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
 * Normalize a single validation detail into the documented contract shape:
 * { field, value, expected, example }
 * Intent: Guarantee every validation detail exposes field path, invalid value,
 * expected type and an example, regardless of how the validator threw it.
 * @param {Object} detail - Raw detail from a ValidationError
 * @returns {Object} - Normalized detail
 */
function normalizeValidationDetail(detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const field = d.field || d.path || d.param || d.property || 'body';
  const expected = d.expected || d.type || d.expectedType || 'valid value';
  const value = d.value !== undefined ? d.value : (d.received !== undefined ? d.received : null);
  const example = d.example !== undefined
    ? d.example
    : (d.sample !== undefined ? d.sample : `valid ${expected}`);

  return { field, value, expected, example };
}

/**
 * Build the single documented validation error envelope.
 * Intent: Centralize validation error formatting so all validators produce the
 * same contract: { success:false, error:{ code, message, requestId, details:[...] } }
 * @param {Object} err - ValidationError instance
 * @param {string} requestId - Request ID for tracing
 * @param {string} lang - Resolved request language
 * @returns {Object} - Documented validation error envelope
 */
function buildValidationErrorResponse(err, requestId, lang) {
  const rawDetails = Array.isArray(err.details)
    ? err.details
    : (err.details && Array.isArray(err.details.errors) ? err.details.errors : []);

  const details = rawDetails.map(normalizeValidationDetail);

  return {
    success: false,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR.code,
      numericCode: ERROR_CODES.VALIDATION_ERROR.numeric,
      message: getMessage('VALIDATION_ERROR', lang) || err.message || 'Validation failed',
      requestId,
      timestamp: new Date().toISOString(),
      details,
    },
  };
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
  const lang = parseLanguage(req.headers && req.headers['accept-language']);

  // Log detailed context server-side only
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
      stack: err.stack, // server-side only, never sent to client
      ...(err.details && { details: maskSensitiveData(err.details) }),
    },
    ...(req.get && { userAgent: req.get("User-Agent") }),
    ...(req.ip && { ip: req.ip }),
    timestamp: new Date().toISOString(),
  });

  res.set('Content-Language', lang);

  // Handle known operational errors (AppError instances)
  if (err instanceof AppError) {
    const errorBody = err.toJSON();
    errorBody.error.requestId = req.id;
    // English callers keep the specific message (e.g. which permission was
    // missing); other languages get the localised generic message.
    const translated = lang !== 'en' ? getMessage(err.errorCode, lang) : null;
    if (translated) errorBody.error.message = translated;
    if (!isProduction) {
      errorBody.error.debug = { name: err.name };
    } else {
      // Strip any details that might contain internal info in production
      delete errorBody.error.details;
    }
    // Set Retry-After + X-Limit-Reset headers for rate/velocity limit errors (HTTP 429)
    if (err.statusCode === 429) {
      if (err.retryAfterSeconds != null) {
        // Sliding-window VelocityLimitExceededError — precise seconds until next slot opens
        res.set('Retry-After', String(err.retryAfterSeconds));
      } else if (err.resetAt) {
        // Legacy fixed-window errors — compute remaining seconds from resetAt timestamp
        const secondsUntilReset = Math.max(
          1,
          Math.ceil((new Date(err.resetAt).getTime() - Date.now()) / 1000)
        );
        res.set('Retry-After', String(secondsUntilReset));
        res.set('X-Limit-Reset', err.resetAt);
      }
    }
    return res.status(err.statusCode).json(errorBody);
  }

  // #1146: pool exhaustion → fast 503 with Retry-After so clients back off
  if (
    err.name === 'DatabaseError' &&
    err.message &&
    err.message.includes('Timed out waiting for an available database connection')
  ) {
    log.warn('ERROR_HANDLER', 'DB pool exhaustion', { requestId: req.id });
    res.set('Retry-After', '5');
    return res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Server is temporarily overloaded. Please retry after a moment.',
        requestId: req.id,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Handle named validation errors — 422 Unprocessable Entity:
  // The request was well-formed (parseable) but failed semantic validation rules.
  // 400 Bad Request is reserved for syntactically malformed requests (e.g. invalid JSON).
  // All validation failures are formatted here into the single documented envelope.
  if (err.name === "ValidationError" || err.name === "SchemaValidationError") {
    return res.status(422).json(buildValidationErrorResponse(err, req.id, lang));
  }

  // Default: unexpected errors
  const statusCode = err.statusCode || err.status || 500;
  const message = isProduction
    ? (getMessage('INTERNAL_ERROR', lang) || 'An unexpected error occurred. Please try again later.')
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
 * Intent: Gracefully catch requests to undefined routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
      requestId: req.id,
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  sanitizeMessage,
  formatErrorResponse,
  buildValidationErrorResponse,
  normalizeValidationDetail,
};
