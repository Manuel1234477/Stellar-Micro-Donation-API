/**
 * Stellar Error Handler
 * Catches and transforms Stellar SDK errors into user-friendly responses
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
    // Log detailed error internally
    log.error('STELLAR_ERROR_HANDLER', `Stellar operation failed in ${context}`, {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      timestamp: new Date().toISOString()
    });

    // Network errors
    if (error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNREFUSED')) {
      return {
        status: 503,
        code: 'NETWORK_ERROR',
        message: 'Unable to connect to Stellar network. Please try again later.'
      };
    }

    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      return {
        status: 504,
        code: 'NETWORK_TIMEOUT',
        message: 'Request to Stellar network timed out. Please try again.'
      };
    }

    // Insufficient balance
    if (error.message?.includes('insufficient') || error.message?.includes('underfunded')) {
      return {
        status: 400,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance to complete this transaction.'
      };
    }

    // Invalid destination
    if (error.message?.includes('destination') || error.message?.includes('not found')) {
      return {
        status: 400,
        code: 'INVALID_DESTINATION',
        message: 'Destination account does not exist or is invalid.'
      };
    }

    // Account not funded
    if (error.message?.includes('not funded') || error.message?.includes('op_no_destination')) {
      return {
        status: 400,
        code: 'ACCOUNT_NOT_FUNDED',
        message: 'Destination account is not funded. Accounts must have a minimum balance before receiving payments.'
      };
    }

    // Invalid secret key
    if (error.message?.includes('Invalid source') || error.message?.includes('secret key')) {
      return {
        status: 400,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid wallet credentials provided.'
      };
    }

    // Transaction failed
    if (error.message?.includes('tx_failed') || error.message?.includes('transaction failed')) {
      return {
        status: 400,
        code: 'TRANSACTION_FAILED',
        message: 'Transaction failed on the Stellar network. Please verify your transaction details.'
      };
    }

    // Wallet not found (from mock service)
    if (error.message?.includes('Wallet not found')) {
      return {
        status: 404,
        code: 'WALLET_NOT_FOUND',
        message: error.message
      };
    }

    // Same sender/recipient
    if (error.message?.includes('must be different')) {
      return {
        status: 400,
        code: 'INVALID_TRANSACTION',
        message: error.message
      };
    }

    // Transaction not found
    if (error.message?.includes('Transaction not found')) {
      return {
        status: 404,
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction not found.'
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
