# Test Naming Convention & Migration Plan

Issue [#1175](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1175)

## Convention

All test files **mirror the `src/` directory structure** and name themselves
after the module they exercise:

```
src/services/DonationService.js          → tests/services/donation-service.test.js
src/routes/donation.js                   → tests/routes/donation.test.js
src/middleware/rateLimiter.js            → tests/middleware/rate-limiter.test.js
src/utils/memoEncryption.js             → tests/utils/memo-encryption.test.js
```

### Rules

| Rule | Example |
|------|---------|
| File name = kebab-case of the source module name | `DonationService` → `donation-service.test.js` |
| Directory mirrors `src/` | `src/routes/wallet.js` → `tests/routes/wallet.test.js` |
| Smoke tests live in `tests/smoke/` and use the `.smoke.test.js` suffix | `tests/smoke/server-startup.smoke.test.js` |
| E2E tests live in `tests/e2e/` and use the `.e2e.test.js` suffix | `tests/e2e/donation.e2e.test.js` |
| Cross-cutting integration tests live in `tests/integration/` | `tests/integration/idempotency.test.js` |
| Feature-scoped helpers (builders, fixtures) live in `tests/helpers/` | `tests/helpers/dbBootstrap.js` |

### What NOT to do

- ❌ `add-pagination-to-all-list-endpoints.test.js` — issue-slug naming
- ❌ `issues-796-797-798.test.js` — issue-number naming
- ❌ `security-issues-1122-1123-1124-1125.test.js` — issue-batch naming
- ✅ `tests/utils/pagination-to-all-list-endpoints.test.js` — module-scoped
- ✅ `tests/routes/donation.test.js` — mirrors src/routes/donation.js

### Why

Issue-slug names (`add-X.test.js`, `issue-NNN.test.js`) make it impossible
to answer the question "which file tests module X?" without a full-text search.
Convention-named files are discoverable from the source file they cover,
duplicates are easy to spot, and `jest --testPathPattern routes/donation`
filters correctly.

---

## Migration Plan

Migration is **gradual** (high-traffic modules first) to keep PRs reviewable
and preserve `git log --follow` history.

### Phase 0 — Documentation (this PR)

- [x] Document the convention in `docs/TEST_NAMING_CONVENTION.md` (this file).
- [x] Update `CONTRIBUTING.md` to reference the convention.
- [x] Add a lightweight CI lint rule (`scripts/check-test-naming.js`) that
      **warns** (non-blocking) on new files that match the legacy patterns so
      no new legacy-named files land.

### Phase 1 — Highest-traffic source modules (next 2 sprints)

Rename the files that exercise the core donation/wallet/stats paths first,
since those are touched most often and benefit most from discoverability.

| Legacy file | Canonical target | git mv command |
|---|---|---|
| `tests/add-pagination-to-all-list-endpoints.test.js` | `tests/utils/pagination-to-all-list-endpoints.test.js` | `git mv tests/add-pagination-to-all-list-endpoints.test.js tests/utils/pagination-to-all-list-endpoints.test.js` |
| `tests/add-support-for-donation-notes-and-tags.test.js` | `tests/donations/donation-notes-and-tags.test.js` | `git mv tests/add-support-for-donation-notes-and-tags.test.js tests/donations/donation-notes-and-tags.test.js` |
| `tests/add-openapiswagger-documentation-generation.test.js` | `tests/utils/openapi-documentation.test.js` | `git mv tests/add-openapiswagger-documentation-generation.test.js tests/utils/openapi-documentation.test.js` |
| `tests/smart-donation-routing.test.js` | `tests/services/donation-router.test.js` | `git mv tests/smart-donation-routing.test.js tests/services/donation-router.test.js` |
| `tests/donation-velocity-limits.test.js` | `tests/services/donation-velocity.test.js` | `git mv tests/donation-velocity-limits.test.js tests/services/donation-velocity.test.js` |
| `tests/issues-796-797-798.test.js` | Split or move to `tests/integration/regression-796-798.test.js` | `git mv tests/issues-796-797-798.test.js tests/integration/regression-796-798.test.js` |
| `tests/issues-802-803.test.js` | `tests/integration/regression-802-803.test.js` | `git mv tests/issues-802-803.test.js tests/integration/regression-802-803.test.js` |
| `tests/issue-806.test.js` | `tests/integration/regression-806.test.js` | `git mv tests/issue-806.test.js tests/integration/regression-806.test.js` |
| `tests/security-issues-1122-1123-1124-1125.test.js` | `tests/security/security-1122-1125.test.js` | `git mv tests/security-issues-1122-1123-1124-1125.test.js tests/security/security-1122-1125.test.js` |
| `tests/issues-65-66-67-68.test.js` | `tests/integration/regression-65-68.test.js` | `git mv tests/issues-65-66-67-68.test.js tests/integration/regression-65-68.test.js` |

### Phase 2 — Remaining issue-slug files at root level (1 sprint)

After Phase 1, the remaining root-level `tests/issues-NNN*.test.js` and
`tests/issue-NNN*.test.js` files (those inside `tests/issues/` are already
scoped) can be moved in a single batch PR:

```bash
# Example batch for root-level issue files
git mv tests/issues-764-765-766-767.test.js tests/integration/regression-764-767.test.js
git mv tests/issues-1144-1145-1146-1147.test.js tests/integration/regression-1144-1147.test.js
# … and so on for any remaining root-level issue-slug files
```

### Phase 3 — `tests/misc/` triage (ongoing)

`tests/misc/` is a catch-all. Files there should be moved to the appropriate
subdirectory as they are edited:

```
tests/misc/graceful-shutdown-inflight-request-.test.js
  → tests/bootstrap/graceful-shutdown-inflight.test.js

tests/misc/scheduler-resilience.test.js
  → tests/services/recurring-donation-scheduler-resilience.test.js

tests/misc/validation.test.js
  → tests/middleware/validation.test.js
```

### Phase 4 — Enforce strictly (after Phase 3 complete)

Once the suite is mostly migrated, flip the CI lint rule from warn to error
so all new test files must follow the convention.

---

## Checking Compliance

A helper script is provided at `scripts/check-test-naming.js`. Run it locally:

```bash
node scripts/check-test-naming.js
```

It prints files that match legacy naming patterns. In CI it exits non-zero
only if a _new_ file (not already tracked as a legacy exception) is found,
so existing violations do not block the build until they are migrated.

---

## New-File Checklist (for contributors)

When adding a new test file:

1. Identify the source module it exercises (`src/X/Y.js`).
2. Create the file at `tests/X/y.test.js` (kebab-case).
3. If it spans multiple modules, use `tests/integration/` or the most
   relevant subdirectory.
4. Never use an issue number or feature-slug as the file name — put that
   context in the `describe` block header instead.
