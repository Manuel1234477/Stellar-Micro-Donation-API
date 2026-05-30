/**
 * Load Testing Suite Tests
 *
 * COVERAGE:
 * - LoadTestRunner: construction, request execution, metric computation, concurrent scenarios
 * - PerformanceBaselines: threshold definitions, violation detection, report validation
 * - ReportGenerator: JSON and HTML report generation, file output
 * - Integration: concurrent requests against real Express app, latency/error measurement
 * - Edge cases: zero results, all failures, unknown scenarios, empty reports
 *
 * MINIMUM COVERAGE: 95%
 * No live Stellar network required (MockStellarService used)
 */
'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const LoadTestRunner = require('../load/LoadTestRunner');
const { BASELINES, validateAgainstBaseline, validateReport } = require('../load/PerformanceBaselines');
const { generateJsonReport, generateHtmlReport } = require('../load/ReportGenerator');

// ---------------------------------------------------------------------------
// Minimal Express app for integration testing (no DB or Stellar calls needed)
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/wallets', (req, res) => {
    res.json({ success: true, data: [] });
  });

  app.get('/stats/daily', (req, res) => {
    res.json({ success: true, data: { daily: [] } });
  });

  app.post('/donations', (req, res) => {
    const { amount, recipient } = req.body || {};
    if (!amount || !recipient) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'amount and recipient required' } });
    }
    res.status(201).json({
      success: true,
      data: { id: 'txn-test-123', amount, recipient, status: 'pending' },
    });
  });

  app.get('/slow', (req, res) => {
    setTimeout(() => res.json({ ok: true }), 200);
  });

  app.get('/error', (req, res) => {
    res.status(500).json({ success: false, error: 'Internal error' });
  });

  return app;
}

const testApp = createTestApp();

// ---------------------------------------------------------------------------
// LoadTestRunner Tests
// ---------------------------------------------------------------------------

describe('LoadTestRunner', () => {
  describe('constructor', () => {
    test('uses default options when none provided', () => {
      const runner = new LoadTestRunner(testApp);
      expect(runner.concurrency).toBe(10);
      expect(runner.iterations).toBe(50);
      expect(runner.thinkTimeMs).toBe(50);
    });

    test('applies custom options', () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 5, iterations: 20, thinkTimeMs: 0 });
      expect(runner.concurrency).toBe(5);
      expect(runner.iterations).toBe(20);
      expect(runner.thinkTimeMs).toBe(0);
    });

    test('stores app reference', () => {
      const runner = new LoadTestRunner(testApp);
      expect(runner.app).toBe(testApp);
    });
  });

  describe('_sleep', () => {
    test('resolves after given milliseconds', async () => {
      const runner = new LoadTestRunner(testApp);
      const start = Date.now();
      await runner._sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });

    test('resolves immediately for 0ms', async () => {
      const runner = new LoadTestRunner(testApp);
      const start = Date.now();
      await runner._sleep(0);
      expect(Date.now() - start).toBeLessThan(50);
    });
  });

  describe('_executeRequest', () => {
    test('returns latencyMs, statusCode, success=true for 200 responses', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 1, iterations: 1, thinkTimeMs: 0 });
      const result = await runner._executeRequest(req => req.get('/health'));
      expect(result.statusCode).toBe(200);
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeNull();
    });

    test('returns success=true for 201 responses', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 1, iterations: 1, thinkTimeMs: 0 });
      const result = await runner._executeRequest(req =>
        req.post('/donations').send({ amount: '5.00', recipient: 'GXXXXXXXX' })
      );
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
    });

    test('returns success=false for 500 responses', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 1, iterations: 1, thinkTimeMs: 0 });
      const result = await runner._executeRequest(req => req.get('/error'));
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    test('returns success=false for 400 responses', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 1, iterations: 1, thinkTimeMs: 0 });
      const result = await runner._executeRequest(req =>
        req.post('/donations').send({})
      );
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    test('handles request errors gracefully', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 1, iterations: 1, thinkTimeMs: 0 });
      const result = await runner._executeRequest(() => Promise.reject(new Error('connection refused')));
      expect(result.success).toBe(false);
      expect(result.error).toBe('connection refused');
      expect(result.statusCode).toBe(0);
    });
  });

  describe('_computeMetrics', () => {
    test('computes correct percentiles for sorted latencies', () => {
      const runner = new LoadTestRunner(testApp);
      const results = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(ms => ({
        latencyMs: ms, statusCode: 200, success: true, error: null,
      }));
      const metrics = runner._computeMetrics('test-scenario', results, 1000);
      expect(metrics.scenario).toBe('test-scenario');
      expect(metrics.totalRequests).toBe(10);
      expect(metrics.successCount).toBe(10);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.latency.p50).toBeGreaterThanOrEqual(40);
      expect(metrics.latency.p50).toBeLessThanOrEqual(60);
      expect(metrics.latency.p95).toBeGreaterThanOrEqual(90);
      expect(metrics.latency.p99).toBe(100);
      expect(metrics.latency.min).toBe(10);
      expect(metrics.latency.max).toBe(100);
      expect(metrics.throughput).toBe(10); // 10 req / 1s
    });

    test('computes error rate correctly', () => {
      const runner = new LoadTestRunner(testApp);
      const results = [
        { latencyMs: 50, statusCode: 200, success: true, error: null },
        { latencyMs: 60, statusCode: 200, success: true, error: null },
        { latencyMs: 70, statusCode: 500, success: false, error: null },
        { latencyMs: 80, statusCode: 500, success: false, error: null },
      ];
      const metrics = runner._computeMetrics('test', results, 500);
      expect(metrics.errorRate).toBe(0.5);
      expect(metrics.errorCount).toBe(2);
      expect(metrics.successCount).toBe(2);
    });

    test('handles empty results array', () => {
      const runner = new LoadTestRunner(testApp);
      const metrics = runner._computeMetrics('empty', [], 100);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.latency.p50).toBe(0);
      expect(metrics.latency.p95).toBe(0);
      expect(metrics.latency.p99).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.throughput).toBe(0);
    });

    test('handles single result', () => {
      const runner = new LoadTestRunner(testApp);
      const results = [{ latencyMs: 42, statusCode: 200, success: true, error: null }];
      const metrics = runner._computeMetrics('single', results, 100);
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.latency.p50).toBe(42);
      expect(metrics.latency.p99).toBe(42);
    });
  });

  describe('runScenario', () => {
    test('runs requested number of iterations and returns ScenarioResult', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 3, iterations: 9, thinkTimeMs: 0 });
      const result = await runner.runScenario({
        name: 'health-check',
        requestFn: req => req.get('/health'),
      });
      expect(result.scenario).toBe('health-check');
      expect(result.totalRequests).toBeGreaterThan(0);
      expect(result.totalRequests).toBeLessThanOrEqual(12); // rounding with concurrency
      expect(result.latency).toBeDefined();
      expect(result.latency.p95).toBeGreaterThanOrEqual(0);
      expect(result.errorRate).toBeGreaterThanOrEqual(0);
      expect(result.throughput).toBeGreaterThan(0);
    }, 15000);

    test('reports low error rate for healthy endpoint', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 5, iterations: 20, thinkTimeMs: 0 });
      const result = await runner.runScenario({
        name: 'health-check',
        requestFn: req => req.get('/health'),
      });
      expect(result.errorRate).toBeLessThan(0.1);
    }, 15000);

    test('reports high error rate for error endpoint', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 3, iterations: 9, thinkTimeMs: 0 });
      const result = await runner.runScenario({
        name: 'error-endpoint',
        requestFn: req => req.get('/error'),
      });
      expect(result.errorRate).toBeGreaterThan(0.5);
    }, 15000);

    test('measures latency for slow endpoint (>100ms)', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 2, iterations: 4, thinkTimeMs: 0 });
      const result = await runner.runScenario({
        name: 'slow',
        requestFn: req => req.get('/slow'),
      });
      expect(result.latency.mean).toBeGreaterThanOrEqual(100);
    }, 20000);
  });

  describe('runAll', () => {
    test('runs multiple scenarios and returns report with all results', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 2, iterations: 4, thinkTimeMs: 0 });
      const report = await runner.runAll([
        { name: 'health-check', requestFn: req => req.get('/health') },
        { name: 'balance-queries', requestFn: req => req.get('/wallets') },
      ]);
      expect(report.scenarios).toHaveLength(2);
      expect(report.timestamp).toBeDefined();
      expect(report.scenarios[0].scenario).toBe('health-check');
      expect(report.scenarios[1].scenario).toBe('balance-queries');
    }, 20000);

    test('returns empty scenarios array for empty input', async () => {
      const runner = new LoadTestRunner(testApp, { concurrency: 1, iterations: 1, thinkTimeMs: 0 });
      const report = await runner.runAll([]);
      expect(report.scenarios).toHaveLength(0);
      expect(report.timestamp).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// PerformanceBaselines Tests
// ---------------------------------------------------------------------------

describe('PerformanceBaselines', () => {
  describe('BASELINES', () => {
    test('defines baseline for donation-creation', () => {
      expect(BASELINES['donation-creation']).toBeDefined();
      expect(BASELINES['donation-creation'].p95LatencyMs).toBeGreaterThan(0);
      expect(BASELINES['donation-creation'].maxErrorRate).toBeGreaterThan(0);
      expect(BASELINES['donation-creation'].minThroughputRps).toBeGreaterThan(0);
    });

    test('defines baseline for balance-queries', () => {
      expect(BASELINES['balance-queries']).toBeDefined();
      expect(BASELINES['balance-queries'].p95LatencyMs).toBeLessThan(BASELINES['donation-creation'].p95LatencyMs);
    });

    test('defines baseline for stats', () => {
      expect(BASELINES['stats']).toBeDefined();
    });

    test('defines baseline for health-check', () => {
      expect(BASELINES['health-check']).toBeDefined();
      expect(BASELINES['health-check'].p95LatencyMs).toBeLessThan(BASELINES['donation-creation'].p95LatencyMs);
    });

    test('all baselines have required fields', () => {
      for (const [name, baseline] of Object.entries(BASELINES)) {
        expect(baseline.p50LatencyMs).toBeDefined();
        expect(baseline.p95LatencyMs).toBeDefined();
        expect(baseline.p99LatencyMs).toBeDefined();
        expect(baseline.minThroughputRps).toBeDefined();
        expect(baseline.maxErrorRate).toBeDefined();
        expect(baseline.p50LatencyMs).toBeLessThan(baseline.p95LatencyMs);
        expect(baseline.p95LatencyMs).toBeLessThan(baseline.p99LatencyMs);
      }
    });
  });

  describe('validateAgainstBaseline', () => {
    const goodResult = {
      scenario: 'donation-creation',
      totalRequests: 100,
      errorRate: 0.01,
      throughput: 20,
      latency: { p50: 100, p95: 300, p99: 500, mean: 150, min: 50, max: 800 },
    };

    test('passes when all metrics are within baseline', () => {
      const { passed, violations } = validateAgainstBaseline(goodResult);
      expect(passed).toBe(true);
      expect(violations).toHaveLength(0);
    });

    test('fails when p95 latency exceeds baseline', () => {
      const result = { ...goodResult, latency: { ...goodResult.latency, p95: 9999 } };
      const { passed, violations } = validateAgainstBaseline(result);
      expect(passed).toBe(false);
      expect(violations.some(v => v.includes('p95'))).toBe(true);
    });

    test('fails when p99 latency exceeds baseline', () => {
      const result = { ...goodResult, latency: { ...goodResult.latency, p99: 99999 } };
      const { passed, violations } = validateAgainstBaseline(result);
      expect(passed).toBe(false);
      expect(violations.some(v => v.includes('p99'))).toBe(true);
    });

    test('fails when p50 latency exceeds baseline', () => {
      const result = { ...goodResult, latency: { ...goodResult.latency, p50: 9999 } };
      const { passed, violations } = validateAgainstBaseline(result);
      expect(passed).toBe(false);
      expect(violations.some(v => v.includes('p50'))).toBe(true);
    });

    test('fails when error rate exceeds baseline', () => {
      const result = { ...goodResult, errorRate: 0.99 };
      const { passed, violations } = validateAgainstBaseline(result);
      expect(passed).toBe(false);
      expect(violations.some(v => v.includes('error rate'))).toBe(true);
    });

    test('fails when throughput is below baseline', () => {
      const result = { ...goodResult, throughput: 0.001 };
      const { passed, violations } = validateAgainstBaseline(result);
      expect(passed).toBe(false);
      expect(violations.some(v => v.includes('throughput'))).toBe(true);
    });

    test('can have multiple violations', () => {
      const result = {
        ...goodResult,
        errorRate: 0.99,
        throughput: 0.001,
        latency: { p50: 9999, p95: 9999, p99: 9999, mean: 9999, min: 100, max: 9999 },
      };
      const { violations } = validateAgainstBaseline(result);
      expect(violations.length).toBeGreaterThan(1);
    });

    test('returns passed=true with note for unknown scenario', () => {
      const result = { ...goodResult, scenario: 'unknown-scenario' };
      const { passed } = validateAgainstBaseline(result);
      expect(passed).toBe(true);
    });
  });

  describe('validateReport', () => {
    test('returns allPassed=true when all scenarios pass', () => {
      const report = {
        timestamp: new Date().toISOString(),
        scenarios: [
          {
            scenario: 'health-check',
            totalRequests: 50,
            errorRate: 0.0,
            throughput: 50,
            latency: { p50: 10, p95: 30, p99: 50, mean: 15, min: 5, max: 80 },
          },
        ],
      };
      const { allPassed, results } = validateReport(report);
      expect(allPassed).toBe(true);
      expect(results[0].passed).toBe(true);
    });

    test('returns allPassed=false when any scenario fails', () => {
      const report = {
        timestamp: new Date().toISOString(),
        scenarios: [
          {
            scenario: 'health-check',
            totalRequests: 50,
            errorRate: 0.0,
            throughput: 50,
            latency: { p50: 10, p95: 30, p99: 50, mean: 15, min: 5, max: 80 },
          },
          {
            scenario: 'donation-creation',
            totalRequests: 50,
            errorRate: 0.99, // violation
            throughput: 0.001, // violation
            latency: { p50: 9999, p95: 9999, p99: 9999, mean: 9999, min: 100, max: 9999 },
          },
        ],
      };
      const { allPassed, results } = validateReport(report);
      expect(allPassed).toBe(false);
      expect(results[1].passed).toBe(false);
      expect(results[1].violations.length).toBeGreaterThan(0);
    });

    test('returns empty results for report with no scenarios', () => {
      const report = { timestamp: new Date().toISOString(), scenarios: [] };
      const { allPassed, results } = validateReport(report);
      expect(allPassed).toBe(true);
      expect(results).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// ReportGenerator Tests
// ---------------------------------------------------------------------------

describe('ReportGenerator', () => {
  const sampleReport = {
    timestamp: '2026-01-01T00:00:00.000Z',
    scenarios: [
      {
        scenario: 'health-check',
        totalRequests: 100,
        successCount: 99,
        errorCount: 1,
        errorRate: 0.01,
        throughput: 25.5,
        durationMs: 3922,
        latency: { p50: 20, p95: 60, p99: 100, mean: 25, min: 5, max: 150 },
      },
      {
        scenario: 'donation-creation',
        totalRequests: 50,
        successCount: 48,
        errorCount: 2,
        errorRate: 0.04,
        throughput: 8.2,
        durationMs: 6098,
        latency: { p50: 90, p95: 280, p99: 450, mean: 110, min: 30, max: 600 },
      },
    ],
  };

  describe('generateJsonReport', () => {
    test('returns object with generatedAt, passed, and scenarios', () => {
      const report = generateJsonReport(sampleReport);
      expect(report.generatedAt).toBeDefined();
      expect(typeof report.passed).toBe('boolean');
      expect(report.scenarios).toHaveLength(2);
    });

    test('scenario entries have required fields', () => {
      const report = generateJsonReport(sampleReport);
      const s = report.scenarios[0];
      expect(s.scenario).toBe('health-check');
      expect(s.totalRequests).toBe(100);
      expect(s.errorRate).toBeDefined();
      expect(s.throughputRps).toBeDefined();
      expect(s.latencyMs.p50).toBeDefined();
      expect(s.latencyMs.p95).toBeDefined();
      expect(s.latencyMs.p99).toBeDefined();
      expect(Array.isArray(s.baselineViolations)).toBe(true);
    });

    test('writes JSON file when outputPath is provided', () => {
      const tmpFile = path.join(os.tmpdir(), `load-report-${Date.now()}.json`);
      generateJsonReport(sampleReport, tmpFile);
      expect(fs.existsSync(tmpFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      expect(content.scenarios).toHaveLength(2);
      fs.unlinkSync(tmpFile);
    });

    test('creates output directory if it does not exist', () => {
      const tmpDir = path.join(os.tmpdir(), `load-test-reports-${Date.now()}`);
      const tmpFile = path.join(tmpDir, 'report.json');
      generateJsonReport(sampleReport, tmpFile);
      expect(fs.existsSync(tmpFile)).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });

    test('handles empty scenarios array', () => {
      const emptyReport = { timestamp: '2026-01-01T00:00:00.000Z', scenarios: [] };
      const result = generateJsonReport(emptyReport);
      expect(result.scenarios).toHaveLength(0);
      expect(result.passed).toBe(true);
    });
  });

  describe('generateHtmlReport', () => {
    test('returns non-empty HTML string', () => {
      const html = generateHtmlReport(sampleReport);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(100);
    });

    test('contains DOCTYPE and html tags', () => {
      const html = generateHtmlReport(sampleReport);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
    });

    test('contains scenario names', () => {
      const html = generateHtmlReport(sampleReport);
      expect(html).toContain('health-check');
      expect(html).toContain('donation-creation');
    });

    test('contains PASSED or FAILED status', () => {
      const html = generateHtmlReport(sampleReport);
      expect(html).toMatch(/PASSED|FAILED/);
    });

    test('writes HTML file when outputPath is provided', () => {
      const tmpFile = path.join(os.tmpdir(), `load-report-${Date.now()}.html`);
      generateHtmlReport(sampleReport, tmpFile);
      expect(fs.existsSync(tmpFile)).toBe(true);
      const content = fs.readFileSync(tmpFile, 'utf8');
      expect(content).toContain('<html');
      fs.unlinkSync(tmpFile);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration Tests — concurrent requests against real Express test app
// ---------------------------------------------------------------------------

describe('Integration: load test scenarios against test app', () => {
  test('donation creation scenario collects valid metrics', async () => {
    const runner = new LoadTestRunner(testApp, { concurrency: 5, iterations: 15, thinkTimeMs: 0 });
    const result = await runner.runScenario({
      name: 'donation-creation',
      requestFn: req => req.post('/donations').send({ amount: '10.00', recipient: 'GXXXX' }),
    });
    expect(result.totalRequests).toBeGreaterThan(0);
    expect(result.latency.p95).toBeLessThan(2000);
    expect(typeof result.throughput).toBe('number');
    expect(result.throughput).toBeGreaterThan(0);
  }, 20000);

  test('balance-queries scenario (wallets endpoint) has low error rate', async () => {
    const runner = new LoadTestRunner(testApp, { concurrency: 5, iterations: 15, thinkTimeMs: 0 });
    const result = await runner.runScenario({
      name: 'balance-queries',
      requestFn: req => req.get('/wallets'),
    });
    expect(result.errorRate).toBeLessThan(0.1);
    expect(result.latency.p95).toBeLessThan(2000);
  }, 20000);

  test('stats scenario has acceptable latency under low load', async () => {
    const runner = new LoadTestRunner(testApp, { concurrency: 3, iterations: 9, thinkTimeMs: 0 });
    const result = await runner.runScenario({
      name: 'stats',
      requestFn: req => req.get('/stats/daily'),
    });
    expect(result.latency.p95).toBeLessThan(2000);
    expect(result.errorRate).toBeLessThan(0.1);
  }, 20000);

  test('runAll returns metrics for all three core scenarios', async () => {
    const runner = new LoadTestRunner(testApp, { concurrency: 2, iterations: 6, thinkTimeMs: 0 });
    const report = await runner.runAll([
      { name: 'health-check', requestFn: req => req.get('/health') },
      { name: 'balance-queries', requestFn: req => req.get('/wallets') },
      { name: 'stats', requestFn: req => req.get('/stats/daily') },
    ]);
    expect(report.scenarios).toHaveLength(3);
    for (const s of report.scenarios) {
      expect(s.totalRequests).toBeGreaterThan(0);
      expect(s.latency.p95).toBeDefined();
      expect(s.throughput).toBeGreaterThan(0);
    }
  }, 30000);

  test('report passes validation for well-behaved test app', async () => {
    const runner = new LoadTestRunner(testApp, { concurrency: 2, iterations: 6, thinkTimeMs: 0 });
    const report = await runner.runAll([
      { name: 'health-check', requestFn: req => req.get('/health') },
    ]);
    const jsonReport = generateJsonReport(report);
    expect(jsonReport.scenarios[0].scenario).toBe('health-check');
    // The test app is fast so no p95 violations expected
    expect(report.scenarios[0].latency.p95).toBeLessThan(BASELINES['health-check'].p95LatencyMs);
  }, 20000);
});

// ---------------------------------------------------------------------------
// CI Integration Tests — validate CI workflow artifacts exist
// ---------------------------------------------------------------------------

describe('CI integration', () => {
  test('Artillery config files exist for all three scenarios', () => {
    const artilleryDir = path.join(__dirname, 'load', 'artillery');
    expect(fs.existsSync(path.join(artilleryDir, 'donation-creation.yml'))).toBe(true);
    expect(fs.existsSync(path.join(artilleryDir, 'balance-queries.yml'))).toBe(true);
    expect(fs.existsSync(path.join(artilleryDir, 'stats.yml'))).toBe(true);
  });

  test('run-load-tests.js entry point exists', () => {
    expect(fs.existsSync(path.join(__dirname, 'load', 'run-load-tests.js'))).toBe(true);
  });

  test('PerformanceBaselines.js exports BASELINES, validateAgainstBaseline, validateReport', () => {
    expect(typeof BASELINES).toBe('object');
    expect(typeof validateAgainstBaseline).toBe('function');
    expect(typeof validateReport).toBe('function');
  });

  test('LoadTestRunner.js exports a constructor', () => {
    expect(typeof LoadTestRunner).toBe('function');
    const runner = new LoadTestRunner(testApp);
    expect(runner).toBeInstanceOf(LoadTestRunner);
  });

  test('ReportGenerator.js exports generateJsonReport and generateHtmlReport', () => {
    expect(typeof generateJsonReport).toBe('function');
    expect(typeof generateHtmlReport).toBe('function');
  });

  test('GitHub Actions workflow file for load tests exists', () => {
    const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'load-tests.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
  });
});
