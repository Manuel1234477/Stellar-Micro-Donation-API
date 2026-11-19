'use strict';

/**
 * Database diagnostics module (#1944). Query performance tracking, slow-query log and pool metrics.
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const {
  DEFAULT_POOL_MIN,
  DEFAULT_POOL_MAX,
  SLOW_QUERY_WARN_MS,
  DEFAULT_SLOW_QUERY_THRESHOLD_MS,
  DEFAULT_SLOW_QUERY_BUFFER_SIZE,
  MAX_SLOW_QUERY_ENTRIES,
  SLOW_QUERY_WINDOW_MS,
} = require('./shared');
const log = require('../log');

class DiagnosticsMethods {
  static performanceState = {
    totalQueries: 0,
    totalDurationMs: 0,
    slowQueryThresholdMs: DEFAULT_SLOW_QUERY_THRESHOLD_MS,
    slowQueryBufferSize: DEFAULT_SLOW_QUERY_BUFFER_SIZE,
    slowQueries: [],
    recentDurations: [],
  };

  /**
   * Remove durations and slow query entries that fall outside the reporting window.
   *
   * @returns {void}
   */
  static prunePerformanceState() {
    const cutoff = Date.now() - SLOW_QUERY_WINDOW_MS;
    const state = this.performanceState;

    state.recentDurations = state.recentDurations.filter(entry => entry.timestamp >= cutoff);
    state.slowQueries = state.slowQueries.filter(entry => entry.timestamp >= cutoff);
  }

  /**
   * Persist metrics for a completed query execution and log slow queries.
   *
   * @param {Object} entry - Query execution details.
   * @param {string} entry.method - Database method used.
   * @param {string} entry.sql - SQL statement executed.
   * @param {Array} [entry.params=[]] - Query parameters.
   * @param {number} entry.durationMs - Query duration in milliseconds.
   * @param {boolean} [entry.failed=false] - Whether the query ended in failure.
   * @param {boolean} [entry.timedOut=false] - Whether the query timed out.
   * @returns {void}
   */
  static recordQueryExecution({ method, sql, params = [], durationMs, failed = false, timedOut = false }) {
    const state = this.performanceState;
    const timestamp = Date.now();
    const normalizedDurationMs = Number.isFinite(durationMs) && durationMs >= 0
      ? Number(durationMs.toFixed(3))
      : 0;

    state.totalQueries += 1;
    state.totalDurationMs += normalizedDurationMs;
    state.recentDurations.push({ durationMs: normalizedDurationMs, timestamp });

    const thresholdMs = state.slowQueryThresholdMs;
    if (normalizedDurationMs > thresholdMs) {
      const slowQueryEntry = {
        sql,
        params,
        method,
        durationMs: normalizedDurationMs,
        timestamp,
        isoTimestamp: new Date(timestamp).toISOString(),
        failed,
        timedOut,
      };

      const bufferSize = Math.min(state.slowQueryBufferSize, MAX_SLOW_QUERY_ENTRIES);
      state.slowQueries.push(slowQueryEntry);
      if (state.slowQueries.length > bufferSize) {
        state.slowQueries.splice(0, state.slowQueries.length - bufferSize);
      }

      log.warn('DATABASE', 'Slow query detected', {
        method,
        durationMs: normalizedDurationMs,
        thresholdMs,
        sql,
        params,
        failed,
        timedOut,
      });
    } else if (normalizedDurationMs > SLOW_QUERY_WARN_MS) {
      // Always warn for queries exceeding 1 second regardless of configured threshold (issue #743)
      log.warn('DATABASE', 'Slow query (>1s)', {
        method,
        durationMs: normalizedDurationMs,
        sql,
        failed,
        timedOut,
      });
    }

    this.prunePerformanceState();
  }

  /**
   * Return a read-only snapshot of slow query entries from the past 24 hours.
   *
   * @param {{limit?: number}} [options={}] - Result shaping options.
   * @returns {Array<Object>} Slow queries sorted by duration descending.
   */
  static getSlowQueries(options = {}) {
    this.prunePerformanceState();

    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : this.performanceState.slowQueries.length;

    return [...this.performanceState.slowQueries]
      .sort((left, right) => right.durationMs - left.durationMs || right.timestamp - left.timestamp)
      .slice(0, limit)
      .map(entry => ({ ...entry }));
  }

  /**
   * Return aggregate query performance metrics for health checks and diagnostics.
   *
   * @returns {{thresholdMs: number, totalQueries: number, averageQueryTimeMs: number, slowQueryCount: number, recentQueryCount: number}}
   */
  static getPerformanceMetrics() {
    this.prunePerformanceState();

    const recentQueryCount = this.performanceState.recentDurations.length;
    const recentDurationTotal = this.performanceState.recentDurations.reduce(
      (sum, entry) => sum + entry.durationMs,
      0
    );

    return {
      thresholdMs: this.performanceState.slowQueryThresholdMs,
      totalQueries: this.performanceState.totalQueries,
      averageQueryTimeMs: recentQueryCount === 0
        ? 0
        : Number((recentDurationTotal / recentQueryCount).toFixed(3)),
      slowQueryCount: this.performanceState.slowQueries.length,
      recentQueryCount,
    };
  }

  /**
   * Compute aggregate query statistics including p95 and p99 latency percentiles.
   *
   * @returns {{totalQueries: number, averageDurationMs: number, p95Ms: number, p99Ms: number, slowQueryCount: number, thresholdMs: number}}
   */
  static getQueryStats() {
    this.prunePerformanceState();

    const state = this.performanceState;
    const durations = state.recentDurations.map(entry => entry.durationMs).sort((a, b) => a - b);
    const count = durations.length;

    const percentile = (p) => {
      if (count === 0) return 0;
      const idx = Math.ceil((p / 100) * count) - 1;
      return durations[Math.max(0, idx)];
    };

    const avg = count === 0 ? 0 : Number((durations.reduce((s, d) => s + d, 0) / count).toFixed(3));

    return {
      totalQueries: state.totalQueries,
      averageDurationMs: avg,
      p95Ms: percentile(95),
      p99Ms: percentile(99),
      slowQueryCount: state.slowQueries.length,
      thresholdMs: state.slowQueryThresholdMs,
    };
  }

  /**
   * Reset query performance state for test isolation and shutdown cleanup.
   *
   * @returns {void}
   */
  static resetPerformanceMetrics() {
    const config = this.getPerformanceConfiguration();
    this.performanceState = {
      totalQueries: 0,
      totalDurationMs: 0,
      slowQueryThresholdMs: config.slowQueryThresholdMs,
      slowQueryBufferSize: config.slowQueryBufferSize,
      slowQueries: [],
      recentDurations: [],
    };
  }

  static getPoolMetrics() {
    const state = this.poolState;
    const active = state.connections.filter(connection => connection.inUse).length;
    const total = state.connections.length;

    return {
      total,
      active,
      idle: total - active,
      waiting: state.waitQueue.length,
      size: state.poolSize,
      acquireTimeout: state.acquireTimeout,
      staleConnectionsReplaced: state.staleConnectionsReplaced || 0,
    };
  }

  /**
   * Return pool status including min/max config and health info (issue #631).
   *
   * @returns {{poolSize: number, poolMin: number, poolMax: number, active: number, idle: number, waiting: number, healthy: boolean}}
   */
  static getPoolStatus() {
    const state = this.poolState;
    const active = state.connections.filter(c => c.inUse).length;
    const total = state.connections.length;
    return {
      poolSize: state.poolSize,
      poolMin: state.poolMin || DEFAULT_POOL_MIN,
      poolMax: state.poolMax || DEFAULT_POOL_MAX,
      active,
      idle: total - active,
      waiting: state.waitQueue.length,
      healthy: state.initialized && !state.closing,
    };
  }
}

module.exports = DiagnosticsMethods;
