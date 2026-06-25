# Contributing to Stellar Micro-Donation API

Thank you for taking the time to contribute! This guide covers everything you need
to go from a fresh clone to an open PR.

---

## Table of Contents

1. [Local Setup](#1-local-setup)
2. [Running Tests](#2-running-tests)
3. [Linting & Security](#3-linting--security)
4. [Database Migrations](#4-database-migrations)
5. [OpenAPI Spec](#5-openapi-spec)
6. [Branch & Commit Conventions](#6-branch--commit-conventions)
7. [Pre-PR Checklist](#7-pre-pr-checklist)

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

## 3. Linting & Security

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

## 4. Database Migrations

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

## 5. OpenAPI Spec

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

## 6. Branch & Commit Conventions

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

## 7. Pre-PR Checklist

Before pushing and opening a PR, run through this list:

```bash
npm run lint            # no ESLint errors
npm run security:scan   # no new security findings
npm test                # full suite passes
npm run check-coverage  # coverage ≥ 80%
npm run openapi:check   # spec is up to date
npm run migrate:status  # no pending unapplied migrations
```

CI enforces all of the above and will block merge if any step fails.

When the PR is ready:
- Reference the issue with `Closes #<number>` in the PR description.
- Fill in the PR template (summary, testing notes, breaking changes).
- Request at least one review before merging.
