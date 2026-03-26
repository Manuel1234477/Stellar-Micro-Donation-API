# Load Testing Suite — Stellar Micro-Donation API

## Overview

The load testing suite provides two complementary ways to test API performance:

1. **In-process Jest runner** (`LoadTestRunner`): runs concurrent supertest requests inside Jest, no live server required. Used for CI regression checks.
2. **Artillery YAML configs**: real HTTP load tests against a running server, used for sustained/ramp-up profiling in staging environments.

All tests use `MOCK_STELLAR=true`, so no live Stellar network connection is needed.

---

## Directory Structure

```
tests/
  implement-load-testing-suite.test.js   # Jest test file (unit + integration)
  load/
    LoadTestRunner.js                    # Concurrent request runner (supertest)
    PerformanceBaselines.js              # Threshold definitions + validation
    ReportGenerator.js                   # JSON and HTML report generation
    run-load-tests.js                    # CLI entry point for the in-process runner
    artillery/
      donation-creation.yml              # Artillery scenario: POST /donations
      balance-queries.yml                # Artillery scenario: GET /wallets
      stats.yml                          # Artillery scenario: GET /stats/*

.github/
  workflows/
    load-tests.yml                       # CI workflow (scheduled + manual dispatch)

reports/
  load/                                  # Generated reports (gitignored by default)
    load-test-report.json
    load-test-report.html
```

---

## Running Locally

### In-process runner (no live server)

```bash
# Default settings (10 VUs, 50 iterations per scenario)
MOCK_STELLAR=true node tests/load/run-load-tests.js

# Custom concurrency and iterations
MOCK_STELLAR=true node tests/load/run-load-tests.js --concurrency 5 --iterations 20

# Custom output directory
MOCK_STELLAR=true node tests/load/run-load-tests.js --output ./my-reports
```

Or via npm scripts:

```bash
npm run test:load
```

### Jest test suite

```bash
npm run test:load:jest
# or directly:
npx jest tests/implement-load-testing-suite.test.js --testTimeout=60000 --forceExit
```

### Artillery (requires a running server)

Start the server first:

```bash
MOCK_STELLAR=true NODE_ENV=test node src/routes/app.js
```

Then run Artillery against it:

```bash
# Donation creation load test
npx artillery run tests/load/artillery/donation-creation.yml --target http://localhost:3000

# Balance/wallet queries
npx artillery run tests/load/artillery/balance-queries.yml --target http://localhost:3000

# Stats endpoints
npx artillery run tests/load/artillery/stats.yml --target http://localhost:3000
```

---

## Performance Baselines

These thresholds are enforced by `PerformanceBaselines.js`. Tests fail if any is violated.

| Scenario           | p50 (ms) | p95 (ms) | p99 (ms) | Min Throughput (req/s) | Max Error Rate |
|--------------------|----------|----------|----------|------------------------|----------------|
| `health-check`     | 50       | 150      | 300      | 20                     | 1%             |
| `balance-queries`  | 100      | 300      | 600      | 10                     | 2%             |
| `stats`            | 150      | 400      | 800      | 8                      | 2%             |
| `donation-creation`| 200      | 500      | 1000     | 5                      | 5%             |

Baselines are intentionally generous to avoid flaky CI failures. Tighten them as the system stabilises.

---

## CI Integration

The GitHub Actions workflow at `.github/workflows/load-tests.yml`:

- Runs every Sunday at 00:00 UTC (scheduled)
- Can be triggered manually via `workflow_dispatch` with optional `concurrency` and `iterations` inputs
- Uploads JSON + HTML reports as build artifacts (retained 90 days)
- On pull requests, posts a Markdown table summary as a PR comment

### Trigger manually

In GitHub: Actions tab → "Load Tests" → "Run workflow".

---

## Adding New Scenarios

### In-process runner

1. Add a new entry to the `scenarios` array in `tests/load/run-load-tests.js`:

```javascript
{
  name: 'my-new-scenario',
  requestFn: (req) => req.get('/my-endpoint').set('X-API-Key', 'test-load-key'),
},
```

2. Add a corresponding baseline in `tests/load/PerformanceBaselines.js`:

```javascript
'my-new-scenario': {
  p50LatencyMs: 100,
  p95LatencyMs: 300,
  p99LatencyMs: 600,
  minThroughputRps: 10,
  maxErrorRate: 0.02,
},
```

3. Add test coverage in `tests/implement-load-testing-suite.test.js`.

### Artillery

Create a new YAML file in `tests/load/artillery/` following the pattern of the existing configs. Add a corresponding run step to `.github/workflows/load-tests.yml` if CI execution is desired.

---

## Interpreting Reports

### JSON report (`load-test-report.json`)

```json
{
  "generatedAt": "...",
  "passed": true,
  "scenarios": [
    {
      "scenario": "health-check",
      "totalRequests": 50,
      "errorRate": 0,
      "throughputRps": 42.3,
      "latencyMs": { "p50": 12, "p95": 35, "p99": 68, "mean": 15 },
      "baselineViolations": []
    }
  ]
}
```

- `passed`: `true` only if all scenarios have zero baseline violations.
- `baselineViolations`: array of human-readable strings describing each breach.

### HTML report (`load-test-report.html`)

Open in any browser. Shows a colour-coded table per scenario (green = PASS, red = FAIL with violation details).

---

## Performance Tuning Recommendations

- **Increase DB connection pool size** if donation-creation p95 is high under concurrency.
- **Enable response caching** for `/stats/daily` and `/stats/weekly` if those endpoints show high latency at scale.
- **Tune `thinkTimeMs`** in `LoadTestRunner` options to model realistic user pacing (default 50ms).
- **Use the `--concurrency` flag** to find the concurrency level at which p95 begins to degrade — this is the practical throughput ceiling.
- **Run Artillery ramp-up tests** in staging before major releases to catch regressions not visible at low concurrency.

---

## Architecture Notes

`LoadTestRunner` uses Node.js `Promise.all` to simulate concurrent virtual users (VUs). Each VU runs its `iterationsPerVU` iterations sequentially with optional think time. This matches the behaviour of tools like k6 and Artillery at the request level, without requiring any external binary.

The `_executeRequest` method wraps each supertest call in a try/catch and records wall-clock latency using `Date.now()`. This is accurate to ~1ms for in-process requests and sufficient for p50/p95/p99 regression detection.
