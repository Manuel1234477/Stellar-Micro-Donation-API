/**
 * PerformanceBaselines - Defines and validates performance thresholds
 *
 * Performance baselines for the Stellar Micro-Donation API.
 * CI load tests will fail if any threshold is exceeded.
 *
 * Baselines are defined per scenario with p50, p95, p99 latency (ms),
 * minimum throughput (req/s), and maximum error rate (0–1).
 */
'use strict';

/** @type {Object.<string, ScenarioBaseline>} */
const BASELINES = {
  'donation-creation': {
    p50LatencyMs: 200,
    p95LatencyMs: 500,
    p99LatencyMs: 1000,
    minThroughputRps: 5,
    maxErrorRate: 0.05,
  },
  'balance-queries': {
    p50LatencyMs: 100,
    p95LatencyMs: 300,
    p99LatencyMs: 600,
    minThroughputRps: 10,
    maxErrorRate: 0.02,
  },
  'stats': {
    p50LatencyMs: 150,
    p95LatencyMs: 400,
    p99LatencyMs: 800,
    minThroughputRps: 8,
    maxErrorRate: 0.02,
  },
  'health-check': {
    p50LatencyMs: 50,
    p95LatencyMs: 150,
    p99LatencyMs: 300,
    minThroughputRps: 20,
    maxErrorRate: 0.01,
  },
};

/**
 * Validate a scenario result against its baseline
 * @param {ScenarioResult} result - Result from LoadTestRunner.runScenario
 * @returns {{ passed: boolean, violations: string[] }}
 */
function validateAgainstBaseline(result) {
  const baseline = BASELINES[result.scenario];
  if (!baseline) {
    return { passed: true, violations: [], note: `No baseline defined for scenario "${result.scenario}"` };
  }

  const violations = [];

  if (result.latency.p50 > baseline.p50LatencyMs) {
    violations.push(`p50 latency ${result.latency.p50}ms exceeds baseline ${baseline.p50LatencyMs}ms`);
  }
  if (result.latency.p95 > baseline.p95LatencyMs) {
    violations.push(`p95 latency ${result.latency.p95}ms exceeds baseline ${baseline.p95LatencyMs}ms`);
  }
  if (result.latency.p99 > baseline.p99LatencyMs) {
    violations.push(`p99 latency ${result.latency.p99}ms exceeds baseline ${baseline.p99LatencyMs}ms`);
  }
  if (result.errorRate > baseline.maxErrorRate) {
    violations.push(`error rate ${(result.errorRate * 100).toFixed(1)}% exceeds baseline ${(baseline.maxErrorRate * 100).toFixed(1)}%`);
  }
  if (result.throughput < baseline.minThroughputRps) {
    violations.push(`throughput ${result.throughput.toFixed(1)} req/s below baseline ${baseline.minThroughputRps} req/s`);
  }

  return { passed: violations.length === 0, violations };
}

/**
 * Validate all scenarios in a load test report
 * @param {LoadTestReport} report
 * @returns {{ allPassed: boolean, results: Array<{ scenario: string, passed: boolean, violations: string[] }> }}
 */
function validateReport(report) {
  const results = report.scenarios.map(scenarioResult => ({
    scenario: scenarioResult.scenario,
    ...validateAgainstBaseline(scenarioResult),
  }));

  return {
    allPassed: results.every(r => r.passed),
    results,
  };
}

module.exports = { BASELINES, validateAgainstBaseline, validateReport };
