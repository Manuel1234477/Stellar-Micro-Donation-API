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
 */

const log = require('../utils/log');

const MIN_BASELINE_REQUESTS = 10;
const SPIKE_MULTIPLIER = 3;
const OFF_HOURS_START = 22; // 22:00 UTC
const OFF_HOURS_END = 6;    // 06:00 UTC

class AnomalyDetectionService {
  constructor() {
    /**
     * Per-key usage history.
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
    // Lazy-loaded to avoid circular dependency issues in test environments
    this._webhookService = null;
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

    if (!this._history.has(keyId)) this._history.set(keyId, []);
    this._history.get(keyId).push({ ip, country, hour, timestamp: ts, endpoint });

    const history = this._history.get(keyId);
    if (history.length < MIN_BASELINE_REQUESTS) return [];

    const detected = this._detect(keyId, history, { ip, country, hour, timestamp: ts, endpoint });

    if (detected.length > 0) {
      if (!this._anomalies.has(keyId)) this._anomalies.set(keyId, []);
      for (const a of detected) {
        this._anomalies.get(keyId).push({ ...a, timestamp: ts });
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
      // Flag if off-hours was rare in baseline (<10%)
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
      // Lazy-load WebhookService to avoid parse errors in test environments
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
   * Get anomaly history for a key.
   * @param {string} keyId
   * @returns {Array<{type: string, detail: string, timestamp: number}>}
   */
  getAnomalies(keyId) {
    return this._anomalies.get(keyId) || [];
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
