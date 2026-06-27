/**
 * Circuit Breaker - Horizon API Protection
 *
 * Implements the circuit breaker pattern with three states:
 *  - CLOSED  : Normal operation; failures are counted.
 *  - OPEN    : Horizon is considered down; calls fail fast with 503.
 *  - HALF_OPEN: One probe request is allowed to test recovery.
 *
 * State is persisted to the circuit_breaker_state table so it survives restarts
 * and is visible to every instance in the cluster.  A background sync timer
 * (startSync) polls the DB every syncIntervalMs so that a trip on one instance
 * is honoured by the others within one sync cycle.
 *
 * Half-open probe coordination: when the circuit transitions to HALF_OPEN, the
 * first instance to call execute() claims the probe atomically via the DB
 * (probeHolder column, migration 025_circuit_breaker_probe).  Other instances
 * fast-fail until the probe completes and the circuit closes (or reopens).
 *
 * Configuration defaults (overridable via constructor options):
 *  - failureThreshold : 5  failures within windowMs opens the circuit
 *  - windowMs         : 60 000 ms (60 s) sliding failure window
 *  - cooldownMs       : 30 000 ms (30 s) before a probe is attempted
 *  - syncIntervalMs   : 5 000 ms (5 s) between DB state syncs
 */
const os = require('os');
const log = require('./log');

const STATES = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' });

/** Lazy-load Database to avoid circular deps at module load time */
function getDb() {
  try {
    return require('./database');
  } catch (_) {
    return null;
  }
}

class CircuitBreaker {
  /**
   * @param {Object} [options]
   * @param {number} [options.failureThreshold=5]  - Failures in window before opening
   * @param {number} [options.windowMs=60000]       - Sliding window length (ms)
   * @param {number} [options.cooldownMs=30000]     - Cooldown before half-open probe (ms)
   * @param {string} [options.name='horizon']       - Name used in error messages and DB key
   * @param {number} [options.syncIntervalMs=5000]  - How often to sync state from DB
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.name = options.name ?? 'horizon';
    this.syncIntervalMs = options.syncIntervalMs ?? 5_000;

    this._state = STATES.CLOSED;
    /** @type {number[]} Timestamps (ms) of recent failures within the window */
    this._failures = [];
    /** @type {number|null} When the circuit was opened */
    this._openedAt = null;
    /** @type {boolean} Whether a half-open probe is currently in-flight */
    this._probeInFlight = false;
    /** Unique per-process identifier for probe coordination */
    this._instanceId = `${os.hostname()}-${process.pid}`;
    /** Handle for the periodic DB sync interval */
    this._syncTimer = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Load persisted state from DB on startup.
   * Respects remaining cooldown so an open circuit stays open after restart.
   * Fire-and-forget errors are logged but do not throw.
   */
  async loadState() {
    try {
      const db = getDb();
      if (!db) return;
      const row = await db.get(
        'SELECT state, failureCount, lastFailureAt, openedAt FROM circuit_breaker_state WHERE name = ?',
        [this.name]
      );
      if (!row) return;

      this._openedAt = row.openedAt || null;

      if (row.state === STATES.OPEN && this._openedAt !== null) {
        const elapsed = Date.now() - this._openedAt;
        if (elapsed < this.cooldownMs) {
          this._state = STATES.OPEN;
          log.info('CIRCUIT_BREAKER', 'Restored OPEN state from DB on startup', {
            name: this.name,
            openedAt: new Date(this._openedAt).toISOString(),
            remainingCooldownMs: this.cooldownMs - elapsed,
          });
        }
        // else: cooldown already elapsed, start CLOSED
      }
    } catch (err) {
      log.error('CIRCUIT_BREAKER', 'loadState error', { name: this.name, error: err.message });
    }
  }

  /**
   * Start periodic DB polling so state changes made by other instances
   * (or after a restart) are reflected in this instance's local state.
   *
   * Uses timerRegistry so the timer is cleared at shutdown.
   * Call stopSync() to cancel explicitly (e.g. in tests).
   *
   * @param {number} [intervalMs] - Override syncIntervalMs from constructor.
   */
  startSync(intervalMs) {
    if (this._syncTimer) return;
    const ms = intervalMs || this.syncIntervalMs;
    // Lazy-require timerRegistry to break potential circular deps
    const timerRegistry = require('./timerRegistry');
    this._syncTimer = timerRegistry.createInterval(
      () => this._syncFromDb().catch(() => {}),
      ms,
      `circuit-breaker-sync-${this.name}`
    );
    this._syncTimer.unref();
  }

  /** Cancel the DB sync interval. */
  stopSync() {
    if (this._syncTimer) {
      this._syncTimer.clear();
      this._syncTimer = null;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

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
   * - HALF_OPEN : allows exactly one probe per cluster; other callers get a fast-fail
   *               until the probe resolves.
   *
   * @template T
   * @param {() => Promise<T>} operation
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
        const err = new Error(`Circuit breaker half-open: ${this.name} probe in progress`);
        err.status = 503;
        err.circuitOpen = true;
        throw err;
      }
      return this._runProbe(operation);
    }

    return this._runOperation(operation);
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   * Intended for admin endpoints.
   */
  reset() {
    this._state = STATES.CLOSED;
    this._failures = [];
    this._openedAt = null;
    this._probeInFlight = false;
    this._persistState(true);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** @private */
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

  /** @private */
  async _runOperation(operation) {
    try {
      return await operation();
    } catch (err) {
      this._recordFailure();
      throw err;
    }
  }

  /**
   * Run the probe in HALF_OPEN state.
   *
   * In-process guard: _probeInFlight = true blocks concurrent callers in this
   *   process synchronously, before any await.
   * Cross-instance guard: _writeProbeHolder() records this instance as the probe
   *   owner in the DB (fire-and-forget). Other instances learn about the in-flight
   *   probe the next time their _syncFromDb() interval fires.  There is a small
   *   window (~syncIntervalMs) during which two instances could both probe; this
   *   is acceptable — the circuit-breaker outcome is idempotent.
   * @private
   */
  async _runProbe(operation) {
    // Set in-process guard synchronously so concurrent callers in this process
    // are blocked before we even hit the first await.
    this._probeInFlight = true;

    // Best-effort: advertise our probe ownership to other cluster instances.
    // We do NOT await this — the in-process flag is the true concurrency guard.
    this._writeProbeHolder();

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
   * Fire-and-forget: write probeHolder to DB so other instances learn about the
   * in-flight probe during their next _syncFromDb() poll.
   *
   * Errors are silently swallowed — probe coordination is best-effort; the
   * in-process _probeInFlight flag is the authoritative guard within a process.
   * @private
   */
  _writeProbeHolder() {
    const db = getDb();
    if (!db) return;
    db.run(
      `UPDATE circuit_breaker_state
       SET probeHolder = ?, state = 'half_open'
       WHERE name = ? AND state IN ('open', 'half_open')
         AND (probeHolder IS NULL OR probeHolder = ?)`,
      [this._instanceId, this.name, this._instanceId]
    ).catch(() => {});
  }

  /** @private */
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
    this._persistState(false);
  }

  /** @private */
  _onSuccess() {
    this._state = STATES.CLOSED;
    this._failures = [];
    this._openedAt = null;
    this._probeInFlight = false;
    this._persistState(true); // clear probeHolder on success
  }

  /** @private */
  _onProbeFailure() {
    this._open();
  }

  /**
   * Persist current state to DB (fire-and-forget).
   * @param {boolean} clearProbeHolder - Whether to clear the probeHolder column.
   * @private
   */
  _persistState(clearProbeHolder = false) {
    const db = getDb();
    if (!db) return;
    const now = Date.now();
    const probeHolder = clearProbeHolder ? null : undefined;

    const sql = clearProbeHolder
      ? `INSERT INTO circuit_breaker_state (name, state, failureCount, lastFailureAt, openedAt, probeHolder)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(name) DO UPDATE SET
           state = excluded.state,
           failureCount = excluded.failureCount,
           lastFailureAt = excluded.lastFailureAt,
           openedAt = excluded.openedAt,
           probeHolder = NULL`
      : `INSERT INTO circuit_breaker_state (name, state, failureCount, lastFailureAt, openedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           state = excluded.state,
           failureCount = excluded.failureCount,
           lastFailureAt = excluded.lastFailureAt,
           openedAt = excluded.openedAt`;

    const params = clearProbeHolder
      ? [this.name, this._state, this._failures.length, now, this._openedAt]
      : [this.name, this._state, this._failures.length, now, this._openedAt];

    void probeHolder; // unused but documents intent
    db.run(sql, params).catch(err =>
      log.error('CIRCUIT_BREAKER', 'persistState error', { name: this.name, error: err.message })
    );
  }

  /**
   * Sync local state from the DB row written by other instances.
   * Transitions to OPEN if another instance tripped the breaker,
   * and to CLOSED if another instance's probe succeeded.
   * @private
   */
  async _syncFromDb() {
    const db = getDb();
    if (!db) return;

    try {
      const row = await db.get(
        'SELECT state, openedAt, probeHolder FROM circuit_breaker_state WHERE name = ?',
        [this.name]
      );
      if (!row) return;

      if (row.state === STATES.OPEN && this._state !== STATES.OPEN) {
        this._state = STATES.OPEN;
        this._openedAt = row.openedAt;
        this._probeInFlight = false;
        log.info('CIRCUIT_BREAKER', 'State synced from DB: OPEN (another instance tripped)', {
          name: this.name,
        });
      } else if (row.state === STATES.HALF_OPEN && this._state === STATES.OPEN) {
        this._state = STATES.HALF_OPEN;
        this._openedAt = row.openedAt;
        // If another instance holds the probe, block local probing
        if (row.probeHolder && row.probeHolder !== this._instanceId) {
          this._probeInFlight = true;
        }
      } else if (row.state === STATES.CLOSED && this._state !== STATES.CLOSED) {
        // Another instance's probe succeeded — close locally too
        this._state = STATES.CLOSED;
        this._failures = [];
        this._openedAt = null;
        this._probeInFlight = false;
        log.info('CIRCUIT_BREAKER', 'State synced from DB: CLOSED (another instance recovered)', {
          name: this.name,
        });
      }
    } catch (err) {
      log.error('CIRCUIT_BREAKER', '_syncFromDb error', { name: this.name, error: err.message });
    }
  }

  /** @private */
  _pruneWindow() {
    const cutoff = Date.now() - this.windowMs;
    this._failures = this._failures.filter(t => t > cutoff);
  }
}

module.exports = { CircuitBreaker, STATES };
