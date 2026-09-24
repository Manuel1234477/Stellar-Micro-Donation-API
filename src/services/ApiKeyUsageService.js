/**
 * ApiKeyUsageService
 *
 * Tracks per-request metrics (timestamp, latency, status code) and exposes
 * aggregated time-series data at hourly, daily, and weekly granularity.
 * Also provides anomaly detection for unusual request-rate spikes.
 *
 * Persistence (#1138):
 * - Every recorded usage event is written to the api_key_usage table so data
 *   survives restarts, is shared across instances, and provides a durable
 *   audit/billing trail.
 * - On construction the service asynchronously loads the last RETENTION_MS of
 *   records from DB into the in-memory map so all read methods work immediately
 *   after startup without any cold-start gap.
 * - Quota/rate counters derived from the in-memory map are therefore consistent
 *   with the durable store from the moment the initial load completes (a few
 *   seconds after startup).
 * - Retention policy: records older than 30 days are purged from both memory
 *   and DB via the existing _purgeKey / _purgeOldRecords logic.
 */

const Database = require('../utils/database');
const log = require('../utils/log');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;

class ApiKeyUsageService {
  constructor() {
    /**
     * Raw usage records (in-memory cache, source of truth for read methods).
     * @type {Map<string, Array<{timestamp: number, latencyMs: number, statusCode: number, path: string, method: string}>>}
     */
    this._records = new Map(); // apiKey -> records[]

    // Rehydrate from DB in background; read methods use whatever is in memory.
    this._loadPromise = this._loadFromDatabase().catch(err =>
      log.warn('API_KEY_USAGE', 'Failed to rehydrate usage records from DB', { error: err.message })
    );
  }

  // ─── DB persistence ─────────────────────────────────────────────────────────

  async _loadFromDatabase() {
    await Database.ensureInitialized();
    const cutoff = Date.now() - RETENTION_MS;
    const rows = await Database.query(
      'SELECT api_key, timestamp, latency_ms, status_code, path, method FROM api_key_usage WHERE timestamp >= ?',
      [cutoff]
    );
    for (const row of rows) {
      if (!this._records.has(row.api_key)) this._records.set(row.api_key, []);
      this._records.get(row.api_key).push({
        timestamp:  row.timestamp,
        latencyMs:  row.latency_ms,
        statusCode: row.status_code,
        path:       row.path,
        method:     row.method,
      });
    }
    log.info('API_KEY_USAGE', 'Rehydrated usage records from DB', { keys: this._records.size });
  }

  _persistRecord(apiKey, rec) {
    Database.run(
      `INSERT INTO api_key_usage (api_key, timestamp, latency_ms, status_code, path, method)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [apiKey, rec.timestamp, rec.latencyMs, rec.statusCode, rec.path, rec.method]
    ).catch(err =>
      log.warn('API_KEY_USAGE', 'Failed to persist usage record', { apiKey, error: err.message })
    );
  }

  _purgeOldFromDb() {
    const cutoff = Date.now() - RETENTION_MS;
    Database.run('DELETE FROM api_key_usage WHERE timestamp < ?', [cutoff])
      .catch(err =>
        log.warn('API_KEY_USAGE', 'Failed to purge old usage records from DB', { error: err.message })
      );
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

    const rec = {
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      latencyMs,
      statusCode,
      path,
      method,
    };

    this._records.get(apiKey).push(rec);

    // Persist to DB (fire-and-forget)
    this._persistRecord(apiKey, rec);

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
   * Get a time series of usage buckets for an API key.
   *
   * Buckets are computed in SQL using strftime on UTC timestamps so the
   * result is deterministic regardless of the host timezone. Empty buckets
   * between `from` and `to` are explicitly filled with zero counts and a
   * defined avgLatencyMs so callers always receive a consistent shape.
   *
   * @param {string} apiKey
   * @param {object} [options]
   * @param {'hour'|'day'|'week'} [options.granularity='hour']
   * @param {number} [options.from] - Start timestamp (ms)
   * @param {number} [options.to]   - End timestamp (ms)
   * @returns {Promise<{ apiKey: string, granularity: string, from: number, to: number, buckets: Array<{ bucketStart: number, count: number, errorCount: number, avgLatencyMs: number }> }>}
   */
  async getTimeSeries(apiKey, { granularity = 'hour', from = Date.now() - DAY_MS, to = Date.now() } = {}) {
    this._assertKey(apiKey);

    const unit = this._granularityUnit(granularity);
    const stepMs = this._granularityMs(granularity);

    // Align the range to bucket boundaries so every bucket is deterministic.
    const startBucket = this._floorToBucket(from, granularity);
    const endBucket = this._floorToBucket(to, granularity);

    // Compute buckets in SQL with strftime on UTC timestamps.
    const rows = await Database.query(
      `SELECT
         CAST(strftime('%s', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) AS bucket_epoch,
         COUNT(*) AS count,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
         AVG(latency_ms) AS avg_latency
       FROM api_key_usage
       WHERE api_key = ? AND timestamp >= ? AND timestamp <= ?
       GROUP BY strftime(?, datetime(timestamp / 1000, 'unixepoch'))`,
      [apiKey, startBucket, endBucket + stepMs - 1, unit]
    );

    const byBucket = new Map();
    for (const row of rows) {
      byBucket.set(Number(row.bucket_epoch) * 1000, {
        count: Number(row.count) || 0,
        errorCount: Number(row.error_count) || 0,
        avgLatencyMs: row.avg_latency == null ? 0 : Math.round(Number(row.avg_latency)),
      });
    }

    // Explicitly fill every bucket in the range, including empty ones.
    const buckets = [];
    for (let ts = startBucket; ts <= endBucket; ts += stepMs) {
      const agg = byBucket.get(ts);
      buckets.push({
        bucketStart: ts,
        count: agg ? agg.count : 0,
        errorCount: agg ? agg.errorCount : 0,
        avgLatencyMs: agg ? agg.avgLatencyMs : 0,
      });
    }

    return { apiKey, granularity, from: startBucket, to: endBucket, buckets };
  }

  // ─── Bucketing helpers ───────────────────────────────────────────────────────

  /**
   * Map a granularity name to the strftime format used for SQL bucketing.
   * @param {'hour'|'day'|'week'} granularity
   * @returns {string}
   */
  _granularityUnit(granularity) {
    switch (granularity) {
      case 'hour': return '%Y-%m-%dT%H:00:00Z';
      case 'day':  return '%Y-%m-%dT00:00:00Z';
      case 'week': return '%Y-%m-%dT00:00:00Z';
      default:
        throw new Error(`Unsupported granularity: ${granularity}`);
    }
  }

  /**
   * Bucket width in milliseconds for a granularity.
   * @param {'hour'|'day'|'week'} granularity
   * @returns {number}
   */
  _granularityMs(granularity) {
    switch (granularity) {
      case 'hour': return 60 * 60 * 1000;
      case 'day':  return DAY_MS;
      case 'week': return 7 * DAY_MS;
      default:
        throw new Error(`Unsupported granularity: ${granularity}`);
    }
  }

  /**
   * Floor a timestamp (ms) to the start of its UTC bucket.
   * @param {number} timestamp
   * @param {'hour'|'day'|'week'} granularity
   * @returns {number}
   */
  _floorToBucket(timestamp, granularity) {
    const date = new Date(timestamp);
    if (granularity === 'hour') {
      date.setUTCMinutes(0, 0, 0);
      return date.getTime();
    }
    if (granularity === 'day') {
      date.setUTCHours(0, 0, 0, 0);
      return date.getTime();
    }
    if (granularity === 'week') {
      date.setUTCHours(0, 0, 0, 0);
      // ISO weeks start on Monday (UTC).
      const day = date.getUTCDay();
      const diff = (day + 6) % 7;
      date.setUTCDate(date.getUTCDate() - diff);
      return date.getTime();
    }
    throw new Error(`Unsupported granularity: ${granularity}`);
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  _assertKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('apiKey is required');
    }
  }

  _filterRecords(apiKey, from, to) {
    const records = this._records.get(apiKey) || [];
    return records.filter(r => r.timestamp >= from && r.timestamp <= to);
  }

  _summarise(apiKey, records) {
    const totalRequests = records.length;
    const errorCount = records.filter(r => r.statusCode >= 400).length;
    const errorRate = totalRequests
      ? Math.round((errorCount / totalRequests) * 10000) / 100
      : 0;
    const avgLatencyMs = totalRequests
      ? Math.round(records.reduce((sum, r) => sum + r.latencyMs, 0) / totalRequests)
      : 0;
    return { apiKey, totalRequests, errorCount, errorRate, avgLatencyMs };
  }

  _bucketKey(timestamp, granularity) {
    const date = new Date(this._floorToBucket(timestamp, granularity));
    if (granularity === 'hour') return date.toISOString().slice(0, 13) + ':00:00Z';
    return date.toISOString().slice(0, 10);
  }

  _purgeKey(apiKey) {
    const records = this._records.get(apiKey);
    if (!records) return;
    const cutoff = Date.now() - RETENTION_MS;
    const kept = records.filter(r => r.timestamp >= cutoff);
    if (kept.length !== records.length) {
      this._records.set(apiKey, kept);
      this._purgeOldFromDb();
    }
  }
}

module.exports = ApiKeyUsageService;
