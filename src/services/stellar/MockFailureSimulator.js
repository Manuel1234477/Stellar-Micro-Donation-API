/**
 * Mock Failure Simulator
 * Simulates various Stellar network failures for testing
 */

const { BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

class MockFailureSimulator {
  constructor() {
    this.state = {
      enabled: false,
      type: null,
      probability: 0,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 0,
    };

    this.requestTimestamps = [];
  }

  /**
   * Enable failure simulation
   * @param {string} type - Type of failure to simulate
   * @param {number} probability - Probability of failure (0-1)
   */
  enable(type, probability = 1.0) {
    this.state.enabled = true;
    this.state.type = type;
    this.state.probability = probability;
    this.state.consecutiveFailures = 0;
    log.info('MOCK_FAILURE_SIMULATOR', 'Failure simulation enabled', { type, probability });
  }

  /**
   * Disable failure simulation
   */
  disable() {
    this.state.enabled = false;
    this.state.type = null;
    this.state.probability = 0;
    this.state.consecutiveFailures = 0;
    log.info('MOCK_FAILURE_SIMULATOR', 'Failure simulation disabled');
  }

  /**
   * Set maximum consecutive failures before auto-recovery
   * @param {number} max - Maximum consecutive failures
   */
  setMaxConsecutiveFailures(max) {
    this.state.maxConsecutiveFailures = max;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean}
   */
  isRetryableError(error) {
    return Boolean(error && error.details && error.details.retryable);
  }

  /**
   * Execute operation with retry logic
   * @param {Function} operation - Async operation to execute
   * @returns {Promise<any>}
   */
  async executeWithRetry(operation) {
    const maxFailures = this.state.maxConsecutiveFailures;
    const maxAttempts = maxFailures > 0 ? maxFailures + 1 : 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error) || attempt === maxAttempts) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * Simulate failure based on configuration
   * @throws {BusinessLogicError} If failure should occur
   */
  simulateFailure() {
    if (!this.state.enabled) return;

    // Check if we should fail based on probability
    if (Math.random() > this.state.probability) {
      this.state.consecutiveFailures = 0;
      return;
    }

    // Check if we've hit max consecutive failures (auto-recovery)
    if (this.state.maxConsecutiveFailures > 0 &&
        this.state.consecutiveFailures >= this.state.maxConsecutiveFailures) {
      this.state.consecutiveFailures = 0;
      this.state.enabled = false;
      return;
    }

    this.state.consecutiveFailures++;

    const failureType = this.state.type;

    switch (failureType) {
      case 'timeout':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Request timeout - Stellar network may be experiencing high load. Please try again.',
          { retryable: true, retryAfter: 5000 }
        );

      case 'network_error':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Network error: Unable to connect to Stellar Horizon server. Check your connection.',
          { retryable: true, retryAfter: 3000 }
        );

      case 'service_unavailable':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Service temporarily unavailable: Stellar Horizon is under maintenance. Please try again later.',
          { retryable: true, retryAfter: 10000 }
        );

      case 'bad_sequence':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'tx_bad_seq: Transaction sequence number does not match source account. This usually indicates a concurrent transaction.',
          { retryable: true, retryAfter: 1000 }
        );

      case 'tx_failed':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'tx_failed: Transaction failed due to network congestion or insufficient fee. Please retry with higher fee.',
          { retryable: true, retryAfter: 2000 }
        );

      case 'tx_insufficient_fee':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'tx_insufficient_fee: Transaction fee is too low for current network conditions.',
          { retryable: true, retryAfter: 1000 }
        );

      case 'connection_refused':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Connection refused: Unable to establish connection to Stellar network.',
          { retryable: true, retryAfter: 5000 }
        );

      case 'rate_limit_horizon':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Horizon rate limit exceeded: Too many requests to Stellar network. Please slow down.',
          { retryable: true, retryAfter: 60000 }
        );

      case 'partial_response':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Incomplete response from Stellar network. Data may be corrupted.',
          { retryable: true, retryAfter: 2000 }
        );

      case 'ledger_closed':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Ledger already closed: Transaction missed the ledger window. Please resubmit.',
          { retryable: true, retryAfter: 5000 }
        );

      default:
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Unknown network error occurred',
          { retryable: true, retryAfter: 3000 }
        );
    }
  }

  /**
   * Simulate random transaction failure
   * @param {number} failureRate - Failure rate (0-1)
   * @throws {BusinessLogicError} If failure should occur
   */
  simulateRandomFailure(failureRate) {
    if (failureRate > 0 && Math.random() < failureRate) {
      const errors = [
        'tx_bad_seq: Transaction sequence number does not match source account',
        'tx_insufficient_balance: Insufficient balance for transaction',
        'tx_failed: Transaction failed due to network congestion',
        'timeout: Request timeout - network may be experiencing high load',
      ];
      const error = errors[Math.floor(Math.random() * errors.length)];
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, error);
    }
  }

  /**
   * Simulate network delay
   * @param {number} delayMs - Delay in milliseconds
   * @returns {Promise<void>}
   */
  async simulateNetworkDelay(delayMs) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  /**
   * Check rate limiting
   * @param {number} rateLimit - Max requests per second
   * @throws {BusinessLogicError} If rate limit exceeded
   */
  checkRateLimit(rateLimit) {
    if (!rateLimit) return;

    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneSecondAgo);

    if (this.requestTimestamps.length >= rateLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Rate limit exceeded. Please try again later.',
        { retryAfter: 1000 }
      );
    }

    this.requestTimestamps.push(now);
  }
}

module.exports = MockFailureSimulator;
