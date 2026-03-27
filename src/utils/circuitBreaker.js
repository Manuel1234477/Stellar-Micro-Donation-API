/**
 * Circuit Breaker - Horizon API Protection
 *
 * Implements the circuit breaker pattern with three states:
 *  - CLOSED  : Normal operation; failures are counted.
 *  - OPEN    : Horizon is considered down; calls fail fast with 503.
 *  - HALF_OPEN: One probe request is allowed to test recovery.
 *
 * Configuration defaults (overridable via constructor options):
 *  - failureThreshold : 5  failures within windowMs opens the circuit
 *  - windowMs         : 60 000 ms (60 s) sliding failure window
 *  - cooldownMs       : 30 000 ms (30 s) before a probe is attempted
 */

const STATES = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' });

class CircuitBreaker {
  /**
   * @param {Object} [options]
   * @param {number} [options.failureThreshold=5]  - Failures in window before opening
   * @param {number} [options.windowMs=60000]       - Sliding window length (ms)
   * @param {number} [options.cooldownMs=30000]     - Cooldown before half-open probe (ms)
   * @param {string} [options.name='horizon']       - Name used in error messages
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.name = options.name ?? 'horizon';

    this._state = STATES.CLOSED;
    /** @type {number[]} Timestamps (ms) of recent failures within the window */
    this._failures = [];
    /** @type {number|null} When the circuit was opened */
    this._openedAt = null;
    /** @type {boolean} Whether a half-open probe is currently in-flight */
    this._probeInFlight = false;
  }

  /** @returns {'closed'|'open'|'half_open'} */
  get state() {
    return this._state;
  }

  /**
   * Returns a plain-object snapshot suitable for health check responses.
   * @returns {{ state: string, failures: number, openedAt: string|null }}
   */
  getStatus() {
    this._pruneWindow();
    return {
      state: this._state,
      failures: this._failures.length,
      openedAt: this._openedAt ? new Date(this._openedAt).toISOString() : null,
    };
  }

  /**
   * Execute a Horizon operation through the circuit breaker.
   *
   * - CLOSED    : runs the operation; records failure on error.
   * - OPEN      : throws immediately without calling the operation.
   * - HALF_OPEN : allows exactly one probe; subsequent callers get a fast-fail
   *               until the probe resolves.
   *
   * @template T
   * @param {() => Promise<T>} operation - Async factory that performs the Horizon call
   * @returns {Promise<T>}
   * @throws {Error} With status 503 when the circuit is open
   */
  async execute(operation) {
    this._maybeTransitionToHalfOpen();

    if (this._state === STATES.OPEN) {
      const err = new Error(`Circuit breaker open: ${this.name} is unavailable`);
      err.status = 503;
      err.circuitOpen = true;
      throw err;
    }

    if (this._state === STATES.HALF_OPEN) {
      if (this._probeInFlight) {
        // Another probe is already running — fast-fail remaining callers
        const err = new Error(`Circuit breaker half-open: ${this.name} probe in progress`);
        err.status = 503;
        err.circuitOpen = true;
        throw err;
      }
      return this._runProbe(operation);
    }

    // CLOSED — normal path
    return this._runOperation(operation);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Transition from OPEN → HALF_OPEN once the cooldown has elapsed.
   * @private
   */
  _maybeTransitionToHalfOpen() {
    if (
      this._state === STATES.OPEN &&
      this._openedAt !== null &&
      Date.now() - this._openedAt >= this.cooldownMs
    ) {
      this._state = STATES.HALF_OPEN;
      this._probeInFlight = false;
    }
  }

  /**
   * Run the operation in CLOSED state, recording failures.
   * @private
   */
  async _runOperation(operation) {
    try {
      const result = await operation();
      return result;
    } catch (err) {
      this._recordFailure();
      throw err;
    }
  }

  /**
   * Run the single probe in HALF_OPEN state.
   * Success → CLOSED; failure → OPEN.
   * @private
   */
  async _runProbe(operation) {
    this._probeInFlight = true;
    try {
      const result = await operation();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onProbeFailure();
      throw err;
    }
  }

  /**
   * Record a failure timestamp and open the circuit if the threshold is reached.
   * @private
   */
  _recordFailure() {
    const now = Date.now();
    this._failures.push(now);
    this._pruneWindow();
    if (this._failures.length >= this.failureThreshold) {
      this._open();
    }
  }

  /** @private */
  _open() {
    this._state = STATES.OPEN;
    this._openedAt = Date.now();
    this._probeInFlight = false;
  }

  /** @private */
  _onSuccess() {
    this._state = STATES.CLOSED;
    this._failures = [];
    this._openedAt = null;
    this._probeInFlight = false;
  }

  /** @private */
  _onProbeFailure() {
    this._open();
  }

  /**
   * Remove failure timestamps outside the sliding window.
   * @private
   */
  _pruneWindow() {
    const cutoff = Date.now() - this.windowMs;
    this._failures = this._failures.filter(t => t > cutoff);
  }
}

module.exports = { CircuitBreaker, STATES };
