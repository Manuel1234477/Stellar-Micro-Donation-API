# Contributing to Stellar Micro-Donation API

Thank you for taking the time to contribute! This guide covers everything you need
to go from a fresh clone to an open PR.

---

## Table of Contents

1. [Local Setup](#1-local-setup)
2. [Running Tests](#2-running-tests)
3. [Test Naming Convention](#3-test-naming-convention)
4. [Linting & Security](#4-linting--security)
5. [Database Migrations](#5-database-migrations)
6. [OpenAPI Spec](#6-openapi-spec)
7. [Branch & Commit Conventions](#7-branch--commit-conventions)
8. [Pre-PR Checklist](#8-pre-pr-checklist)

---

## 1. Local Setup

**Prerequisites:** Node.js ≥ 20, npm ≥ 10, SQLite3.

```bash
# 1. Clone and install
git clone https://github.com/Manuel1234477/Stellar-Micro-Donation-API.git
cd Stellar-Micro-Donation-API
npm install

# 2. Create your .env file
cp .env.example .env

# 3. Generate an encryption key (required for memo encryption)
npm run generate-key
# Copy the printed key into .env as ENCRYPTION_KEY=<value>

# 4. Initialise the database
npm run init-db

# 5. Start the dev server (auto-reload)
npm run dev
```

The API will be available at `http://localhost:3000`.

For development without a live Stellar network add `MOCK_STELLAR=true` to `.env`.

---

## 2. Running Tests

```bash
# Full unit/integration suite (parallel, default)
npm test

# Run with coverage report
npm run test:coverage

# Smoke tests (fast, no DB needed)
npm run test:smoke

# End-to-end tests (requires a running server)
npm run test:e2e

# Verify coverage thresholds are met (80% min)
npm run check-coverage
```

All tests use an isolated per-worker SQLite database — you do not need to reset any
state between runs. See [Test Isolation Guide](docs/TEST_ISOLATION.md) for details.

---

## 3. Test Naming Convention

See **[docs/TEST_NAMING_CONVENTION.md](docs/TEST_NAMING_CONVENTION.md)** for the full
convention and migration plan. The short version:

- Name your test file after the **module it exercises**, not the issue or feature
  that prompted it.
- Mirror the `src/` directory structure: `src/routes/donation.js` →
  `tests/routes/donation.test.js`.
- Use `.smoke.test.js` for smoke tests in `tests/smoke/` and `.e2e.test.js` for
  end-to-end tests in `tests/e2e/`.

**Quick check** — run this before opening a PR to ensure no new legacy-named file
was accidentally created:

```bash
node scripts/check-test-naming.js
```

CI runs this check automatically on every PR.

---

## 4. Linting & Security

```bash
# ESLint (style + security rules)
npm run lint

# Security scan (custom checks + eslint-plugin-security)
npm run security:scan

# Validate environment variable schema
npm run validate-env
```

The project uses `eslint-plugin-security` and a custom `require-async-handler` rule.
Fix all reported issues before opening a PR — CI will fail otherwise.

---

## 5. Database Migrations

Migrations live in `src/migrations/` and are applied in version order.

```bash
# Apply pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# Roll back the last migration
npm run migrate:rollback
```

If you add a feature that requires a schema change:

1. Create a new migration file in `src/migrations/` following the existing naming
   pattern (`NNN_description.js`).
2. Implement `up()` and `down()` exports.
3. Run `npm run migrate` locally and verify with `npm run migrate:status`.
4. Include the migration file in your PR.

---

## 6. OpenAPI Spec

The OpenAPI spec at `docs/openapi.json` and `docs/openapi.yaml` must stay in sync
with the route JSDoc annotations.

```bash
# Regenerate the spec from JSDoc annotations
npm run openapi:generate

# Verify the spec matches the annotations (run by CI)
npm run openapi:check
```

Always regenerate and commit the spec before opening a PR. CI runs `openapi:check`
and will fail if the spec is stale.

---

## 7. Branch & Commit Conventions

**Branches**

| Pattern | Use |
|---|---|
| `feature/<short-description>` | New features |
| `fix/<issue-number>-<short-description>` | Bug fixes |
| `docs/<short-description>` | Documentation only |
| `chore/<short-description>` | Tooling, deps, config |

**Commits** — use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add idempotency key support to /donations
fix(#42): correct rate-limit window reset on 429
docs: document K8s liveness probe configuration
chore: bump stellar-sdk to 12.0.0
```

Breaking changes must include a `BREAKING CHANGE:` footer in the commit body.

---

## 8. Pre-PR Checklist

Before pushing and opening a PR, run through this list:

```bash
npm run lint                       # no ESLint errors
npm run security:scan              # no new security findings
npm test                           # full suite passes
npm run check-coverage             # coverage ≥ 80%
npm run openapi:check              # spec is up to date
npm run migrate:status             # no pending unapplied migrations
node scripts/check-test-naming.js  # no new legacy-named test files
```

CI enforces all of the above and will block merge if any step fails.

When the PR is ready:
- Reference the issue with `Closes #<number>` in the PR description.
- Fill in the PR template (summary, testing notes, breaking changes).
- Request at least one review before merging.

---

## 9. Security

**Do not open a public GitHub issue for security vulnerabilities.**

See **[SECURITY.md](../SECURITY.md)** for:
- The private reporting channel (email or GitHub private vulnerability reporting)
- Supported versions and patching policy
- Response SLAs
- Safe-harbor statement for good-faith researchers

---

## 10. Key Documentation

When working on a feature, these docs will save you time:

| Topic | Document |
|-------|----------|
| Quickstart (fresh clone → first request) | [docs/quickstart.md](../docs/quickstart.md) |
| Database schema & ER diagram | [docs/DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md) |
| SEP-10 web auth & federation | [docs/SEP_COMPLIANCE.md](../docs/SEP_COMPLIANCE.md) |
| API endpoint examples | [docs/API_EXAMPLES.md](../docs/API_EXAMPLES.md) |
| Architecture overview | [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) |
| Troubleshooting | [docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md](../docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md) |
