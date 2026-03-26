/**
 * LoadTestRunner - Concurrent HTTP load test runner for Express apps
 *
 * Runs load test scenarios against an Express app using concurrent requests,
 * collects latency measurements, and calculates performance metrics.
 * No external tools required — works with supertest in Jest.
 */
'use strict';

const request = require('supertest');

class LoadTestRunner {
  /**
   * @param {object} app - Express app instance
   * @param {object} [options]
   * @param {number} [options.concurrency=10] - Concurrent virtual users
   * @param {number} [options.iterations=50] - Total requests per scenario
   * @param {number} [options.thinkTimeMs=50] - Delay between requests per VU (ms)
   */
  constructor(app, options = {}) {
    this.app = app;
    this.concurrency = options.concurrency || 10;
    this.iterations = options.iterations || 50;
    // Use explicit undefined check so thinkTimeMs: 0 is respected (0 is falsy)
    this.thinkTimeMs = options.thinkTimeMs !== undefined ? options.thinkTimeMs : 50;
  }

  /**
   * Sleep for a given number of milliseconds
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a single request and measure latency
   * @param {Function} requestFn - async fn(request) => supertest response
   * @returns {Promise<{latencyMs: number, statusCode: number, success: boolean, error: string|null}>}
   */
  async _executeRequest(requestFn) {
    const start = Date.now();
    try {
      const res = await requestFn(request(this.app));
      const latencyMs = Date.now() - start;
      return {
        latencyMs,
        statusCode: res.status,
        // Only 2xx status codes are considered successful requests
        success: res.status >= 200 && res.status < 300,
        error: null,
      };
    } catch (err) {
      return {
        latencyMs: Date.now() - start,
        statusCode: 0,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Run a load test scenario
   * @param {object} scenario
   * @param {string} scenario.name - Scenario name
   * @param {Function} scenario.requestFn - async fn(supertestRequest) => response
   * @returns {Promise<ScenarioResult>}
   */
  async runScenario(scenario) {
    const results = [];
    const startTime = Date.now();

    // Distribute iterations across virtual users
    const iterationsPerVU = Math.ceil(this.iterations / this.concurrency);

    const vuWork = async () => {
      for (let i = 0; i < iterationsPerVU && results.length < this.iterations; i++) {
        const result = await this._executeRequest(scenario.requestFn);
        results.push(result);
        if (this.thinkTimeMs > 0) {
          await this._sleep(this.thinkTimeMs);
        }
      }
    };

    // Launch concurrent virtual users
    const vus = Array.from({ length: this.concurrency }, () => vuWork());
    await Promise.all(vus);

    const totalDurationMs = Date.now() - startTime;
    return this._computeMetrics(scenario.name, results, totalDurationMs);
  }

  /**
   * Compute performance metrics from raw results
   * @param {string} scenarioName
   * @param {Array} results
   * @param {number} totalDurationMs
   * @returns {ScenarioResult}
   */
  _computeMetrics(scenarioName, results, totalDurationMs) {
    const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.length - successCount;

    const percentile = (p) => {
      if (latencies.length === 0) return 0;
      const idx = Math.ceil((p / 100) * latencies.length) - 1;
      return latencies[Math.max(0, idx)];
    };

    return {
      scenario: scenarioName,
      totalRequests: results.length,
      successCount,
      errorCount,
      errorRate: results.length > 0 ? errorCount / results.length : 0,
      throughput: totalDurationMs > 0 ? (results.length / totalDurationMs) * 1000 : 0,
      latency: {
        min: latencies[0] || 0,
        max: latencies[latencies.length - 1] || 0,
        mean: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        p50: percentile(50),
        p95: percentile(95),
        p99: percentile(99),
      },
      durationMs: totalDurationMs,
    };
  }

  /**
   * Run multiple scenarios and return all results
   * @param {Array<object>} scenarios
   * @returns {Promise<LoadTestReport>}
   */
  async runAll(scenarios) {
    const scenarioResults = [];
    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario);
      scenarioResults.push(result);
    }
    return {
      timestamp: new Date().toISOString(),
      scenarios: scenarioResults,
    };
  }
}

module.exports = LoadTestRunner;
