#!/usr/bin/env node
/**
 * check-load-test-regression.js - Nightly load test regression detector (Issue #1546)
 *
 * Compares a load test JSON report (from tests/load/run-load-tests.js) against
 * the production SLA targets in tests/load/PerformanceBaselines.js
 * (NIGHTLY_TARGET_BASELINES). A scenario "regresses" when its measured p95
 * latency exceeds the baseline's p95 target by more than REGRESSION_THRESHOLD_PCT.
 *
 * This is a separate, stricter check from the push/PR merge gate
 * (npm run test:load itself, validated against BASELINES) — it's designed to
 * be run nightly and to open a GitHub issue on regression rather than fail a
 * build, so .github/workflows/nightly-load-test.yml can safely use it without
 * blocking anyone's merge.
 *
 * Usage:
 *   node scripts/check-load-test-regression.js [path/to/load-test-report.json]
 *
 * Writes reports/load/regressions.json (or alongside the given report) and
 * exits 0 regardless of outcome — the caller decides what to do with
 * `regressions` / the `has_regressions` GITHUB_OUTPUT it appends when running
 * inside GitHub Actions.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { NIGHTLY_TARGET_BASELINES } = require('../tests/load/PerformanceBaselines');

/** Issue #1546: file a regression issue when p95 latency exceeds the baseline by more than this. */
const REGRESSION_THRESHOLD_PCT = 20;

/**
 * Compute regressions in a load test report against a set of baselines.
 * @param {{scenarios: Array<{scenario: string, latencyMs?: {p95:number}, latency?: {p95:number}, throughputRps?: number, throughput?: number}>}} report
 * @param {Object.<string, {p95LatencyMs: number, minThroughputRps: number}>} [baselines]
 * @returns {Array<{scenario: string, metric: string, baseline: number, actual: number, pctOver: number}>}
 */
function computeRegressions(report, baselines = NIGHTLY_TARGET_BASELINES) {
  const regressions = [];

  for (const scenario of (report && report.scenarios) || []) {
    const baseline = baselines[scenario.scenario];
    if (!baseline) continue; // no target defined for this scenario — nothing to compare

    const actualP95 = scenario.latencyMs ? scenario.latencyMs.p95 : (scenario.latency && scenario.latency.p95);
    if (typeof actualP95 !== 'number') continue;

    const pctOver = ((actualP95 - baseline.p95LatencyMs) / baseline.p95LatencyMs) * 100;
    if (pctOver > REGRESSION_THRESHOLD_PCT) {
      regressions.push({
        scenario: scenario.scenario,
        metric: 'p95LatencyMs',
        baseline: baseline.p95LatencyMs,
        actual: actualP95,
        pctOver: parseFloat(pctOver.toFixed(1)),
      });
    }
  }

  return regressions;
}

function main() {
  const reportPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'reports', 'load', 'load-test-report.json'));

  if (!fs.existsSync(reportPath)) {
    console.error(`[check-load-test-regression] Report not found at ${reportPath}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const regressions = computeRegressions(report);

  const outPath = path.join(path.dirname(reportPath), 'regressions.json');
  fs.writeFileSync(outPath, JSON.stringify({
    checkedAt: new Date().toISOString(),
    thresholdPct: REGRESSION_THRESHOLD_PCT,
    regressions,
  }, null, 2), 'utf8');

  if (regressions.length > 0) {
    console.log(`\n[REGRESSION] ${regressions.length} scenario(s) exceed baseline p95 by more than ${REGRESSION_THRESHOLD_PCT}%:`);
    for (const r of regressions) {
      console.log(`  - ${r.scenario}: ${r.metric} ${r.actual}ms vs baseline ${r.baseline}ms (+${r.pctOver}%)`);
    }
  } else {
    console.log(`\n[OK] No scenario exceeds its nightly SLA target by more than ${REGRESSION_THRESHOLD_PCT}%.`);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_regressions=${regressions.length > 0}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { computeRegressions, REGRESSION_THRESHOLD_PCT };
