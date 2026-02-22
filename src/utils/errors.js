/**
 * Unified Error Handling System
 * Provides consistent error structure across all services
 */

/**
 * Standard error codes used throughout the application
 */
const ERROR_CODES = {
  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_OFFSET: 'INVALID_OFFSET',
  INVALID_DATE_FORMAT: 'INVALID_DATE_FORMAT',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_FREQUENCY: 'INVALID_FREQUENCY',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  
  // Authentication/Authorization errors (401, 403)
  UNAUTHORIZED: 'UNAUTHORIZED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Not found errors (404)
  NOT_FOUND: 'NOT_FOUND',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  DONATION_NOT_FOUND: 'DONATION_NOT_FOUND',
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  
  // Business logic errors (422)
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  
  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};

/**
 * Base application error class
 */
class AppError extends Error {
  constructor(code, message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
        timestamp: this.timestamp
      }
    };
  }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
  constructor(message, details = null, code = ERROR_CODES.VALIDATION_ERROR) {
    super(code, message, 400, details);
  }
}

/**
 * Authentication error (401)
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = ERROR_CODES.UNAUTHORIZED) {
    super(code, message, 401);
  }
}

/**
 * Authorization error (403)
 */
class ForbiddenError extends AppError {
  constructor(message = 'Access denied', code = ERROR_CODES.ACCESS_DENIED) {
    super(code, message, 403);
  }
}

/**
 * Not found error (404)
 */
class NotFoundError extends AppError {
  constructor(message, code = ERROR_CODES.NOT_FOUND) {
    super(code, message, 404);
  }
}

/**
 * Business logic error (422)
 */
class BusinessLogicError extends AppError {
  constructor(code, message, details = null) {
    super(code, message, 422, details);
  }
}

/**
 * Internal server error (500)
 */
class InternalError extends AppError {
  constructor(message = 'Internal server error', code = ERROR_CODES.INTERNAL_ERROR, details = null) {
    super(code, message, 500, details);
  }
}

/**
 * Database error (500)
 */
class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    const details = originalError ? { originalError: originalError.message } : null;
    super(ERROR_CODES.DATABASE_ERROR, message, 500, details);
  }
}

module.exports = {
  ERROR_CODES,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  BusinessLogicError,
  InternalError,
  DatabaseError
};
