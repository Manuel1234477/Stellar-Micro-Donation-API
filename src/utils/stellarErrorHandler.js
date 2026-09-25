/**
 * Stellar Error Handler - Error Translation Layer
 * 
 * RESPONSIBILITY: Transforms Stellar SDK errors into user-friendly API responses
 * OWNER: Blockchain Team
 * DEPENDENCIES: Logger
 * 
 * Catches and translates low-level Stellar SDK errors into consistent, actionable
 * error messages for API consumers. Maps blockchain errors to HTTP status codes.
 */

const log = require('./log');

class StellarErrorHandler {
  /**
   * Handle Stellar SDK errors and return user-friendly response
   * @param {Error} error - The error object from Stellar SDK
   * @param {string} context - Context where error occurred (e.g., 'sendDonation', 'getBalance')
   * @returns {Object} - Formatted error response with code, message, and status
   */
  static handle(error, context = 'operation') {
    const message = typeof error?.message === 'string' ? error.message : '';
    const resultCodes = error?.response?.data?.extras?.result_codes || error?.extras?.result_codes || error?.result_codes || {};
    const structuredCodeText = [
      resultCodes?.transaction,
      resultCodes?.operations,
      resultCodes?.op,
    ]
      .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const normalizedMessage = message.toLowerCase();

    // Log detailed error internally
    log.error('STELLAR_ERROR_HANDLER', `Stellar operation failed in ${context}`, {
      message,
      stack: error?.stack,
      response: error?.response?.data,
      timestamp: new Date().toISOString()
    });

    // Network errors
    if (normalizedMessage.includes('enotfound') || normalizedMessage.includes('econnrefused')) {
      return {
        status: 503,
        code: 'NETWORK_ERROR',
        message: 'Unable to connect to Stellar network. Please try again later.'
      };
    }

    if (normalizedMessage.includes('timeout') || normalizedMessage.includes('etimedout')) {
      return {
        status: 504,
        code: 'NETWORK_TIMEOUT',
        message: 'Request to Stellar network timed out. Please try again.'
      };
    }

    // Insufficient balance: prefer structured result codes when available
    if (structuredCodeText.includes('op_underfunded') || normalizedMessage.includes('insufficient') || normalizedMessage.includes('underfunded')) {
      return {
        status: 400,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance to complete this transaction.'
      };
    }

    // Account not funded / missing destination should win before generic destination matches
    if (structuredCodeText.includes('op_no_destination') || normalizedMessage.includes('not funded') || normalizedMessage.includes('op_no_destination')) {
      return {
        status: 400,
        code: 'ACCOUNT_NOT_FUNDED',
        message: 'Destination account is not funded. Accounts must have a minimum balance before receiving payments.'
      };
    }

    // Domain-specific not-found errors should not be swallowed by the generic destination bucket
    if (normalizedMessage.includes('wallet not found')) {
      return {
        status: 404,
        code: 'WALLET_NOT_FOUND',
        message: message
      };
    }

    if (normalizedMessage.includes('transaction not found') || structuredCodeText.includes('tx_not_found')) {
      return {
        status: 404,
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction not found.'
      };
    }

    // Invalid destination
    if (normalizedMessage.includes('destination') || (normalizedMessage.includes('not found') && !normalizedMessage.includes('wallet not found') && !normalizedMessage.includes('transaction not found'))) {
      return {
        status: 400,
        code: 'INVALID_DESTINATION',
        message: 'Destination account does not exist or is invalid.'
      };
    }

    // Invalid secret key
    if (normalizedMessage.includes('invalid source') || normalizedMessage.includes('secret key')) {
      return {
        status: 400,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid wallet credentials provided.'
      };
    }

    // Transaction failed
    if (normalizedMessage.includes('tx_failed') || normalizedMessage.includes('transaction failed')) {
      return {
        status: 400,
        code: 'TRANSACTION_FAILED',
        message: 'Transaction failed on the Stellar network. Please verify your transaction details.'
      };
    }

    // Same sender/recipient
    if (normalizedMessage.includes('must be different')) {
      return {
        status: 400,
        code: 'INVALID_TRANSACTION',
        message: message
      };
    }

    // Default error
    return {
      status: 500,
      code: 'STELLAR_ERROR',
      message: 'An error occurred while processing your request. Please try again.'
    };
  }

  /**
   * Wrap async Stellar operations with error handling
   * @param {Function} operation - Async function to execute
   * @param {string} context - Context description
   * @returns {Promise<Object>} - Result or formatted error
   */
  static async wrap(operation, context) {
    try {
      return await operation();
    } catch (error) {
      throw this.handle(error, context);
    }
  }
}

module.exports = StellarErrorHandler;
