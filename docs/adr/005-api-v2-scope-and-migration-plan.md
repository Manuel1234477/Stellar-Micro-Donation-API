# ADR-005: Scope and migration plan for `/api/v2`

**Status:** Accepted  
**Date:** 2026-11-18  
**Deciders:** Backend team  
**Issue:** [#1958](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1958)

---

## Context

The API is served at `/api/v1` (229 routes as of this ADR, enumerated by
`scripts/collect-routes.js`). Unversioned paths redirect to `/api/v1` and that
redirect is scheduled to stop on 2027-01-01 (#1802).

The issue that prompted this ADR describes a `/api/v2` surface covering donations,
wallets and corporate matching, with a standardised error envelope. **In this
checkout that surface does not exist:** there is no `src/routes/v2/`, the route
collector finds no `/api/v2` mounts, and git history contains no such files. The
plan below therefore starts from zero. The standard envelope that v2 was meant to
introduce now lives in `src/utils/errors.js` and applies to all of `/api/v1`
(see #1957).

Without a written plan, a partial v2 would become a second, permanently
half-maintained API: clients that adopt it for the envelope would still have to
speak v1 for most of their integration and handle both shapes.

## Decision

1. **v2 is a full surface, not an opt-in overlay.** Each resource is either
   migrated completely to `/api/v2` or left in v1 with a recorded waiver. No
   resource gets a partial v2 (for example, only `GET` endpoints).

2. **v2 conventions**
   - Envelope: the envelope from `src/utils/errors.js` (`buildErrorEnvelope`),
     with `error.code` drawn from `docs/ERROR_CODES.md`. Success bodies use
     `{ success: true, data, meta }`.
   - Pagination: cursor-based, as described in `docs/CURSOR_PAGINATION_GUIDE.md`.
     Offset pagination is not carried into v2.
   - Money: amounts are XLM decimal strings with at most 7 decimal places, never
     JSON numbers. Internally they remain integer stroops (ADR-004).
   - Errors: 400 for malformed or invalid request fields; 422 for requests that
     are well-formed but violate a business rule. This rule is documented in
     `docs/ERROR_CODES.md` and applies to v2 from the first resource.

3. **Resource order** (by client dependency, not by size):
   1. donations
   2. wallets
   3. transactions
   4. recurring donations
   5. campaigns and pledges
   6. webhooks
   7. API keys (admin)
   8. everything else

   Each step is one release. A step is not done until its v1 routes carry a
   `Deprecation` header pointing to the v2 equivalent.

4. **Status is generated, not hand-maintained.** The table in
   `docs/VERSIONING_STRATEGY.md` between the `API_VERSION_MATRIX` markers is
   generated from the mounted route table by `scripts/generate-api-version-matrix.js`.
   CI runs `--check` so the table cannot drift from the routes.

5. **v1 deprecation criteria.** v1 is deprecated (Deprecation and Sunset headers
   sent on every v1 response) only when all of the following hold:
   - every v1 resource is either migrated to v2 or has a recorded waiver;
   - the v2 envelope and error codes are documented in the OpenAPI spec;
   - v1 traffic, as measured by `api_key_usage`, has stayed below 5% of
     requests for four consecutive weeks;
   - the Sunset date is at least four weeks after the announcement, per
     `docs/VERSIONING_STRATEGY.md`.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Opt-in overlay: v2 only adds the envelope to v1 routes | The envelope already applies to v1 (#1957), so the overlay would add little. It also cannot carry the other v2 contracts (cursor pagination, string amounts) without changing v1 behaviour. |
| Big-bang v2 release for all resources | Too large to review or test; blocks the resources that are ready. |
| Remove v1 envelope variants and keep one URL version | Breaks existing clients with no migration window, which `VERSIONING_STRATEGY.md` forbids for MAJOR changes. |

## Consequences

**Positive:**
- One answer to "what is v2?" for every resource, in one generated table.
- Clients get a clear per-resource migration path and a documented sunset rule.

**Negative / trade-offs:**
- v2 has no users until its first resource ships, so the envelope gains nothing
  for clients in the short term. The #1957 envelope already applies to v1.
- Generating the table requires booting the app in CI, so the check depends on
  the app loading (it already does in `test:coverage:ci`).

**Follow-on tasks:**
- Create `src/routes/v2/` with the donations resource (step 1).
- Add the `Deprecation` and `Sunset` headers to v1 donation routes once step 1 ships.
- Wire `scripts/generate-api-version-matrix.js --check` into `.github/workflows/ci.yml`.

---

*ADRs are lightweight and intentionally short.*
