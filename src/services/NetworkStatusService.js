/**
 * NetworkStatusService
 * Polls Horizon every 30 seconds for ledger close time and fee stats.
 * Detects degradation and emits network.degraded webhook events.
 */

const EventEmitter = require('events');
const https = require('https');
const http = require('http');

const POLL_INTERVAL_MS = 30_000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Degradation thresholds */
const THRESHOLDS = {
  ledgerCloseTimeS: 10,   // seconds
  feeSurgeMultiplier: 5,  // x baseline
  errorRatePercent: 5,    // %
};

/** Baseline fee in stroops (100 stroops = 0.00001 XLM) */
const BASELINE_FEE_STROOPS = 100;

class NetworkStatusService extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.horizonUrl] - Horizon base URL
   * @param {number} [options.pollIntervalMs] - Poll interval in ms (default 30 000)
   */
  constructor(options = {}) {
    super();
    this.horizonUrl = options.horizonUrl || 'https://horizon-testnet.stellar.org';
    this.pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;

    /** @type {object|null} */
    this.currentStatus = null;
    /** @type {object[]} */
    this._history = [];
    this._timer = null;
    this._totalPolls = 0;
    this._errorPolls = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start polling. Safe to call multiple times. */
  start() {
    if (this._timer) return;
    this._poll(); // immediate first poll
    this._timer = setInterval(() => this._poll(), this.pollIntervalMs);
  }

  /** Stop polling. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Return current network status snapshot.
   * @returns {object}
   */
  getStatus() {
    return this.currentStatus || this._buildStatus({ connected: false, latencyMs: null, ledgerCloseTimeS: null, feeStroops: null, error: 'No data yet' });
  }

  /**
   * Return status snapshots from the last 24 hours.
   * @returns {object[]}
   */
  getHistory() {
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    return this._history.filter(s => new Date(s.timestamp).getTime() >= cutoff);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  async _poll() {
    this._totalPolls++;
    const start = Date.now();
    try {
      const data = await this._fetchHorizon();
      const latencyMs = Date.now() - start;
      const ledgerCloseTimeS = this._parseLedgerCloseTime(data);
      const feeStroops = this._parseFee(data);

      const status = this._buildStatus({ connected: true, latencyMs, ledgerCloseTimeS, feeStroops });
      this._saveStatus(status);
    } catch (err) {
      this._errorPolls++;
      const status = this._buildStatus({ connected: false, latencyMs: null, ledgerCloseTimeS: null, feeStroops: null, error: err.message });
      this._saveStatus(status);
    }
  }

  /**
   * Fetch ledger and fee stats from Horizon.
   * @returns {Promise<object>}
   */
  _fetchHorizon() {
    return new Promise((resolve, reject) => {
      const url = new URL('/fee_stats', this.horizonUrl);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.toString(), { timeout: 8000 }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Horizon returned HTTP ${res.statusCode}`));
          }
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Invalid JSON from Horizon')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Horizon request timed out')); });
    });
  }

  /**
   * Parse ledger close time from fee_stats response.
   * Horizon fee_stats includes last_ledger_base_fee and ledger_capacity_usage.
   * We derive close time from the ledger sequence delta if available, otherwise null.
   * @param {object} data
   * @returns {number|null}
   */
  _parseLedgerCloseTime(data) {
    // Horizon fee_stats doesn't directly expose close time; we use a separate ledger call
    // but since we only make one request, we store the last ledger and compute delta on next poll.
    const seq = parseInt(data.last_ledger, 10);
    if (!seq) return null;

    const now = Date.now();
    if (this._lastLedgerSeq && this._lastLedgerTime) {
      const seqDelta = seq - this._lastLedgerSeq;
      const timeDeltaS = (now - this._lastLedgerTime) / 1000;
      if (seqDelta > 0) {
        this._lastLedgerSeq = seq;
        this._lastLedgerTime = now;
        return parseFloat((timeDeltaS / seqDelta).toFixed(2));
      }
    }
    this._lastLedgerSeq = seq;
    this._lastLedgerTime = now;
    return null;
  }

  /**
   * Parse the mode fee from fee_stats.
   * @param {object} data
   * @returns {number|null}
   */
  _parseFee(data) {
    const fee = parseInt(data.fee_charged?.mode, 10) || parseInt(data.min_accepted_fee, 10);
    return isNaN(fee) ? null : fee;
  }

  /**
   * Build a status snapshot with degradation flag.
   * @param {object} params
   * @returns {object}
   */
  _buildStatus({ connected, latencyMs, ledgerCloseTimeS, feeStroops, error }) {
    const errorRate = this._totalPolls > 0
      ? (this._errorPolls / this._totalPolls) * 100
      : 0;

    const feeSurge = feeStroops !== null
      ? feeStroops / BASELINE_FEE_STROOPS
      : 1;

    const degraded =
      !connected ||
      (ledgerCloseTimeS !== null && ledgerCloseTimeS > THRESHOLDS.ledgerCloseTimeS) ||
      feeSurge > THRESHOLDS.feeSurgeMultiplier ||
      errorRate > THRESHOLDS.errorRatePercent;

    const feeLevel = feeSurge <= 1 ? 'normal' : feeSurge <= 3 ? 'elevated' : 'surge';

    return {
      timestamp: new Date().toISOString(),
      connected,
      latencyMs,
      ledgerCloseTimeS,
      feeStroops,
      feeLevel,
      feeSurgeMultiplier: parseFloat(feeSurge.toFixed(2)),
      errorRatePercent: parseFloat(errorRate.toFixed(2)),
      degraded,
      ...(error ? { error } : {}),
    };
  }

  /**
   * Persist status, prune old history, emit event if degraded.
   * @param {object} status
   */
  _saveStatus(status) {
    const wasDegraded = this.currentStatus?.degraded;
    this.currentStatus = status;

    // Append to history and prune
    this._history.push(status);
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    this._history = this._history.filter(s => new Date(s.timestamp).getTime() >= cutoff);

    // Emit webhook event on new degradation
    if (status.degraded && !wasDegraded) {
      this.emit('network.degraded', status);
    }
  }
}

module.exports = NetworkStatusService;
