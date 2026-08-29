#!/usr/bin/env node
/**
 * run-load-tests.js - CLI entry point for the in-process load test suite
 *
 * Runs all load test scenarios against the Express app in mock mode,
 * validates results against performance baselines, and generates reports.
 *
 * Usage:
 *   node tests/load/run-load-tests.js [--output ./reports] [--concurrency 10] [--iterations 50]
 *
 * Environment:
 *   MOCK_STELLAR=true   (automatically set — no real Stellar network required)
 *   NODE_ENV=test
 */
'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Point the database layer at a private temp DB and build its schema BEFORE the
// app is required — otherwise every request hits an empty/missing database and
// /health reports "degraded" (503), making the load gate measure a broken app
// rather than real performance. Mirrors tests/globalSetup.js.
if (!process.env.DB_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-test-db-'));
  process.env.DB_PATH = path.join(dir, 'load-test.db');
}
const LoadTestRunner = require('./LoadTestRunner');
const { validateReport, resolveBaselines, getMargins } = require('./PerformanceBaselines');
const { generateJsonReport, generateHtmlReport } = require('./ReportGenerator');

/**
 * Publish the metrics + pass/fail verdict to the GitHub Actions job summary so
 * reviewers can see the numbers on the PR even when the gate passes.
 * No-op outside Actions (GITHUB_STEP_SUMMARY unset).
 */
function writeStepSummary(report, validation) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const baselines = resolveBaselines();
  const margins = getMargins();
  const lines = [];
  lines.push('## Load test results');
  lines.push('');
  lines.push(`Verdict: ${validation.allPassed ? '✅ **PASS**' : '❌ **FAIL** — performance regressed beyond thresholds'}`);
  lines.push('');
  lines.push(`Margins applied — latency ×${margins.latency}, throughput ×${margins.throughput}, error-rate ×${margins.errorRate}`);
  lines.push('');
  lines.push('| Scenario | p50 (ms) | p95 (ms) | p99 (ms) | Throughput (req/s) | Error rate | Threshold |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of report.scenarios) {
    const b = baselines[s.scenario];
    const v = validation.results.find(r => r.scenario === s.scenario);
    const status = v && v.passed ? '✅' : (v && v.violations && v.violations.length ? '❌' : '➖');
    const ceiling = b ? `p95≤${Math.round(b.p95LatencyMs)}ms, err≤${(b.maxErrorRate * 100).toFixed(1)}%` : 'no baseline';
    lines.push(
      `| ${s.scenario} | ${s.latency.p50} | ${s.latency.p95} | ${s.latency.p99} | ` +
      `${s.throughput.toFixed(1)} | ${(s.errorRate * 100).toFixed(1)}% | ${status} ${ceiling} |`
    );
  }
  if (!validation.allPassed) {
    lines.push('');
    lines.push('### Violations');
    for (const r of validation.results) {
      if (!r.passed && r.violations && r.violations.length) {
        lines.push(`- **${r.scenario}**: ${r.violations.join('; ')}`);
      }
    }
  }
  lines.push('');
  try {
    fs.appendFileSync(summaryPath, lines.join('\n') + '\n');
  } catch (err) {
    console.warn('Could not write job summary:', err.message);
  }
}

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};

const outputDir = getArg('--output', path.join(__dirname, '../../reports/load'));
const concurrency = parseInt(getArg('--concurrency', '10'), 10);
const iterations = parseInt(getArg('--iterations', '50'), 10);
// Discarded warm-up requests per scenario absorb cold-start variance (issue #1167).
const warmup = parseInt(getArg('--warmup', '5'), 10);

async function main() {
  console.log('\n=== Stellar Micro-Donation API — Load Tests ===');
  console.log(`Concurrency: ${concurrency} VUs | Iterations: ${iterations} per scenario\n`);

  // Build the database schema before the app starts handling requests.
  try {
    const Database = require('../../src/utils/database');
    const createTestTables = require('../helpers/dbBootstrap');
    await createTestTables(Database);
  } catch (err) {
    console.warn('Could not bootstrap load-test database schema:', err.message);
  }

  // Load the Express app in mock mode
  const app = require('../../src/app');

  const runner = new LoadTestRunner(app, { concurrency, iterations, thinkTimeMs: 10, warmupIterations: warmup });

  // Representative read/write mix against the real, versioned API routes.
  // Donor/recipient are valid Stellar public keys so the write path passes
  // validation; each create uses a unique Idempotency-Key so the requests are
  // genuinely processed rather than served from the idempotency cache.
  const StellarSdk = require('stellar-sdk');
  const donor = StellarSdk.Keypair.random().publicKey();
  const recipient = StellarSdk.Keypair.random().publicKey();

  const scenarios = [
    {
      name: 'liveness',
      requestFn: (req) => req.get('/health/live'),
    },
    {
      name: 'list-donations',
      requestFn: (req) => req.get('/api/v1/donations').set('X-API-Key', 'test-load-key'),
    },
    {
      // GET /stats/summary baseline (issue #1546): 100 req/s, p95 < 200ms
      name: 'stats-summary',
      requestFn: (req) => req.get('/api/v1/stats/summary').set('X-API-Key', 'test-load-key'),
    },
    {
      name: 'donation-creation',
      requestFn: (req) => req.post('/api/v1/donations')
        .set('X-API-Key', 'test-load-key')
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          amount: '10.00',
          recipient,
          donor,
          currency: 'XLM',
        }),
    },
  ];

  const report = await runner.runAll(scenarios);

  // Print results
  for (const s of report.scenarios) {
    const { latency, errorRate, throughput, totalRequests } = s;
    console.log(`\n[${s.scenario}]`);
    console.log(`  Requests: ${totalRequests} | Throughput: ${throughput.toFixed(1)} req/s`);
    console.log(`  Latency — p50: ${latency.p50}ms | p95: ${latency.p95}ms | p99: ${latency.p99}ms`);
    console.log(`  Error rate: ${(errorRate * 100).toFixed(1)}%`);
  }

  // Validate against baselines
  const validation = validateReport(report);
  console.log('\n=== Baseline Validation ===');
  for (const r of validation.results) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`  ${icon} ${r.scenario}: ${r.passed ? 'PASSED' : r.violations.join(', ')}`);
  }

  // Generate reports
  generateJsonReport(report, path.join(outputDir, 'load-test-report.json'));
  generateHtmlReport(report, path.join(outputDir, 'load-test-report.html'));
  console.log(`\nReports written to: ${outputDir}`);

  // Publish metrics to the PR/job summary (visible even on a pass).
  writeStepSummary(report, validation);

  if (!validation.allPassed) {
    console.error('\n[FAIL] Performance baselines violated — see violations above');
    process.exit(1);
  }

  console.log('\n[PASS] All performance baselines met');
  process.exit(0);
}

main().catch(err => {
  console.error('Load test runner error:', err.message);
  process.exit(1);
});
