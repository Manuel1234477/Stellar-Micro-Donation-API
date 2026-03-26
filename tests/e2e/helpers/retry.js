/**
 * Retry Helper - Exponential Backoff for Testnet Operations
 *
 * RESPONSIBILITY: Resilient retry logic for Stellar testnet API calls
 * OWNER: QA/Testing Team
 *
 * The Stellar testnet can be intermittently slow or unavailable — Horizon nodes
 * get restarted, Friendbot is rate-limited, and ledger close times vary. This
 * helper wraps any async operation with configurable exponential backoff so e2e
 * tests are resilient to transient failures without masking real bugs.
 */

'use strict';

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute the next backoff delay with full jitter.
 *
 * Base formula: min(baseDelayMs * 2^(attempt - 1), maxDelayMs)
 * Jitter: random value in [0, computed_delay] to spread retries from parallel
 * callers and avoid thundering-herd against Friendbot.
 *
 * @param {number} attempt     - 1-indexed attempt number that just failed
 * @param {number} baseDelayMs - Base delay in ms (default 2000)
 * @param {number} maxDelayMs  - Cap in ms (default 30000)
 * @returns {number} Jittered delay in ms
 */
function computeBackoff(attempt, baseDelayMs = 2000, maxDelayMs = 30000) {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  return Math.floor(Math.random() * capped);
}

/**
 * Execute an async operation with exponential backoff retry.
 *
 * @param {Function} fn              - Async operation: () => Promise<T>
 * @param {object}  [opts]
 * @param {number}  [opts.maxAttempts=5]         - Total attempts before giving up
 * @param {number}  [opts.baseDelayMs=2000]      - Base delay for backoff formula
 * @param {number}  [opts.maxDelayMs=30000]      - Maximum delay cap
 * @param {Function} [opts.shouldRetry]          - (err) => boolean; default: always retry
 * @param {Function} [opts.onRetry]              - (err, attempt, delayMs) => void; for logging
 * @returns {Promise<T>}
 * @throws {Error} Last error if all attempts fail or shouldRetry returns false
 */
async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 5,
    baseDelayMs = 2000,
    maxDelayMs = 30000,
    shouldRetry = null,
    onRetry = null,
  } = opts;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // If caller supplied a predicate, respect it — non-retryable errors surface immediately
      if (shouldRetry !== null && !shouldRetry(err)) {
        throw err;
      }

      // No more attempts left
      if (attempt === maxAttempts) {
        break;
      }

      const delayMs = computeBackoff(attempt, baseDelayMs, maxDelayMs);

      if (onRetry) {
        onRetry(err, attempt, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Poll until a condition is true or we time out.
 *
 * @param {Function} condition       - () => Promise<boolean>
 * @param {object}  [opts]
 * @param {number}  [opts.maxAttempts=10]
 * @param {number}  [opts.intervalMs=3000]
 * @param {string}  [opts.description='condition'] - Used in error message
 * @returns {Promise<void>}
 * @throws {Error} If condition never becomes true within maxAttempts
 */
async function waitUntil(condition, opts = {}) {
  const { maxAttempts = 10, intervalMs = 3000, description = 'condition' } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await condition()) return;
    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${description} after ${maxAttempts} attempts (${intervalMs}ms interval)`
  );
}

module.exports = { withRetry, waitUntil, sleep, computeBackoff };
