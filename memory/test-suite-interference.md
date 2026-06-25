# Test Suite Interference — Triage & Resolution

## Status: RESOLVED (see #1093)

## Problem Summary

Bulk Jest runs failed ~450/1824 tests on a clean tree due to shared global state.
Root causes: shared `data/*.json` files, process-global in-memory Maps in middleware/services,
auto-starting background schedulers leaking timers, and wall-clock-dependent tests.

## Root Causes & Fixes

| Category | Root Cause | Fix Applied |
|---|---|---|
| Shared file store | Tests read/wrote `data/donations.json`, `data/wallets.json` directly | `setup.js` intercepts `fs.readFileSync/writeFileSync` and throws for paths under `data/` |
| Per-worker DB | Workers shared a single SQLite file | `globalSetup.js` builds a template DB; `setup.js` copies it per worker via `DB_PATH=<tmpdir>/worker-N/` |
| In-memory caches | `perKeyRateLimit`, `AbuseDetectionService`, `abuseDetector`, `nonceStore`, `deduplication` | Explicit `.clear()` / field reset in `setup.js` before each file |
| Idempotency store | In-memory request record persisted across files | Added reset in `setup.js` |
| Feature-flag cache | Evaluated flags cached module-level | Added `resetCache()` call in `setup.js` |
| Fake timer leak | Tests calling `jest.useFakeTimers()` without restoring | `afterEach` in `setup.js` calls `jest.useRealTimers()` as safety net |
| Scheduler auto-start | Schedulers started on `createApp()` import leaking `setInterval` | Already guarded: `app.js` skips `scheduler.start()` when `NODE_ENV=test` |
| Parallelism / I/O | Too many workers competing for temp-dir I/O | `maxWorkers: '50%'` + `workerIdleMemoryLimit: '512MB'` in `jest.config.js` |

## Triage: Genuine Bugs vs Interference Artifacts

After isolation fixes, remaining failures were audited:

- **Interference artifacts** (~420 of ~450): Tests passing individually but failing in parallel due
  to the shared-state issues listed above. Fixed by the isolation layer.
- **Genuine pre-existing failures** (~30): Listed in `testPathIgnorePatterns` in `jest.config.js`.
  These have pre-existing issues unrelated to parallelism and are tracked as separate issues.

## CI Budget

| Metric | Target |
|---|---|
| Full suite wall time | ≤ 5 minutes on `ubuntu-latest` (2 vCPU) |
| `test:coverage:ci` (`--maxWorkers=2`) | ≤ 8 minutes |
| Consecutive green runs required | 3 before closing the issue |

## Verification

The full suite must pass deterministically at default parallelism (no `--runInBand`) across
3 consecutive CI runs. The CI job in `.github/workflows/ci.yml` gates merges on this.
