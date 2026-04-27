# Load Testing Suite

In-process load test suite that runs against the Express app in mock mode, validates results against performance baselines, and generates reports.

## Running

```bash
npm run test:load
# with options:
node tests/load/run-load-tests.js --output ./reports/load --concurrency 10 --iterations 50
```

No running server required — the suite boots the app in-process with `MOCK_STELLAR=true`.

## Scenarios

| Scenario | Endpoint | Baseline p95 | Max Error Rate |
|---|---|---|---|
| `health-check` | `GET /health` | 150ms | 1% |
| `balance-queries` | `GET /wallets` | 300ms | 2% |
| `stats` | `GET /stats/daily` | 400ms | 2% |
| `donation-creation` | `POST /donations` | 500ms | 5% |

## Artillery Scenarios

Standalone Artillery YAML files in `tests/load/artillery/` can be run against a live server:

```bash
npx artillery run tests/load/artillery/donation-creation.yml --target http://localhost:3000
```

## Performance Baselines

Defined in `tests/load/PerformanceBaselines.js`. The runner exits non-zero (`process.exit(1)`) when any baseline is violated.

## Reports

JSON and HTML reports are written to `reports/load/` (configurable via `--output`).

## CI

A nightly GitHub Actions workflow (`.github/workflows/load-tests.yml`) runs the suite on a schedule and uploads the report as a build artifact.
