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
| No test files directly under `tests/` — only setup files (`setup.js`, `globalSetup.js`, `globalTeardown.js`, `jest.setup.js`) | `tests/services/donation-service.test.js` |
| No `tests/issues/` directory — issue-numbered suites are split by feature and moved next to the module they cover | `tests/services/DonationService.custodial.test.js` |
| Issue numbers are kept for traceability **only** in `describe` titles or comments, never in file names | `describe('DonationService custodial balances (#918-#921)', …)` |

### What NOT to do

- ❌ `add-pagination-to-all-list-endpoints.test.js` — issue-slug naming
- ❌ `issues-796-797-798.test.js` — issue-number naming
- ❌ `security-issues-1122-1123-1124-1125.test.js` — issue-batch naming
- ❌ `tests/issues/issues-918-919-920-921.test.js` — issue-number bundle in `tests/issues/`
- ❌ `tests/misc/issue-793-tiers-public.test.js` — issue-number naming in a catch-all folder
- ❌ `tests/leaderElection.test.js` — test file directly under `tests/`
- ✅ `tests/utils/pagination-to-all-list-endpoints.test.js` — module-scoped
- ✅ `tests/routes/donation.test.js` — mirrors src/routes/donation.js
- ✅ `tests/services/DonationService.custodial.test.js` — split from an issue bundle, issue refs in `describe`
- ✅ `tests/routes/tiers.public.test.js` — split from `issue-793-tiers-public.test.js`
- ✅ `tests/routes/fees.test.js` — split from `issue-794-fees.test.js`
- ✅ `tests/routes/donations.pending.test.js` — split from `issue-795-donations-pending.test.js`
- ✅ `tests/utils/csvSerializer.formulaInjection.test.js` — split from `issue-1113-csv-formula-injection.test.js`

### Splitting bundled issue files

Issue bundles such as `issues-1311-1312-1313-1314.test.js` mix unrelated
features in one suite, so a single failure hides several regressions. Split
them by feature, move each part next to the tests for the module it covers,
and keep the issue number in the `describe` title:

```js
// tests/services/DonationService.custodial.test.js
describe('DonationService custodial balances (#918, #919, #920, #921)', () => {
  // …
});
```

Target layout for the current violations:

| Legacy file | Canonical target(s) |
|---|---|
| `tests/issues/issues-918-919-920-921.test.js` | `tests/services/DonationService.custodial.test.js` (split by feature) |
| `tests/issues-65-66-67-68.test.js` | `tests/integration/regression-65-68.test.js` (split by feature) |
| `tests/issues-764-765-766-767.test.js` | `tests/integration/regression-764-767.test.js` (split by feature) |
| `tests/issues-796-797-798.test.js` | `tests/integration/regression-796-798.test.js` (split by feature) |
| `tests/issues-802-803.test.js` | `tests/integration/regression-802-803.test.js` (split by feature) |
| `tests/misc/issue-793-tiers-public.test.js` | `tests/routes/tiers.public.test.js` |
| `tests/misc/issue-794-fees.test.js` | `tests/routes/fees.test.js` |
| `tests/misc/issue-795-donations-pending.test.js` | `tests/routes/donations.pending.test.js` |
| `tests/routes/issue-1113-csv-formula-injection.test.js` | `tests/utils/csvSerializer.formulaInjection.test.js` |

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
`tests/issue-NNN*.test.js` files can be moved in a single batch PR. Split
each bundle by feature first, then move the parts next to the module they
cover:

```bash
# Example batch for root-level issue files
git mv tests/issues-764-765-766-767.test.js tests/integration/regression-764-767.test.js
git mv tests/issues-1144-1145-1146-1147.test.js tests/integration/regression-1144-1147.test.js
# … and so on for any remaining root-level issue-slug files
```

### Phase 2b — Empty `tests/issues/` and the `tests/` root (1 sprint)

- [ ] Split every file in `tests/issues/` by feature and move the parts next
      to the tests for the module they cover (see the target layout table
      above). Keep the issue numbers in the `describe` titles.
- [ ] Delete `tests/issues/` once it is empty.
- [ ] Move every `*.test.js` file sitting directly in `tests/` into the
      matching feature folder (`tests/admin/`, `tests/donations/`,
      `tests/transactions/`, `tests/security/`, `tests/services/`, …).
- [ ] Merge `*-extended.test.js` suites into their base suites where they
      overlap, instead of keeping duplicated coverage.
- [ ] Add a check that fails when a test file is created directly under
      `tests/` (only setup files are allowed there).

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

The check also enforces the structural rules:

- no `*.test.js` files directly under `tests/` (setup files are allowed);
- no `tests/issues/` directory;
- issue numbers only in `describe` titles or comments, never in file names.

---

## New-File Checklist (for contributors)

When adding a new test file:

1. Identify the source module it exercises (`src/X/Y.js`).
2. Create the file at `tests/X/y.test.js` (kebab-case).
3. If it spans multiple modules, use `tests/integration/` or the most
   relevant subdirectory.
4. Never use an issue number or feature-slug as the file name — put that
   context in the `describe` block header instead.
5. Never create a test file directly under `tests/` (only setup files live
   there) and never add files to `tests/issues/`.
6. If you are splitting an issue bundle, name each part after the module and
   feature it covers, e.g. `tests/services/DonationService.custodial.test.js`,
   `tests/routes/tiers.public.test.js`, `tests/routes/fees.test.js`,
   `tests/routes/donations.pending.test.js` or
   `tests/utils/csvSerializer.formulaInjection.test.js`.
