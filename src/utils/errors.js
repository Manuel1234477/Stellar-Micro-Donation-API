/**
 * Error Utilities - Error Management Layer
 * 
 * RESPONSIBILITY: Centralized error definitions, custom error classes, and error codes
 * OWNER: Backend Team
 * DEPENDENCIES: None (foundational utility)
 * 
 * Provides consistent error structure across all services with standardized error codes,
 * custom error classes for different error types, and HTTP status code mapping.
 */

/**
 * Standard error codes used throughout the application
 * Format: CATEGORY_SPECIFIC_CODE (e.g., VALIDATION_MISSING_FIELD)
 * Numeric codes provide stable API error handling
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
  DUPLICATE_DONATION: 'DUPLICATE_DONATION',
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
  constructor(errorCode, message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;

    // Handle both old string codes and new structured error codes
    if (typeof errorCode === "string") {
      // Legacy support - look up the structured error code
      const structuredCode = Object.values(ERROR_CODES).find(
        (c) => c.code === errorCode,
      );
      if (structuredCode) {
        this.errorCode = structuredCode.code;
        this.numericCode = structuredCode.numeric;
      } else {
        // Fallback for unknown codes
        this.errorCode = errorCode;
        this.numericCode = 9000; // Default to internal error
      }
    } else if (errorCode && typeof errorCode === "object") {
      // New structured error code
      this.errorCode = errorCode.code;
      this.numericCode = errorCode.numeric;
    } else {
      // Default fallback
      this.errorCode = ERROR_CODES.INTERNAL_ERROR.code;
      this.numericCode = ERROR_CODES.INTERNAL_ERROR.numeric;
    }

    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.errorCode,
        numericCode: this.numericCode,
        message: this.message,
        ...(this.details && { details: this.details }),
        timestamp: this.timestamp,
      },
    };
  }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
  constructor(
    message,
    details = null,
    errorCode = ERROR_CODES.VALIDATION_ERROR,
  ) {
    super(errorCode, message, 400, details);
  }
}

/**
 * Authentication error (401)
 */
class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", errorCode = ERROR_CODES.UNAUTHORIZED) {
    super(errorCode, message, 401);
  }
}

/**
 * Authorization error (403)
 */
class ForbiddenError extends AppError {
  constructor(
    message = "Access denied",
    errorCode = ERROR_CODES.ACCESS_DENIED,
  ) {
    super(errorCode, message, 403);
  }
}

/**
 * Not found error (404)
 */
class NotFoundError extends AppError {
  constructor(message, errorCode = ERROR_CODES.NOT_FOUND) {
    super(errorCode, message, 404);
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
  constructor(
    message = "Internal server error",
    errorCode = ERROR_CODES.INTERNAL_ERROR,
    details = null,
  ) {
    super(errorCode, message, 500, details);
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

/**
 * Duplicate entry error (409)
 * Thrown when a unique constraint is violated
 */
class DuplicateError extends AppError {
  constructor(
    message = "Duplicate entry detected",
    errorCode = ERROR_CODES.DUPLICATE_DONATION,
  ) {
    super(errorCode, message, 409);
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
  DatabaseError,
  DuplicateError
};
