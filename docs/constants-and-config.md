# Constants and Configuration — Single-Source-of-Truth Guide

> Closes #1214 — Centralize magic numbers and scattered defaults into constants/config.

Numeric literals and string defaults are easy to set inconsistently and risky to
change. This guide defines **where each category of default lives** so future
code follows the same pattern without magic numbers sneaking back in.

---

## The rule

| Where | What goes there | Why |
|---|---|---|
| `src/constants/` | **Pure invariants** (math, time, physical/protocol numbers) | Never environment-dependent. Frozen objects. One definition per concept. |
| `src/config/` | **Env-overridable tunables** (operational defaults, fees, TTLs, limits) | Defaults sourced from `src/constants/domain.js`. Override via env var. Validated + parsed. |

If a number is the same in every environment (a protocol constant), put it in
`src/constants/`. If an operator may ever legitimately want to change it, put it
in `src/config/` with the default sourced from `src/constants/domain.js`.

---

## Where to find each concern

| Concern | Lives in | Key symbol/env var |
|---|---|---|
| Time-unit math (`MS_PER_DAY`, `MS_PER_HOUR`, …)               | `src/constants/time.js`    | — |
| Network/protocol (`STROOPS_PER_XLM`, `STELLAR_BASE_FEE_STROOPS`, default ports) | `src/constants/network.js` | — |
| Domain defaults (recipient priority, retention days, tx-sync interval, fee example amount) | `src/constants/domain.js` | — |
| Server port, prefix, env                                     | `src/config/index.js`      | `server.*` |
| Stellar network + Horizon URL                                | `src/config/index.js`      | `stellar.*` |
| Database type/path                                           | `src/config/index.js`      | `database.*` |
| Rate limiting                                                | `src/config/index.js`      | `rateLimit.*` |
| Donation amounts/caps                                        | `src/config/index.js`      | `donations.*` |
| Application fees (platform %, min, max)                       | `src/config/index.js`      | `fees.*` |
| Retention windows (donations / audit / idempotency)          | `src/config/index.js`      | `retention.*` |
| API keys (legacy + expiry notifications)                     | `src/config/index.js`      | `apiKeys.*` |
| Transaction-sync scheduler                                   | `src/config/index.js`      | `stellarSync.*` |
| Logging                                                      | `src/config/index.js`      | `logging.*` |
| Encryption                                                   | `src/config/index.js`      | `encryption.*` |
| Geo-blocking                                                 | `src/config/index.js`      | `geoBlocking.*` |
| SEP-0010 challenge TTL                                       | `src/config/index.js`      | `sep10.*` |
| Tax-receipt organization                                     | `src/config/index.js`      | `taxReceipt.*` |

---

## How to add a new default

1. **Pick the layer.** Is it invariant or tunable?
2. **If invariant:** add to the appropriate file under `src/constants/`
   (`time.js`, `network.js`, `domain.js`, or the top-level `index.js` for
   enums). Wrap the export in `Object.freeze()`.
3. **If tunable:** add the default value to `src/constants/domain.js` and the
   env-driven wrapper to `src/config/index.js` using `parseInteger` /
   `parseFloat` / a small custom parser. Validate bounds.
4. **Replace inline literals** in services/routes with the named reference.
5. **Cite** the constant in a comment so future readers can grep for it.

---

## Convention reminders

- **Never** inline `24 * 60 * 60 * 1000` — use `MS_PER_DAY` from `src/constants/time.js`.
- **Never** inline `10_000_000` stroops or `100` stroops — use `STROOPS_PER_XLM`
  and `STELLAR_BASE_FEE_STROOPS`.
- **Never** re-declare `STROOPS_PER_XLM` — it is exported from
  `src/constants/index.js` (re-exported from `src/constants/network.js`).
- **Never** duplicate retention-day defaults across services — read
  `config.retention.*` instead.
- **Never** magic-number a webhook timeout or default port — use
  `DEFAULT_WEBHOOK_TIMEOUT_MS`, `DEFAULT_HTTPS_PORT`, `DEFAULT_HTTP_PORT`.

---

## Verification (this PR)

The following hot-path sites were converted from inline literals to named
constants/config:

- `src/routes/fees.js` — stroops, base fee, fee decimals, example amount
- `src/services/RetentionService.js` — cutoff math, retention defaults, size estimates
- `src/services/AuditLogRetentionService.js` — interval math, retention default
- `src/services/ApiKeyExpirationNotifier.js` — warn days, expired window, header window, ports, timeout
- `src/services/TransactionSyncScheduler.js` — sync interval, lease multiplier
- `src/services/DonationVelocityService.js` — time units, window-type vocabulary
- `src/services/routing/PriorityStrategy.js` — default priority

A previously undetected drift between `RETENTION_AUDIT_LOGS_DAYS` (default
`365`) and `AUDIT_LOG_RETENTION_DAYS` (default `90`) was unified under
`config.retention.auditLogsDays`, defaulting to **90 days**, with both env
vars accepted.
