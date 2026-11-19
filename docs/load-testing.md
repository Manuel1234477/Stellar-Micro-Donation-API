# Load Testing & Performance Gate

The load-test suite drives the Express app (in mock-Stellar mode) with
concurrent virtual users, measures latency / throughput / error rate per
scenario, and **fails CI when results regress beyond defined thresholds**
(issue #1167). Because the single canonical workflow
`.github/workflows/load-tests.yml` runs on every pull request and push to
`main`/`master`, a regression blocks the merge.

`npm run test:load` (backed by `tests/load/run-load-tests.js`) is the **only**
load-test harness in the repo. The former `nightly-load-test.yml` workflow and
the Jest-based `test:load:jest` harness have been removed (issue #1799) so there
is a single source of truth for baselines and a single scheduled job.

## Running locally

```bash
npm run test:load -- --concurrency 10 --iterations 50 --warmup 10
```

| Flag            | Default | Meaning                                            |
|-----------------|---------|----------------------------------------------------|
| `--concurrency` | 10      | Concurrent virtual users                           |
| `--iterations`  | 50      | Measured requests per scenario                     |
| `--warmup`      | 5       | Discarded warm-up requests per scenario (see below)|
| `--output`      | reports/load | Directory for the JSON/HTML reports           |

The runner exits non-zero if any scenario breaches its threshold, prints a
per-scenario pass/fail summary, and writes JSON + HTML reports. In GitHub
Actions it also appends a metrics table to the job summary so reviewers see the
numbers even on a pass.

## Thresholds (SLOs)

Targets are defined per scenario in
[`tests/load/PerformanceBaselines.js`](../tests/load/PerformanceBaselines.js):
`p50` / `p95` / `p99` latency ceilings (ms), a minimum throughput (req/s), and a
maximum error rate. To change a *target*, edit that file. Current defaults:

| Scenario            | Route                      | p50 | p95 | p99  | min req/s | max error rate |
|---------------------|----------------------------|-----|-----|------|-----------|----------------|
| `liveness`          | `GET /health/live`         | 50  | 150 | 300  | 20        | 1%             |
| `list-donations`    | `GET /api/v1/donations`    | 100 | 300 | 600  | 10        | 2%             |
| `donation-creation` | `POST /api/v1/donations`   | 200 | 500 | 1000 | 5         | 5%             |
| `stats-summary`     | `GET /api/v1/stats/summary`| 100 | 250 | 500  | 20        | 2%             |

These are the thresholds enforced on every PR/push (see next section) — tuned
to be reliably achievable on noisy, shared CI runners. They are intentionally
looser than the production SLA targets used by the nightly regression check
below, so a merge is never blocked by shared-runner noise.

## Nightly regression check (Issues #1546, #1799)

The same canonical workflow
[`.github/workflows/load-tests.yml`](../.github/workflows/load-tests.yml) also
runs the suite (`npm run test:load`) nightly at 02:00 UTC — with **no**
`LOAD_TEST_*_MARGIN` relaxation — and compares the results against the
production SLA targets named in the issue:

| Scenario            | Route                       | Target throughput | Target p95 |
|---------------------|------------------------------|--------------------|-----------|
| `donation-creation` | `POST /donations`            | 200 req/s          | < 150ms   |
| `list-donations`    | `GET /donations`             | 500 req/s          | < 50ms    |
| `stats-summary`     | `GET /stats/summary`         | 100 req/s          | < 200ms   |

These live in `NIGHTLY_TARGET_BASELINES` in
[`tests/load/PerformanceBaselines.js`](../tests/load/PerformanceBaselines.js) —
a separate, stricter set from the `BASELINES` used by the PR gate above (see
that file's header comment for why they're split). Both sets live in the same
file and are consumed by the same workflow and harness: `BASELINES` (with
margins) gates PRs and pushes, `NIGHTLY_TARGET_BASELINES` (no margins) drives
the nightly regression issue.

If a scenario's measured p95 latency exceeds its target by more than **20%**,
the workflow updates a **single tracking issue** (labelled `performance`,
`regression`, `automated`) with the comparison metrics, rather than failing a
build — a regression is a data point for follow-up, not a merge blocker. The
JSON and HTML reports from every run (PR, push and nightly) are uploaded as
workflow artifacts so results can be inspected after the fact. The check
itself is a plain Node script and can be run against any report locally:

```bash
npm run test:load -- --output ./reports/load
node scripts/check-load-test-regression.js reports/load/load-test-report.json
```

## Handling runner variance

Shared CI runners are noisy, so absolute latency varies run-to-run. Two
mechanisms keep the gate meaningful without being flaky:

1. **Warm-up** — `--warmup N` runs `N` discarded requests per scenario before
   measurement, so cold-start cost (JIT, lazy `require`s, first DB connection)
   doesn't pollute the steady-state numbers.
2. **Margins** — three environment variables widen the *tolerance* (not the
   targets), applied by `resolveBaselines()`:

   | Env var                       | Default | Effect                                  |
   |-------------------------------|---------|-----------------------------------------|
   | `LOAD_TEST_LATENCY_MARGIN`    | 1.0     | Multiplies every latency ceiling        |
   | `LOAD_TEST_THROUGHPUT_MARGIN` | 1.0     | Multiplies every min-throughput floor   |
   | `LOAD_TEST_ERROR_RATE_MARGIN` | 1.0     | Multiplies every max-error-rate ceiling |

   The CI workflow sets `LOAD_TEST_LATENCY_MARGIN=2.0` and
   `LOAD_TEST_THROUGHPUT_MARGIN=0.5` to absorb shared-runner slowness; locally
   the defaults (no margin) apply.
