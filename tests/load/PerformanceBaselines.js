/**
 * PerformanceBaselines - Defines and validates performance thresholds
 *
 * Performance baselines (SLOs) for the Stellar Micro-Donation API. The CI
 * load-test job fails (and therefore blocks the merge) if any threshold is
 * exceeded — see .github/workflows/load-tests.yml and docs/LOAD_TESTING.md.
 *
 * Baselines are defined per scenario with p50, p95, p99 latency (ms), minimum
 * throughput (req/s), and maximum error rate (0–1).
 *
 * ── Configurability & runner variance ───────────────────────────────────────
 * Shared CI runners are noisy, so absolute latency numbers vary run-to-run.
 * Rather than hand-pick loose ceilings, the defaults below describe the target
 * behaviour and three environment variables apply a margin so the gate stays
 * meaningful without being flaky:
 *
 *   LOAD_TEST_LATENCY_MARGIN     multiply every latency ceiling (default 1.0).
 *                                e.g. 1.5 tolerates 50% slower runners.
 *   LOAD_TEST_THROUGHPUT_MARGIN  multiply every min-throughput floor
 *                                (default 1.0). e.g. 0.7 tolerates 30% lower
 *                                throughput on a slow runner.
 *   LOAD_TEST_ERROR_RATE_MARGIN  multiply every max-error-rate ceiling
 *                                (default 1.0).
 *
 * The CI workflow sets conservative margins; locally the defaults apply. To
 * change a target itself (not just tolerance), edit BASELINES below.
 */
'use strict';

/** @type {Object.<string, ScenarioBaseline>} */
const BASELINES = {
  // Write path: auth + validation + idempotency + mock submit.
  'donation-creation': {
    p50LatencyMs: 200,
    p95LatencyMs: 500,
    p99LatencyMs: 1000,
    minThroughputRps: 5,
    maxErrorRate: 0.05,
  },
  // Read path: auth + DB read + pagination + serialization.
  'list-donations': {
    p50LatencyMs: 100,
    p95LatencyMs: 300,
    p99LatencyMs: 600,
    minThroughputRps: 10,
    maxErrorRate: 0.02,
  },
  // Liveness: HTTP stack only, no auth/DB — the cheapest endpoint.
  'liveness': {
    p50LatencyMs: 50,
    p95LatencyMs: 150,
    p99LatencyMs: 300,
    minThroughputRps: 20,
    maxErrorRate: 0.01,
  },
  // Read path: auth + permission check + cached aggregation (issue #1546).
  'stats-summary': {
    p50LatencyMs: 100,
    p95LatencyMs: 250,
    p99LatencyMs: 500,
    minThroughputRps: 20,
    maxErrorRate: 0.02,
  },
};

/**
 * Issue #1546 target SLA baselines — the exact performance targets named in
 * the issue for the three primary endpoints. These are intentionally
 * SEPARATE from BASELINES above:
 *
 *   - BASELINES drives the push/PR merge gate (.github/workflows/load-tests.yml),
 *     tuned to be achievable on noisy, shared CI runners without being flaky.
 *   - NIGHTLY_TARGET_BASELINES drives the nightly regression check
 *     (.github/workflows/nightly-load-test.yml), which files a GitHub issue
 *     rather than blocking a merge — so it can safely enforce the stricter
 *     production SLA targets without risking a false-positive-blocked PR.
 *
 * Scenario keys intentionally match the BASELINES/run-load-tests.js scenario
 * names so the same LoadTestReport can be validated against either set.
 * @type {Object.<string, ScenarioBaseline>}
 */
const NIGHTLY_TARGET_BASELINES = {
  // POST /donations: 200 req/s, p95 < 150ms
  'donation-creation': {
    p50LatencyMs: 50,
    p95LatencyMs: 150,
    p99LatencyMs: 300,
    minThroughputRps: 200,
    maxErrorRate: 0.05,
  },
  // GET /donations: 500 req/s, p95 < 50ms
  'list-donations': {
    p50LatencyMs: 15,
    p95LatencyMs: 50,
    p99LatencyMs: 100,
    minThroughputRps: 500,
    maxErrorRate: 0.02,
  },
  // GET /stats/summary: 100 req/s, p95 < 200ms
  'stats-summary': {
    p50LatencyMs: 65,
    p95LatencyMs: 200,
    p99LatencyMs: 400,
    minThroughputRps: 100,
    maxErrorRate: 0.02,
  },
};

/**
 * Read the configured margins from the environment (see file header).
 * @param {Object} [env=process.env]
 * @returns {{ latency: number, throughput: number, errorRate: number }}
 */
function getMargins(env = process.env) {
  const num = (v, def) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    latency: num(env.LOAD_TEST_LATENCY_MARGIN, 1),
    throughput: num(env.LOAD_TEST_THROUGHPUT_MARGIN, 1),
    errorRate: num(env.LOAD_TEST_ERROR_RATE_MARGIN, 1),
  };
}

/**
 * Apply the configured margins to the baseline map, producing the effective
 * thresholds the gate enforces. Pure function of (baselines, env).
 * @param {Object.<string, ScenarioBaseline>} [baselines=BASELINES]
 * @param {Object} [env=process.env]
 * @returns {Object.<string, ScenarioBaseline>}
 */
function resolveBaselines(baselines = BASELINES, env = process.env) {
  const m = getMargins(env);
  const resolved = {};
  for (const [name, b] of Object.entries(baselines)) {
    resolved[name] = {
      p50LatencyMs: b.p50LatencyMs * m.latency,
      p95LatencyMs: b.p95LatencyMs * m.latency,
      p99LatencyMs: b.p99LatencyMs * m.latency,
      minThroughputRps: b.minThroughputRps * m.throughput,
      maxErrorRate: b.maxErrorRate * m.errorRate,
    };
  }
  return resolved;
}

/**
 * Validate a scenario result against its baseline
 * @param {ScenarioResult} result - Result from LoadTestRunner.runScenario
 * @param {Object.<string, ScenarioBaseline>} [baselines] - Effective thresholds
 *        (defaults to margin-resolved BASELINES).
 * @returns {{ passed: boolean, violations: string[] }}
 */
function validateAgainstBaseline(result, baselines = resolveBaselines()) {
  const baseline = baselines[result.scenario];
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
  const baselines = resolveBaselines();
  const results = report.scenarios.map(scenarioResult => ({
    scenario: scenarioResult.scenario,
    ...validateAgainstBaseline(scenarioResult, baselines),
  }));

  return {
    allPassed: results.every(r => r.passed),
    results,
  };
}

module.exports = {
  BASELINES,
  NIGHTLY_TARGET_BASELINES,
  getMargins,
  resolveBaselines,
  validateAgainstBaseline,
  validateReport,
};
