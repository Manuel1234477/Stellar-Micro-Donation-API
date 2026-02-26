/**
 * Timeout Handler Utility - Defensive Timeout Management
 * 
 * RESPONSIBILITY: Provides timeout wrappers for external calls
 * OWNER: Backend Team
 * DEPENDENCIES: None
 * 
 * Ensures all external operations have bounded execution time to prevent
 * indefinite blocking. Provides clear timeout error messages and logging.
 */

const log = require('./log');

/**
 * Timeout configuration constants
 */
const TIMEOUT_DEFAULTS = {
  STELLAR_API: 15000,        // 15 seconds for Stellar Horizon API calls
  STELLAR_SUBMIT: 30000,     // 30 seconds for transaction submission
  STELLAR_STREAM: 60000,     // 60 seconds for streaming connections
  DATABASE: 10000,           // 10 seconds for database operations
  DATABASE_LONG: 30000,      // 30 seconds for complex queries
};

class TimeoutError extends Error {
  constructor(message, operation, timeoutMs) {
    super(message);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Operation name for error messages
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
function withTimeout(promise, timeoutMs, operation = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const error = new TimeoutError(
          `Operation '${operation}' timed out after ${timeoutMs}ms`,
          operation,
          timeoutMs
        );
        log.error('TIMEOUT', 'Operation timeout', {
          operation,
          timeoutMs,
          timestamp: error.timestamp
        });
        reject(error);
      }, timeoutMs);
      
      // Clean up timer if promise resolves first
      promise.finally(() => clearTimeout(timer));
    })
  ]);
}

/**
 * Wrap an async function with timeout and retry logic
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Configuration options
 * @param {number} options.timeout - Timeout in milliseconds
 * @param {string} options.operation - Operation name
 * @param {number} [options.retries=0] - Number of retry attempts
 * @param {Function} [options.shouldRetry] - Function to determine if error is retryable
 * @returns {Promise} Result of the function
 */
async function executeWithTimeout(fn, options) {
  const {
    timeout,
    operation,
    retries = 0,
    shouldRetry = () => false
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeout, operation);
    } catch (error) {
      lastError = error;
      
      if (attempt < retries && shouldRetry(error)) {
        log.warn('TIMEOUT', 'Retrying after error', {
          operation,
          attempt: attempt + 1,
          maxRetries: retries,
          error: error.message
        });
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

module.exports = {
  TIMEOUT_DEFAULTS,
  TimeoutError,
  withTimeout,
  executeWithTimeout
};
