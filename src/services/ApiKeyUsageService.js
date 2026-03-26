/**
 * ApiKeyUsageService
 * In-memory store for API key usage analytics.
 *
 * Tracks per-request metrics (timestamp, latency, status code) and exposes
 * aggregated time-series data at hourly, daily, and weekly granularity.
 * Also provides anomaly detection for unusual request-rate spikes.
 */

class ApiKeyUsageService {
  constructor() {
    /**
     * Raw usage records.
     * @type {Map<string, Array<{timestamp: number, latencyMs: number, statusCode: number, path: string, method: string}>>}
     */
    this._records = new Map(); // apiKey -> records[]
  }

  // ─── Recording ─────────────────────────────────────────────────────────────

  /**
   * Record a single API request for a key.
   * @param {string} apiKey
   * @param {object} params
   * @param {number} params.latencyMs   - Request duration in milliseconds
   * @param {number} params.statusCode  - HTTP response status code
   * @param {string} [params.path]      - Request path
   * @param {string} [params.method]    - HTTP method
   * @param {number} [params.timestamp] - Unix ms timestamp (defaults to Date.now())
   */
  record(apiKey, { latencyMs, statusCode, path = '/', method = 'GET', timestamp } = {}) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('apiKey is required');
    }
    if (typeof latencyMs !== 'number' || latencyMs < 0) {
      throw new Error('latencyMs must be a non-negative number');
    }
    if (typeof statusCode !== 'number') {
      throw new Error('statusCode must be a number');
    }

    if (!this._records.has(apiKey)) {
      this._records.set(apiKey, []);
    }

    this._records.get(apiKey).push({
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      latencyMs,
      statusCode,
      path,
      method,
    });
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  /**
   * Get overall usage summary for an API key.
   * @param {string} apiKey
   * @returns {{ apiKey: string, totalRequests: number, errorCount: number, errorRate: number, avgLatencyMs: number }}
   */
  getSummary(apiKey) {
    this._assertKey(apiKey);
    const records = this._records.get(apiKey) || [];
    return this._summarise(apiKey, records);
  }

  // ─── Time-series ───────────────────────────────────────────────────────────

  /**
   * Get time-series usage data aggregated by granularity.
   * @param {string} apiKey
   * @param {'hour'|'day'|'week'} granularity
   * @param {object} [options]
   * @param {number} [options.from] - Start timestamp (ms). Defaults to 0.
   * @param {number} [options.to]   - End timestamp (ms). Defaults to Date.now().
   * @returns {Array<{ bucket: string, requests: number, errors: number, avgLatencyMs: number }>}
   */
  getTimeSeries(apiKey, granularity, { from = 0, to = Date.now() } = {}) {
    this._assertKey(apiKey);

    const validGranularities = ['hour', 'day', 'week'];
    if (!validGranularities.includes(granularity)) {
      throw new Error(`Invalid granularity: ${granularity}. Must be one of: ${validGranularities.join(', ')}`);
    }

    const records = (this._records.get(apiKey) || []).filter(
      r => r.timestamp >= from && r.timestamp <= to
    );

    // Group records into buckets
    const buckets = new Map(); // bucketKey -> records[]
    for (const r of records) {
      const key = this._bucketKey(r.timestamp, granularity);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, recs]) => ({
        bucket,
        requests: recs.length,
        errors: recs.filter(r => r.statusCode >= 400).length,
        avgLatencyMs: recs.length
          ? Math.round(recs.reduce((s, r) => s + r.latencyMs, 0) / recs.length)
          : 0,
      }));
  }

  // ─── Anomaly detection ─────────────────────────────────────────────────────

  /**
   * Detect anomalous usage patterns for an API key.
   * Flags a bucket as anomalous when its request count exceeds
   * (mean + multiplier * stddev) of all buckets in the window.
   *
   * @param {string} apiKey
   * @param {'hour'|'day'|'week'} granularity
   * @param {object} [options]
   * @param {number} [options.multiplier] - Std-dev multiplier for threshold (default 2)
   * @param {number} [options.from]
   * @param {number} [options.to]
   * @returns {{ anomalies: Array<{ bucket: string, requests: number, threshold: number }>, threshold: number }}
   */
  detectAnomalies(apiKey, granularity, { multiplier = 2, from = 0, to = Date.now() } = {}) {
    const series = this.getTimeSeries(apiKey, granularity, { from, to });

    if (series.length < 2) {
      return { anomalies: [], threshold: 0, series };
    }

    const counts = series.map(b => b.requests);
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
    const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length;
    const stddev = Math.sqrt(variance);
    const threshold = mean + multiplier * stddev;

    const anomalies = series
      .filter(b => b.requests > threshold)
      .map(b => ({ bucket: b.bucket, requests: b.requests, threshold: Math.round(threshold * 100) / 100 }));

    return { anomalies, threshold: Math.round(threshold * 100) / 100, series };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * @private
   */
  _assertKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('apiKey is required');
    }
  }

  /**
   * Build a sortable bucket key string for a timestamp.
   * @private
   */
  _bucketKey(ts, granularity) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    const year = d.getUTCFullYear();
    const month = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const hour = pad(d.getUTCHours());

    if (granularity === 'hour') return `${year}-${month}-${day}T${hour}:00Z`;
    if (granularity === 'day')  return `${year}-${month}-${day}`;
    // week — ISO week bucket: start of the week (Monday)
    const date = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
    const dow = date.getUTCDay() || 7; // Mon=1 … Sun=7
    date.setUTCDate(date.getUTCDate() - dow + 1);
    const wy = date.getUTCFullYear();
    const wm = pad(date.getUTCMonth() + 1);
    const wd = pad(date.getUTCDate());
    return `${wy}-${wm}-${wd}W`;
  }

  /**
   * Compute summary stats for a set of records.
   * @private
   */
  _summarise(apiKey, records) {
    const totalRequests = records.length;
    const errorCount = records.filter(r => r.statusCode >= 400).length;
    const avgLatencyMs = totalRequests
      ? Math.round(records.reduce((s, r) => s + r.latencyMs, 0) / totalRequests)
      : 0;
    return {
      apiKey,
      totalRequests,
      errorCount,
      errorRate: totalRequests ? Math.round((errorCount / totalRequests) * 10000) / 100 : 0,
      avgLatencyMs,
    };
  }

  /**
   * Clear all data (test helper).
   */
  _clear() {
    this._records.clear();
  }
}

// Singleton for use across middleware and routes
const instance = new ApiKeyUsageService();

module.exports = ApiKeyUsageService;
module.exports.instance = instance;
