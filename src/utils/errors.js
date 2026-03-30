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
  // Validation errors (1000-1099)
  VALIDATION_ERROR:        { code: 'VALIDATION_ERROR',        numeric: 1000 },
  INVALID_REQUEST:         { code: 'INVALID_REQUEST',         numeric: 1001 },
  INVALID_LIMIT:           { code: 'INVALID_LIMIT',           numeric: 1002 },
  INVALID_OFFSET:          { code: 'INVALID_OFFSET',          numeric: 1003 },
  INVALID_DATE_FORMAT:     { code: 'INVALID_DATE_FORMAT',     numeric: 1004 },
  INVALID_AMOUNT:          { code: 'INVALID_AMOUNT',          numeric: 1005 },
  INVALID_FREQUENCY:       { code: 'INVALID_FREQUENCY',       numeric: 1006 },
  MISSING_REQUIRED_FIELD:  { code: 'MISSING_REQUIRED_FIELD',  numeric: 1007 },
  IDEMPOTENCY_KEY_REQUIRED:{ code: 'IDEMPOTENCY_KEY_REQUIRED',numeric: 1008 },
  INVALID_SCHEMA_VERSION:  { code: 'INVALID_SCHEMA_VERSION',  numeric: 1009 },

  // Authentication/Authorization errors (2000-2099)
  UNAUTHORIZED:             { code: 'UNAUTHORIZED',             numeric: 2000 },
  ACCESS_DENIED:            { code: 'ACCESS_DENIED',            numeric: 2001 },
  INSUFFICIENT_PERMISSIONS: { code: 'INSUFFICIENT_PERMISSIONS', numeric: 2002 },
  INVALID_API_KEY:          { code: 'INVALID_API_KEY',          numeric: 2003 },

  // Not found errors (3000-3099)
  NOT_FOUND:            { code: 'NOT_FOUND',            numeric: 3000 },
  WALLET_NOT_FOUND:     { code: 'WALLET_NOT_FOUND',     numeric: 3001 },
  TRANSACTION_NOT_FOUND:{ code: 'TRANSACTION_NOT_FOUND',numeric: 3002 },
  USER_NOT_FOUND:       { code: 'USER_NOT_FOUND',       numeric: 3003 },
  DONATION_NOT_FOUND:   { code: 'DONATION_NOT_FOUND',   numeric: 3004 },
  ENDPOINT_NOT_FOUND:   { code: 'ENDPOINT_NOT_FOUND',   numeric: 3005 },

  // Conflict/Duplicate errors (4000-4099)
  DUPLICATE_TRANSACTION: { code: 'DUPLICATE_TRANSACTION', numeric: 4000 },
  DUPLICATE_DONATION:    { code: 'DUPLICATE_DONATION',    numeric: 4001 },

  // Business logic errors (5000-5099)
  INSUFFICIENT_BALANCE: { code: 'INSUFFICIENT_BALANCE', numeric: 5000 },
  TRANSACTION_FAILED:   { code: 'TRANSACTION_FAILED',   numeric: 5001 },
  FEE_BUMP_MAX_ATTEMPTS:  { code: 'FEE_BUMP_MAX_ATTEMPTS',  numeric: 5010 },
  FEE_BUMP_EXCEEDS_CAP:   { code: 'FEE_BUMP_EXCEEDS_CAP',   numeric: 5011 },
  FEE_BUMP_INVALID_STATE: { code: 'FEE_BUMP_INVALID_STATE', numeric: 5012 },
  FEE_BUMP_NO_ENVELOPE:   { code: 'FEE_BUMP_NO_ENVELOPE',   numeric: 5013 },
  FEE_BUMP_FAILED:        { code: 'FEE_BUMP_FAILED',        numeric: 5014 },

  // Routing errors (5020-5029)
  ROUTING_STRATEGY_REQUIRED: { code: 'ROUTING_STRATEGY_REQUIRED', numeric: 5020 },
  INVALID_ROUTING_STRATEGY:  { code: 'INVALID_ROUTING_STRATEGY',  numeric: 5021 },
  POOL_NAME_REQUIRED:        { code: 'POOL_NAME_REQUIRED',        numeric: 5022 },
  POOL_NOT_FOUND:            { code: 'POOL_NOT_FOUND',            numeric: 5023 },
  POOL_EMPTY:                { code: 'POOL_EMPTY',                numeric: 5024 },
  POOL_ALREADY_EXISTS:       { code: 'POOL_ALREADY_EXISTS',       numeric: 5025 },
  RECIPIENT_NOT_IN_POOL:     { code: 'RECIPIENT_NOT_IN_POOL',     numeric: 5026 },
  DONOR_COORDINATES_REQUIRED:{ code: 'DONOR_COORDINATES_REQUIRED',numeric: 5027 },
  NO_ELIGIBLE_RECIPIENTS:    { code: 'NO_ELIGIBLE_RECIPIENTS',    numeric: 5028 },
  NO_ACTIVE_CAMPAIGNS:       { code: 'NO_ACTIVE_CAMPAIGNS',       numeric: 5029 },

  // Rate limiting errors (6000-6099)
  RATE_LIMIT_EXCEEDED: { code: 'RATE_LIMIT_EXCEEDED', numeric: 6000 },

  // Server errors (9000-9999)
  INTERNAL_ERROR:        { code: 'INTERNAL_ERROR',        numeric: 9000 },
  DATABASE_ERROR:        { code: 'DATABASE_ERROR',        numeric: 9001 },
  VERIFICATION_FAILED:   { code: 'VERIFICATION_FAILED',   numeric: 9002 },
  SERVICE_UNAVAILABLE:   { code: 'SERVICE_UNAVAILABLE',   numeric: 9003 },
  STELLAR_NETWORK_ERROR: { code: 'STELLAR_NETWORK_ERROR', numeric: 9004 },
  EXTERNAL_SERVICE_ERROR:{ code: 'EXTERNAL_SERVICE_ERROR',numeric: 9005 },
  RESOURCE_CONFLICT:     { code: 'RESOURCE_CONFLICT',     numeric: 4009 },
  NOT_IMPLEMENTED:       { code: 'NOT_IMPLEMENTED',       numeric: 9006 },
};

/**
 * Base application error class
 */
class AppError extends Error {
  constructor(errorCode, message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;

    if (errorCode && typeof errorCode === 'object' && errorCode.code) {
      // Structured error code object
      this.errorCode = errorCode.code;
      this.numericCode = errorCode.numeric;
    } else if (typeof errorCode === 'string') {
      // Legacy string code - look up structured version
      const structured = Object.values(ERROR_CODES).find(c => c.code === errorCode);
      this.errorCode = errorCode;
      this.numericCode = structured ? structured.numeric : ERROR_CODES.INTERNAL_ERROR.numeric;
    } else {
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
  constructor(message = "A database error occurred", originalError = null) {
    // Audit: We store originalError for internal logging if needed, 
    // but the base class message is normalized.
    super(ERROR_CODES.DATABASE_ERROR, message, 500, null);
    this.originalError = originalError;
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

class ConflictError extends AppError {
  constructor(
    message = "Resource conflict",
    errorCode = ERROR_CODES.RESOURCE_CONFLICT,
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
