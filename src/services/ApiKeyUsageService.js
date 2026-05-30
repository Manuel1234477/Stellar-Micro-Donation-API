/**
 * ApiKeyUsageService
 * In-memory store for API key usage analytics.
 *
 * Tracks per-request metrics (timestamp, latency, status code) and exposes
 * aggregated time-series data at hourly, daily, and weekly granularity.
 * Also provides anomaly detection for unusual request-rate spikes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;

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

    this._purgeKey(apiKey);
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  /**
   * Get overall usage summary for an API key.
   * @param {string} apiKey
   * @param {object} [options]
   * @param {number} [options.from] - Start timestamp (ms)
   * @param {number} [options.to]   - End timestamp (ms)
   * @returns {{ apiKey: string, totalRequests: number, errorCount: number, errorRate: number, avgLatencyMs: number }}
   */
  getSummary(apiKey, { from = 0, to = Date.now() } = {}) {
    this._assertKey(apiKey);
    const records = this._filterRecords(apiKey, from, to);
    return this._summarise(apiKey, records);
  }

  /**
   * Get per-endpoint analytics for an API key over the last 30 days.
   * @param {string} apiKey
   * @param {object} [options]
   * @param {number} [options.from] - Start timestamp (ms)
   * @param {number} [options.to]   - End timestamp (ms)
   * @returns {{ apiKey: string, from: number, to: number, endpoints: Array<object> }}
   */
  getAnalytics(apiKey, { from = Date.now() - RETENTION_MS, to = Date.now() } = {}) {
    this._assertKey(apiKey);
    const records = this._filterRecords(apiKey, from, to);

    const endpoints = new Map();
    for (const record of records) {
      const key = `${record.method} ${record.path}`;
      if (!endpoints.has(key)) {
        endpoints.set(key, {
          path: record.path,
          method: record.method,
          totalCalls: 0,
          errorCount: 0,
          statusCodes: {},
          latencies: [],
          daily: new Map(),
        });
      }

      const endpoint = endpoints.get(key);
      endpoint.totalCalls += 1;
      if (record.statusCode >= 400) endpoint.errorCount += 1;
      endpoint.statusCodes[record.statusCode] = (endpoint.statusCodes[record.statusCode] || 0) + 1;
      endpoint.latencies.push(record.latencyMs);

      const bucket = this._bucketKey(record.timestamp, 'day');
      if (!endpoint.daily.has(bucket)) {
        endpoint.daily.set(bucket, { date: bucket, calls: 0, errors: 0, latencies: [] });
      }
      const day = endpoint.daily.get(bucket);
      day.calls += 1;
      if (record.statusCode >= 400) day.errors += 1;
      day.latencies.push(record.latencyMs);
    }

    const sortedEndpoints = Array.from(endpoints.values())
      .map(endpoint => {
        const daily = Array.from(endpoint.daily.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, bucket]) => ({
            date: bucket.date,
            calls: bucket.calls,
            errors: bucket.errors,
            errorRate: bucket.calls ? Math.round((bucket.errors / bucket.calls) * 10000) / 100 : 0,
            avgLatencyMs: bucket.calls
              ? Math.round(bucket.latencies.reduce((sum, l) => sum + l, 0) / bucket.latencies.length)
              : 0,
          }));

        const totalCalls = endpoint.totalCalls;
        const errorRate = totalCalls
          ? Math.round((endpoint.errorCount / totalCalls) * 10000) / 100
          : 0;

        return {
          path: endpoint.path,
          method: endpoint.method,
          totalCalls,
          errorCount: endpoint.errorCount,
          errorRate,
          statusCodes: endpoint.statusCodes,
          avgLatencyMs: endpoint.latencies.length
            ? Math.round(endpoint.latencies.reduce((sum, l) => sum + l, 0) / endpoint.latencies.length)
            : 0,
          daily,
        };
      })
      .sort((a, b) => b.totalCalls - a.totalCalls);

    return { apiKey, from, to, endpoints: sortedEndpoints };
  }

  /**
   * Get a latency summary for an API key over the last 30 days.
   * @param {string} apiKey
   * @param {object} [options]
   * @param {number} [options.from] - Start timestamp (ms)
   * @param {number} [options.to]   - End timestamp (ms)
   * @returns {{ apiKey: string, totalCalls: number, errorCount: number, errorRate: number, p50: number, p95: number, p99: number }}
   */
  getAnalyticsSummary(apiKey, { from = Date.now() - RETENTION_MS, to = Date.now() } = {}) {
    this._assertKey(apiKey);
    const records = this._filterRecords(apiKey, from, to);
    const totalCalls = records.length;
    const errorCount = records.filter(r => r.statusCode >= 400).length;
    const latencies = records
      .map(r => r.latencyMs)
      .sort((a, b) => a - b);

    return {
      apiKey,
      totalCalls,
      errorCount,
      errorRate: totalCalls ? Math.round((errorCount / totalCalls) * 10000) / 100 : 0,
      p50: this._percentile(latencies, 50),
      p95: this._percentile(latencies, 95),
      p99: this._percentile(latencies, 99),
    };
  }

  /**
   * Get the top endpoints across all API keys.
   * @param {object} [options]
   * @param {number} [options.from] - Start timestamp (ms)
   * @param {number} [options.to]   - End timestamp (ms)
   * @param {number} [options.limit] - Number of endpoints to return
   * @returns {Array<{path:string,method:string,totalCalls:number,errorCount:number,statusCodes:object}>}
   */
  getTopEndpoints({ from = Date.now() - RETENTION_MS, to = Date.now(), limit = 10 } = {}) {
    this._purgeOldRecords();
    const endpoints = new Map();

    for (const records of this._records.values()) {
      for (const record of records) {
        if (record.timestamp < from || record.timestamp > to) continue;

        const key = `${record.method} ${record.path}`;
        if (!endpoints.has(key)) {
          endpoints.set(key, {
            path: record.path,
            method: record.method,
            totalCalls: 0,
            errorCount: 0,
            statusCodes: {},
          });
        }

        const endpoint = endpoints.get(key);
        endpoint.totalCalls += 1;
        if (record.statusCode >= 400) endpoint.errorCount += 1;
        endpoint.statusCodes[record.statusCode] = (endpoint.statusCodes[record.statusCode] || 0) + 1;
      }
    }

    return Array.from(endpoints.values())
      .sort((a, b) => b.totalCalls - a.totalCalls)
      .slice(0, limit);
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

    const records = this._filterRecords(apiKey, from, to);

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
   * Remove expired records from the in-memory store.
   * @private
   */
  _purgeOldRecords() {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [apiKey, records] of this._records.entries()) {
      const filtered = records.filter(record => record.timestamp >= cutoff);
      if (filtered.length === 0) {
        this._records.delete(apiKey);
      } else if (filtered.length !== records.length) {
        this._records.set(apiKey, filtered);
      }
    }
  }

  /**
   * Remove expired records for a single API key.
   * @private
   */
  _purgeKey(apiKey) {
    const cutoff = Date.now() - RETENTION_MS;
    const records = this._records.get(apiKey);
    if (!records) return;

    const filtered = records.filter(record => record.timestamp >= cutoff);
    if (filtered.length === 0) {
      this._records.delete(apiKey);
    } else if (filtered.length !== records.length) {
      this._records.set(apiKey, filtered);
    }
  }

  /**
   * Filter records for a key within a date range and purge expired data.
   * @private
   */
  _filterRecords(apiKey, from = 0, to = Date.now()) {
    this._purgeOldRecords();
    const records = this._records.get(apiKey) || [];
    return records.filter(record => record.timestamp >= from && record.timestamp <= to);
  }

  /**
   * Calculate a percentile on a sorted latency array.
   * @private
   */
  _percentile(sortedValues, percentile) {
    if (!sortedValues.length) return 0;
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
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
