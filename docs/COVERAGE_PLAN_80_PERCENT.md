# Test Coverage Plan: Path to 80%

**Issue**: #708 — Coverage thresholds set at 30% — far too low to provide meaningful quality assurance  
**Status**: In progress  
**Current minimum threshold**: 60% (raised from 30%)  
**Target**: 80% within 3 months  

---

## Current State

| Metric     | Old Threshold | New Threshold | Target |
|------------|:-------------:|:-------------:|:------:|
| Branches   | 30%           | 60%           | 80%    |
| Functions  | 30%           | 60%           | 80%    |
| Lines      | 30%           | 60%           | 80%    |
| Statements | 30%           | 60%           | 80%    |

Coverage is enforced in two places:
- `jest.config.js` — enforced by Jest on every `npm run test:coverage` run (currently 80%)
- `scripts/check-coverage.js` — enforced by the `npm run check-coverage` script (raised to 60%)

---

## Critical Path Coverage (90%+ target)

The following components handle money movement and must have ≥90% coverage:

| Component | File | Tests Added | Status |
|-----------|------|-------------|--------|
| RecurringDonationScheduler | `src/services/RecurringDonationScheduler.js` | `tests/donations/scheduler-critical-paths.test.js` | ✅ Done |
| HealthCheckService | `src/services/HealthCheckService.js` | `tests/services/health-check-service.test.js` | ✅ Done |
| Donation routes | `src/routes/donation.js` | `tests/donations/` (existing + new) | 🔄 In progress |
| Cleanup job | `src/jobs/cleanupJob.js` | Pending | ⏳ Month 1 |

---

## 3-Month Roadmap

### Month 1 — Reach 70% (Foundation)

**Week 1–2: Service layer**
- [ ] `src/services/StellarService.js` — payment sending, account loading, error paths
- [ ] `src/services/MockStellarService.js` — mock mode branches
- [ ] `src/services/WebhookService.js` — delivery, retry, failure notification

**Week 3–4: Route handlers**
- [ ] `src/routes/donation.js` — all 7 endpoints, validation errors, auth failures
- [ ] `src/routes/stream.js` — schedule CRUD, cancellation
- [ ] `src/routes/wallet.js` — wallet creation, lookup, update

**Deliverable**: 70% coverage across all metrics, CI gate updated to 70%.

---

### Month 2 — Reach 75% (Middleware & Utilities)

**Week 5–6: Middleware**
- [ ] `src/middleware/apiKey.js` — valid key, expired key, missing key
- [ ] `src/middleware/rbac.js` — admin, user, guest roles
- [ ] `src/middleware/errorHandler.js` — 400, 401, 403, 404, 500 paths
- [ ] `src/middleware/payloadSizeLimiter.js` — over-limit, under-limit

**Week 7–8: Utilities**
- [ ] `src/utils/database.js` — query, run, get, transaction rollback
- [ ] `src/utils/log.js` — masking, debug mode, structured output
- [ ] `src/utils/asyncHandler.js` — error propagation

**Deliverable**: 75% coverage, CI gate updated to 75%.

---

### Month 3 — Reach 80% (Edge Cases & Integration)

**Week 9–10: Edge cases**
- [ ] Retry logic with all backoff levels
- [ ] Orphaned schedule detection and suspension
- [ ] Idempotency key collision handling
- [ ] Rate limiting boundary conditions

**Week 11–12: Integration tests**
- [ ] End-to-end donation flow (create → verify → status update)
- [ ] Recurring donation lifecycle (create → execute → complete)
- [ ] Health check under partial failure (degraded state)

**Deliverable**: 80% coverage across all metrics, CI gate updated to 80%.

---

## Coverage Ratchet Policy

Coverage thresholds **can only increase, never decrease**:

1. The `jest.config.js` `coverageThreshold` is the authoritative gate — PRs that drop coverage below the threshold are blocked.
2. When coverage improves by ≥5 percentage points, the threshold in `jest.config.js` is raised to lock in the gain.
3. `scripts/check-coverage.js` mirrors the jest threshold and is updated at the same time.

---

## Exclusions (Justified)

The following are excluded from coverage collection (`jest.config.js` `collectCoverageFrom`):

| Pattern | Reason |
|---------|--------|
| `src/scripts/**` | One-off migration/admin scripts, not application logic |
| `src/config/**` | Configuration objects — no branching logic to test |

Any new exclusions require a comment in `jest.config.js` with justification.

---

## CI/CD Integration

Coverage is enforced automatically:

```yaml
# .github/workflows/ci.yml
- name: Run tests with coverage
  run: npm run test:coverage:ci

- name: Check coverage thresholds
  run: npm run check-coverage
```

Coverage reports are uploaded as CI artifacts (30-day retention) and can be viewed at:
`coverage/lcov-report/index.html`

---

## References

- [Coverage Guide](./COVERAGE_GUIDE.md) — how to run and interpret coverage reports
- [Jest Configuration](../jest.config.js) — coverage thresholds and collection patterns
- [Check Coverage Script](../scripts/check-coverage.js) — CI threshold validation
