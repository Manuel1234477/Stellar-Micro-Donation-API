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

const path = require('path');
const LoadTestRunner = require('./LoadTestRunner');
const { validateReport } = require('./PerformanceBaselines');
const { generateJsonReport, generateHtmlReport } = require('./ReportGenerator');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
};

const outputDir = getArg('--output', path.join(__dirname, '../../reports/load'));
const concurrency = parseInt(getArg('--concurrency', '10'), 10);
const iterations = parseInt(getArg('--iterations', '50'), 10);

async function main() {
  console.log('\n=== Stellar Micro-Donation API — Load Tests ===');
  console.log(`Concurrency: ${concurrency} VUs | Iterations: ${iterations} per scenario\n`);

  // Load the Express app in mock mode
  const app = require('../../src/routes/app');

  const runner = new LoadTestRunner(app, { concurrency, iterations, thinkTimeMs: 10 });

  const scenarios = [
    {
      name: 'health-check',
      requestFn: (req) => req.get('/health'),
    },
    {
      name: 'balance-queries',
      requestFn: (req) => req.get('/wallets').set('X-API-Key', 'test-load-key'),
    },
    {
      name: 'stats',
      requestFn: (req) => req.get('/stats/daily').set('X-API-Key', 'test-load-key'),
    },
    {
      name: 'donation-creation',
      requestFn: (req) => req.post('/donations')
        .set('X-API-Key', 'test-load-key')
        .send({
          amount: '10.00',
          recipient: 'GBXXXXRECIPIENT1234567890XXXXXXXXXXXXXXXXXXXXXXXXXX',
          donor: 'GBXXXXDONOR1234567890XXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
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
