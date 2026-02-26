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
 * Format: { code: 'STRING_CODE', numeric: NUMBER }
 * Numeric codes provide stable API error handling and prevent enumeration attacks
 * 
 * Numeric Code Ranges:
 * - 1000-1099: Validation errors
 * - 2000-2099: Authentication/Authorization errors
 * - 3000-3099: Not found errors
 * - 4000-4099: Conflict/Duplicate errors
 * - 5000-5099: Business logic errors
 * - 6000-6099: Rate limiting errors
 * - 7000-7099: Stellar/Blockchain errors
 * - 8000-8099: Network/Infrastructure errors
 * - 9000-9099: Internal server errors
 */
const ERROR_CODES = {
  // Validation errors (1000-1099)
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', numeric: 1000 },
  INVALID_REQUEST: { code: 'INVALID_REQUEST', numeric: 1001 },
  INVALID_LIMIT: { code: 'INVALID_LIMIT', numeric: 1002 },
  INVALID_OFFSET: { code: 'INVALID_OFFSET', numeric: 1003 },
  INVALID_DATE_FORMAT: { code: 'INVALID_DATE_FORMAT', numeric: 1004 },
  INVALID_AMOUNT: { code: 'INVALID_AMOUNT', numeric: 1005 },
  INVALID_FREQUENCY: { code: 'INVALID_FREQUENCY', numeric: 1006 },
  MISSING_REQUIRED_FIELD: { code: 'MISSING_REQUIRED_FIELD', numeric: 1007 },
  IDEMPOTENCY_KEY_REQUIRED: { code: 'IDEMPOTENCY_KEY_REQUIRED', numeric: 1008 },
  MISSING_FIELD: { code: 'MISSING_FIELD', numeric: 1009 },
  UNKNOWN_FIELDS: { code: 'UNKNOWN_FIELDS', numeric: 1010 },
  INVALID_STELLAR_ADDRESS: { code: 'INVALID_STELLAR_ADDRESS', numeric: 1011 },
  INVALID_TRANSACTION_HASH: { code: 'INVALID_TRANSACTION_HASH', numeric: 1012 },
  INVALID_DATE_RANGE: { code: 'INVALID_DATE_RANGE', numeric: 1013 },
  INVALID_PAGINATION: { code: 'INVALID_PAGINATION', numeric: 1014 },
  MISSING_PUBLIC_KEY: { code: 'MISSING_PUBLIC_KEY', numeric: 1015 },
  INVALID_AMOUNT_TYPE: { code: 'INVALID_AMOUNT_TYPE', numeric: 1016 },
  INVALID_AMOUNT_PRECISION: { code: 'INVALID_AMOUNT_PRECISION', numeric: 1017 },
  AMOUNT_TOO_LOW: { code: 'AMOUNT_TOO_LOW', numeric: 1018 },
  AMOUNT_BELOW_MINIMUM: { code: 'AMOUNT_BELOW_MINIMUM', numeric: 1019 },
  AMOUNT_EXCEEDS_MAXIMUM: { code: 'AMOUNT_EXCEEDS_MAXIMUM', numeric: 1020 },
  INVALID_MEMO_TYPE: { code: 'INVALID_MEMO_TYPE', numeric: 1021 },
  MEMO_TOO_LONG: { code: 'MEMO_TOO_LONG', numeric: 1022 },
  INVALID_MEMO_CONTENT: { code: 'INVALID_MEMO_CONTENT', numeric: 1023 },
  INVALID_MEMO_FORMAT: { code: 'INVALID_MEMO_FORMAT', numeric: 1024 },

  // Authentication/Authorization errors (2000-2099)
  UNAUTHORIZED: { code: 'UNAUTHORIZED', numeric: 2000 },
  ACCESS_DENIED: { code: 'ACCESS_DENIED', numeric: 2001 },
  INSUFFICIENT_PERMISSIONS: { code: 'INSUFFICIENT_PERMISSIONS', numeric: 2002 },
  MISSING_API_KEY: { code: 'MISSING_API_KEY', numeric: 2003 },
  INVALID_API_KEY: { code: 'INVALID_API_KEY', numeric: 2004 },

  // Not found errors (3000-3099)
  NOT_FOUND: { code: 'NOT_FOUND', numeric: 3000 },
  WALLET_NOT_FOUND: { code: 'WALLET_NOT_FOUND', numeric: 3001 },
  TRANSACTION_NOT_FOUND: { code: 'TRANSACTION_NOT_FOUND', numeric: 3002 },
  USER_NOT_FOUND: { code: 'USER_NOT_FOUND', numeric: 3003 },
  DONATION_NOT_FOUND: { code: 'DONATION_NOT_FOUND', numeric: 3004 },
  ENDPOINT_NOT_FOUND: { code: 'ENDPOINT_NOT_FOUND', numeric: 3005 },

  // Conflict/Duplicate errors (4000-4099)
  DUPLICATE_TRANSACTION: { code: 'DUPLICATE_TRANSACTION', numeric: 4000 },
  DUPLICATE_DONATION: { code: 'DUPLICATE_DONATION', numeric: 4001 },

  // Business logic errors (5000-5099)
  INSUFFICIENT_BALANCE: { code: 'INSUFFICIENT_BALANCE', numeric: 5000 },
  TRANSACTION_FAILED: { code: 'TRANSACTION_FAILED', numeric: 5001 },
  DAILY_LIMIT_EXCEEDED: { code: 'DAILY_LIMIT_EXCEEDED', numeric: 5002 },

  // Rate limiting errors (6000-6099)
  RATE_LIMIT_EXCEEDED: { code: 'RATE_LIMIT_EXCEEDED', numeric: 6000 },

  // Stellar/Blockchain errors (7000-7099)
  STELLAR_ERROR: { code: 'STELLAR_ERROR', numeric: 7000 },
  INVALID_DESTINATION: { code: 'INVALID_DESTINATION', numeric: 7001 },
  ACCOUNT_NOT_FUNDED: { code: 'ACCOUNT_NOT_FUNDED', numeric: 7002 },
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', numeric: 7003 },

  // Network/Infrastructure errors (8000-8099)
  NETWORK_ERROR: { code: 'NETWORK_ERROR', numeric: 8000 },
  NETWORK_TIMEOUT: { code: 'NETWORK_TIMEOUT', numeric: 8001 },

  // Server errors (9000-9099)
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', numeric: 9000 },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', numeric: 9001 },
  VERIFICATION_FAILED: { code: 'VERIFICATION_FAILED', numeric: 9002 },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', numeric: 9003 },
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
