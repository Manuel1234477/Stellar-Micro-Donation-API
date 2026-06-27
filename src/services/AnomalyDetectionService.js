/**
 * Anomaly Detection Service
 *
 * Detects suspicious API key usage patterns by comparing current request
 * metadata against a per-key baseline. Flags:
 *   - New country/IP not seen in baseline
 *   - Volume spike (>3x hourly baseline)
 *   - Off-hours access (outside 06:00–22:00 UTC)
 *
 * Baseline cold-start: keys with fewer than MIN_BASELINE_REQUESTS samples
 * are treated as "learning" and no anomalies are raised.
 *
 * Persistence (#1137):
 * - Request history is written to anomaly_history and anomaly records to
 *   anomaly_records so state survives restarts and is consistent across
 *   instances.
 * - On construction the service asynchronously rehydrates _history and
 *   _anomalies from the last HISTORY_WINDOW_MS of DB records so there is
 *   no cold-start blind window after a deploy.
 * - Window/threshold constants (MIN_BASELINE_REQUESTS, SPIKE_MULTIPLIER,
 *   OFF_HOURS_START, OFF_HOURS_END) are defined at the top of this file and
 *   apply identically on all instances.
 */

const log = require('../utils/log');
const Database = require('../utils/database');

const MIN_BASELINE_REQUESTS = 10;
const SPIKE_MULTIPLIER = 3;
const OFF_HOURS_START = 22; // 22:00 UTC
const OFF_HOURS_END = 6;    // 06:00 UTC

// How far back to rehydrate history from DB on startup (24 h)
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

class AnomalyDetectionService {
  constructor() {
    /**
     * Per-key usage history (in-memory detection window).
     * @type {Map<string, Array<{ip: string, country: string, hour: number, timestamp: number, endpoint: string}>>}
     */
    this._history = new Map();

    /**
     * Detected anomaly records.
     * @type {Map<string, Array<{type: string, detail: string, timestamp: number}>>}
     */
    this._anomalies = new Map();

    /** Optional webhook URL for anomaly alerts. */
    this.webhookUrl = process.env.ANOMALY_WEBHOOK_URL || null;
    this._webhookService = null;

    // Rehydrate from DB in background so detection is warm after a restart
    this._loadPromise = this._loadPersistedState().catch(err =>
      log.warn('ANOMALY_DETECTION', 'Failed to rehydrate state from DB', { error: err.message })
    );
  }

  // ─── Persistence helpers ────────────────────────────────────────────────────

  async _loadPersistedState() {
    await Database.ensureInitialized();
    const cutoff = Date.now() - HISTORY_WINDOW_MS;

    // Rehydrate detection window
    const historyRows = await Database.query(
      'SELECT key_id, ip, country, hour, request_timestamp, endpoint FROM anomaly_history WHERE request_timestamp >= ?',
      [cutoff]
    );
    for (const row of historyRows) {
      if (!this._history.has(row.key_id)) this._history.set(row.key_id, []);
      this._history.get(row.key_id).push({
        ip: row.ip,
        country: row.country,
        hour: row.hour,
        timestamp: row.request_timestamp,
        endpoint: row.endpoint,
      });
    }

    // Rehydrate flagged anomalies
    const anomalyRows = await Database.query(
      'SELECT key_id, type, detail, timestamp FROM anomaly_records WHERE timestamp >= ?',
      [cutoff]
    );
    for (const row of anomalyRows) {
      if (!this._anomalies.has(row.key_id)) this._anomalies.set(row.key_id, []);
      this._anomalies.get(row.key_id).push({
        type: row.type,
        detail: row.detail,
        timestamp: row.timestamp,
      });
    }

    log.info('ANOMALY_DETECTION', 'Rehydrated state from DB', {
      historyKeys: this._history.size,
      anomalyKeys: this._anomalies.size,
    });
  }

  _persistHistoryEntry(keyId, entry) {
    const now = Date.now();
    Database.run(
      `INSERT INTO anomaly_history (key_id, ip, country, hour, request_timestamp, endpoint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [keyId, entry.ip || null, entry.country || null, entry.hour, entry.timestamp, entry.endpoint || null, now]
    ).catch(err =>
      log.warn('ANOMALY_DETECTION', 'Failed to persist history entry', { keyId, error: err.message })
    );
  }

  _persistAnomalyRecord(keyId, anomaly, ts) {
    const now = Date.now();
    Database.run(
      `INSERT INTO anomaly_records (key_id, type, detail, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [keyId, anomaly.type, anomaly.detail || null, ts, now]
    ).catch(err =>
      log.warn('ANOMALY_DETECTION', 'Failed to persist anomaly record', { keyId, error: err.message })
    );
  }

  // ─── Recording ─────────────────────────────────────────────────────────────

  /**
   * Record a request event for a key and check for anomalies.
   *
   * @param {string} keyId - API key identifier
   * @param {object} meta
   * @param {string} meta.ip       - Client IP address
   * @param {string} meta.country  - ISO-3166 country code (or 'unknown')
   * @param {string} meta.endpoint - Request path
   * @param {number} [meta.timestamp] - Unix ms (defaults to Date.now())
   * @returns {Promise<Array<{type: string, detail: string}>>} Detected anomalies (empty if none)
   */
  async record(keyId, { ip, country = 'unknown', endpoint = '/', timestamp } = {}) {
    if (!keyId) throw new Error('keyId is required');

    const ts = typeof timestamp === 'number' ? timestamp : Date.now();
    const hour = new Date(ts).getUTCHours();
    const entry = { ip, country, hour, timestamp: ts, endpoint };

    if (!this._history.has(keyId)) this._history.set(keyId, []);
    this._history.get(keyId).push(entry);

    // Persist to DB (fire-and-forget)
    this._persistHistoryEntry(keyId, entry);

    const history = this._history.get(keyId);
    if (history.length < MIN_BASELINE_REQUESTS) return [];

    const detected = this._detect(keyId, history, { ip, country, hour, timestamp: ts, endpoint });

    if (detected.length > 0) {
      if (!this._anomalies.has(keyId)) this._anomalies.set(keyId, []);
      for (const a of detected) {
        this._anomalies.get(keyId).push({ ...a, timestamp: ts });
        this._persistAnomalyRecord(keyId, a, ts);
      }
      await this._sendAlert(keyId, detected);
    }

    return detected;
  }

  // ─── Detection Logic ───────────────────────────────────────────────────────

  /**
   * Run all anomaly checks against the current event.
   * @private
   */
  _detect(keyId, history, current) {
    const anomalies = [];
    const baseline = history.slice(0, -1); // exclude current event

    // 1. New country
    const knownCountries = new Set(baseline.map(r => r.country));
    if (current.country !== 'unknown' && !knownCountries.has(current.country)) {
      anomalies.push({ type: 'NEW_COUNTRY', detail: `First request from country: ${current.country}` });
    }

    // 2. Volume spike — compare current hour count vs baseline hourly average
    const currentHourCount = history.filter(r => r.hour === current.hour).length;
    const baselineHourCounts = {};
    for (const r of baseline) {
      baselineHourCounts[r.hour] = (baselineHourCounts[r.hour] || 0) + 1;
    }
    const hourValues = Object.values(baselineHourCounts);
    if (hourValues.length > 0) {
      const avgHourly = hourValues.reduce((a, b) => a + b, 0) / hourValues.length;
      if (avgHourly > 0 && currentHourCount > avgHourly * SPIKE_MULTIPLIER) {
        anomalies.push({
          type: 'VOLUME_SPIKE',
          detail: `Hour ${current.hour} count ${currentHourCount} exceeds ${SPIKE_MULTIPLIER}x baseline avg ${avgHourly.toFixed(1)}`,
        });
      }
    }

    // 3. Off-hours access
    const h = current.hour;
    const isOffHours = h >= OFF_HOURS_START || h < OFF_HOURS_END;
    if (isOffHours) {
      const baselineOffHoursCount = baseline.filter(r => r.hour >= OFF_HOURS_START || r.hour < OFF_HOURS_END).length;
      const offHoursRatio = baselineOffHoursCount / baseline.length;
      if (offHoursRatio < 0.1) {
        anomalies.push({ type: 'OFF_HOURS_ACCESS', detail: `Request at UTC hour ${h} (off-hours)` });
      }
    }

    return anomalies;
  }

  // ─── Webhook Alert ─────────────────────────────────────────────────────────

  /**
   * Send webhook alert for detected anomalies.
   * @private
   */
  async _sendAlert(keyId, anomalies) {
    if (!this.webhookUrl) return;
    try {
      if (!this._webhookService) {
        const WebhookService = require('./WebhookService');
        this._webhookService = new WebhookService();
      }
      await this._webhookService.sendFailureNotification(this.webhookUrl, {
        event: 'api_key.anomaly_detected',
        keyId,
        anomalies,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.warn('ANOMALY_DETECTION', 'Webhook alert failed', { keyId, error: err.message });
    }
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  /**
   * Get anomaly history for a key from durable storage.
   *
   * @param {string} keyId
   * @returns {Promise<Array<{type: string, detail: string, timestamp: number}>>}
   */
  async getAnomalies(keyId) {
    try {
      const rows = await Database.query(
        'SELECT type, detail, timestamp FROM anomaly_records WHERE key_id = ? ORDER BY timestamp DESC',
        [keyId]
      );
      return rows;
    } catch (err) {
      log.warn('ANOMALY_DETECTION', 'DB query failed, falling back to memory', { keyId, error: err.message });
      return this._anomalies.get(keyId) || [];
    }
  }

  /**
   * Clear all data (useful for testing).
   */
  reset() {
    this._history.clear();
    this._anomalies.clear();
  }
}

module.exports = new AnomalyDetectionService();
module.exports.AnomalyDetectionService = AnomalyDetectionService;
