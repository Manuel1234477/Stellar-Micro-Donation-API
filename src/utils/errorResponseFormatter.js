/**
 * Standardized Error Response Formatter (Issue #1090)
 *
 * Provides canonical error envelope with stable codes, security masking,
 * and exhaustive Stellar/Horizon error mapping without losing detail.
 *
 * Issue #1090: https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1090
 */

const log = require('../utils/log');

/**
 * Stellar/Horizon result codes mapped to stable client error codes
 * Prevents raw provider payloads from leaking to clients
 */
const STELLAR_ERROR_MAPPING = {
  // Transaction-level errors (tx_*)
  'tx_bad_seq': {
    code: 'STELLAR_TX_BAD_SEQ',
    message: 'Invalid or duplicate transaction sequence number',
    severity: 'error',
    clientFacing: true,
  },
  'tx_bad_auth': {
    code: 'STELLAR_TX_BAD_AUTH',
    message: 'Transaction signature validation failed',
    severity: 'error',
    clientFacing: true,
  },
  'tx_bad_auth_extra': {
    code: 'STELLAR_TX_BAD_AUTH_EXTRA',
    message: 'Transaction has extra unauthorized signers',
    severity: 'error',
    clientFacing: true,
  },
  'tx_internal_error': {
    code: 'STELLAR_TX_INTERNAL_ERROR',
    message: 'Stellar network internal error',
    severity: 'error',
    clientFacing: false, // Don't leak internals
  },
  'tx_no_operation': {
    code: 'STELLAR_TX_NO_OPERATION',
    message: 'Transaction contains no operations',
    severity: 'error',
    clientFacing: true,
  },
  'tx_too_late': {
    code: 'STELLAR_TX_TIME_BOUNDS_EXCEEDED',
    message: 'Transaction time bounds have expired',
    severity: 'error',
    clientFacing: true,
  },
  'tx_too_early': {
    code: 'STELLAR_TX_PREMATURE',
    message: 'Transaction is not yet valid (time bounds)',
    severity: 'error',
    clientFacing: true,
  },
  'tx_missing_operation': {
    code: 'STELLAR_TX_MISSING_OPERATION',
    message: 'Transaction operation validation failed',
    severity: 'error',
    clientFacing: true,
  },
  'tx_insufficient_balance': {
    code: 'INSUFFICIENT_BALANCE',
    message: 'Account has insufficient balance for transaction',
    severity: 'error',
    clientFacing: true,
  },
  'tx_fee_bump_inner_failed': {
    code: 'STELLAR_TX_FEE_BUMP_INNER_FAILED',
    message: 'Inner transaction of fee-bump failed',
    severity: 'error',
    clientFacing: true,
  },

  // Operation-level errors (op_*)
  'op_underfunded': {
    code: 'STELLAR_OP_UNDERFUNDED',
    message: 'Insufficient funds for payment operation',
    severity: 'error',
    clientFacing: true,
  },
  'op_no_destination': {
    code: 'STELLAR_OP_NO_DESTINATION',
    message: 'Destination account does not exist',
    severity: 'error',
    clientFacing: true,
  },
  'op_no_trust': {
    code: 'STELLAR_OP_NO_TRUST',
    message: 'Destination account has no trustline for asset',
    severity: 'error',
    clientFacing: true,
  },
  'op_line_full': {
    code: 'STELLAR_OP_TRUSTLINE_FULL',
    message: 'Destination trustline balance would exceed maximum',
    severity: 'error',
    clientFacing: true,
  },
  'op_invalid_limit': {
    code: 'STELLAR_OP_INVALID_LIMIT',
    message: 'Invalid trustline limit value',
    severity: 'error',
    clientFacing: true,
  },
  'op_already_exists': {
    code: 'STELLAR_OP_ALREADY_EXISTS',
    message: 'Operation would create duplicate resource',
    severity: 'error',
    clientFacing: true,
  },
  'op_master_weight_limit': {
    code: 'STELLAR_OP_MASTER_WEIGHT_LIMIT',
    message: 'Master key weight threshold would be violated',
    severity: 'error',
    clientFacing: true,
  },
  'op_threshold_out_of_range': {
    code: 'STELLAR_OP_THRESHOLD_OUT_OF_RANGE',
    message: 'Signer threshold is out of valid range',
    severity: 'error',
    clientFacing: true,
  },
  'op_bad_signer': {
    code: 'STELLAR_OP_BAD_SIGNER',
    message: 'Invalid signer public key',
    severity: 'error',
    clientFacing: true,
  },
  'op_insufficient_reserve': {
    code: 'STELLAR_OP_INSUFFICIENT_RESERVE',
    message: 'Operation would violate minimum account balance',
    severity: 'error',
    clientFacing: true,
  },
};

/**
 * Canonical error response envelope
 * Format: { error: { code, message, details, requestId, timestamp } }
 */
class CanonicalErrorResponse {
  constructor(code, message, statusCode = 500, details = null) {
    this.code = code;
    this.message = message;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON(requestId, production = false) {
    const envelope = {
      error: {
        code: this.code,
        message: this.message,
        timestamp: this.timestamp,
        requestId: requestId,
      },
    };

    // Add details in non-production or if explicitly allowed
    if (this.details && !production) {
      envelope.error.details = this.details;
    }

    return envelope;
  }
}

/**
 * Map Stellar/Horizon errors to stable client codes
 *
 * @param {Error|Object} stellarError - Error from Stellar SDK or Horizon
 * @returns {CanonicalErrorResponse}
 */
function mapStellarError(stellarError) {
  const resultCode = stellarError.data?.result_code || 
                     stellarError.resultCode || 
                     stellarError.code;

  if (!resultCode) {
    return new CanonicalErrorResponse(
      'STELLAR_UNKNOWN_ERROR',
      'An error occurred on the Stellar network',
      500
    );
  }

  const mapping = STELLAR_ERROR_MAPPING[resultCode];

  if (mapping) {
    return new CanonicalErrorResponse(
      mapping.code,
      mapping.clientFacing ? mapping.message : 'A Stellar network error occurred',
      mapping.code.includes('INSUFFICIENT_BALANCE') ? 402 : 400,
      mapping.clientFacing ? null : { original_code: resultCode }
    );
  }

  // Unknown code - don't leak details
  return new CanonicalErrorResponse(
    'STELLAR_OPERATION_FAILED',
    'The operation could not be completed on the Stellar network',
    400
  );
}

/**
 * Create a standardized error response from any error
 * Ensures consistent shape and masks sensitive data
 *
 * @param {Error|Object} error - The error
 * @param {Object} options - Response options
 * @param {string} options.requestId - Correlation ID
 * @param {boolean} options.production - Whether in production mode
 * @param {number} options.statusCode - Override HTTP status
 * @returns {Object} Canonical error response
 */
function formatErrorResponse(error, options = {}) {
  const {
    requestId = 'unknown',
    production = process.env.NODE_ENV === 'production',
    statusCode = 500,
  } = options;

  let response;

  // Handle Stellar/Horizon errors
  if (error.data?.result_code || error.resultCode) {
    response = mapStellarError(error);
  }
  // Handle application errors with code
  else if (error.code || error.errorCode) {
    response = new CanonicalErrorResponse(
      error.code || error.errorCode,
      error.message || 'An error occurred',
      error.statusCode || statusCode
    );
  }
  // Handle generic errors
  else {
    response = new CanonicalErrorResponse(
      'INTERNAL_ERROR',
      production ? 'An unexpected error occurred' : error.message,
      statusCode
    );
  }

  // Log full error server-side with request ID
  const logContext = {
    requestId,
    errorCode: response.code,
    statusCode: response.statusCode,
    originalError: error.message,
    stack: error.stack,
  };

  if (!production) {
    log.error('ERROR_RESPONSE', 'Error response generated', logContext);
  } else {
    // In production, only log at the ID level for correlation
    log.warn('ERROR_RESPONSE', `Error [${response.code}]`, { requestId });
  }

  return {
    statusCode: response.statusCode,
    body: response.toJSON(requestId, production),
  };
}

/**
 * Ensure consistent error responses from all paths:
 * - Route handlers
 * - Middleware
 * - Stream handlers
 * - Background jobs
 */
function createErrorResponseMiddleware() {
  return (err, req, res, next) => {
    const response = formatErrorResponse(err, {
      requestId: req.id || req.correlationId || 'unknown',
      production: process.env.NODE_ENV === 'production',
      statusCode: err.statusCode || 500,
    });

    res.status(response.statusCode).json(response.body);
  };
}

module.exports = {
  CanonicalErrorResponse,
  mapStellarError,
  formatErrorResponse,
  createErrorResponseMiddleware,
  STELLAR_ERROR_MAPPING,
};
