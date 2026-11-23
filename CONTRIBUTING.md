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
7. [Keeping Example Base URLs in Sync](#7-keeping-example-base-urls-in-sync)
8. [Branch & Commit Conventions](#8-branch--commit-conventions)
9. [Pre-PR Checklist](#9-pre-pr-checklist)
10. [Release Process](#10-release-process)
11. [Dependency Updates & Dependabot Triage](#11-dependency-updates--dependabot-triage)
12. [Implementation Notes & Work Tracking](#12-implementation-notes--work-tracking)
13. [Security](#13-security)
14. [Key Documentation](#14-key-documentation)

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

# 5. Start the API (runs validate-env, then the server)
npm start
```

The API will be available at `http://localhost:3000`.

For development without a live Stellar network add `MOCK_STELLAR=true` to `.env`.

### Verify your setup

Once the server is running, confirm the baseline works. CI runs the same steps on a
fresh runner (see the `onboarding` job in `.github/workflows/ci.yml`):

```bash
curl -i http://localhost:3000/health          # expect: HTTP/1.1 200 OK
ONBOARDING_HEALTH_URL=http://localhost:3000/health bash scripts/validate-onboarding.sh
                                              # expect: "All onboarding checks passed."
```

If `npm start` fails at `validate-env`, the message names the missing or invalid variable.
Fix it in `.env` and run `npm start` again.

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

See **[docs/test-naming-convention.md](docs/test-naming-convention.md)** for the full
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

## 7. Keeping Example Base URLs in Sync

The base URL used in all copy-paste onboarding material must always match the
versioned mount prefix in `src/bootstrap/routes.js`.

**Current mount prefix:** `/api/v1`  
**Required base URL in examples:** `http://localhost:3000/api/v1`

Files that hardcode this value:

| File | Location |
|------|----------|
| `examples/API_CURL_EXAMPLES.md` | `BASE_URL` variable (two occurrences) |
| `examples/Stellar-Micro-Donation-API.postman_collection.json` | `BASE_URL` collection variable |

**Rule:** Any PR that changes the mount prefix in `src/bootstrap/routes.js` **must**
update both example files in the same commit. CI should (and eventually will) grep
for the old prefix and fail if a stale value is found. Until that check exists,
confirm the values are consistent as part of the [Pre-PR Checklist](#9-pre-pr-checklist).

---

## 8. Branch & Commit Conventions

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

## 9. Pre-PR Checklist

Before pushing and opening a PR, run `npm run verify` first. It runs every guard
script CI runs, in CI's order, and prints a summary table. Then run through the
rest of this list:

```bash
npm run lint                       # no ESLint errors
npm run security:scan              # no new security findings
npm test                           # full suite passes
npm run check-coverage             # coverage ≥ 80%
npm run openapi:check              # spec is up to date
npm run migrate:status             # no pending unapplied migrations
npm run check:parse                # every src/ and scripts/ file parses
node scripts/check-test-naming.js  # no new legacy-named test files
npm run verify                     # aggregate: runs every guard script above
```

CI enforces all of the above and will block merge if any step fails.

`npm run verify` is the single aggregate that runs all repository guard scripts
(`check:*`, `validate:*`, `openapi:check`, `changelog:check`, `typecheck`,
`boot-guard`, …). It is executed by one required CI job, so a new guard script
added to `verify` is automatically enforced. If `npm run verify` fails locally,
fix the failure rather than skipping the script — a guard that is always red
provides no protection.

### Required status checks

A PR can merge to `main` only when these CI jobs pass (`.github/workflows/ci.yml`):

| Check | Job | What it guards |
|-------|-----|----------------|
| Lint | `lint` | ESLint, migration ID check, example validation |
| Parse | `parse` | `npm run check:parse`: no file in `src/` or `scripts/` fails to parse |
| Tests | `test` | Full suite with coverage on Node 20.x and 22.x |
| Smoke | `smoke` | `npm run test:smoke` in mock mode |
| Onboarding | `onboarding` | Fresh install, migrate, boot, `/health`, `scripts/validate-onboarding.sh` |
| Verify | `verify` | `npm run verify`: all guard scripts (`check:*`, `validate:*`, `openapi:check`, `changelog:check`, `typecheck`, `boot-guard`) |

Branch protection on `main` that requires these checks, and requires branches to be up to date before merging, is set by a repository admin. See issue #1978.

When the PR is ready:
- Reference the issue with `Closes #<number>` in the PR description.
- Fill in the PR template (summary, testing notes, breaking changes).
- Request at least one review before merging.

### Closing an issue: required evidence

A PR that uses `Closes #<number>` (or any other closing keyword) must include
evidence that the underlying problem is actually fixed. Closing an issue is a
claim that the change works — back it up:

1. **The relevant tests pass in CI.** Name the test file(s) or command that
   cover the issue in the PR description, and confirm the `test` job is green
   for the commit that closes the issue. A PR that only touches docs, README,
   or comments cannot close a code or test issue.
2. **Large deletions are explained.** If your diff removes a substantial amount
   of code (roughly 50+ lines, or an entire file/endpoint), explain in the PR
   description *why* the code was dead or wrong and what replaces it. Unexplained
   deletions are treated as regressions until proven otherwise.
3. **No tool markers or placeholders.** Do not append working markers such as
   `<!-- handsoff-issue-NNNN -->` to files, and never commit a file that was
   truncated with a tool placeholder (e.g. `... rest of file unchanged ...`).
   CI rejects these: `npm run check:parse` (the `parse` job) fails on any
   `src/` or `scripts/` file that does not parse, and the marker check fails on
   leftover `handsoff-issue` markers anywhere outside `node_modules`.

If a commit that closed an issue turns out to be wrong, reopen the issue and
open a follow-up PR that reverts or repairs it — with the same evidence above.

---
=======

## 10. Release Process

This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format. Releases are cut
from `main` after CI is green.

### Cutting a Release

1. **Ensure `main` is green** — all CI checks (including `boot-guard`) must pass.

2. **Update the changelog** — move entries from `## [Unreleased]` into a new
   version section:
   ```bash
   # Generate changelog entries from conventional commits since the last tag
   npm run changelog:write
   ```
   Then manually edit `CHANGELOG.md`:
   - Change `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   - Add a fresh `## [Unreleased]` section above it for future work
   - Update the link references at the bottom of the file

3. **Bump `package.json`** — update the `version` field to match the changelog:
   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   ```

4. **Commit the release**:
   ```bash
   git add CHANGELOG.md package.json
   git commit -m "chore(release): vX.Y.Z"
   ```

5. **Tag the release**:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main --tags
   ```

6. **Create a GitHub Release** — go to Releases → Draft a new release, select
   the tag, and paste the changelog section as the release notes.

### Release Cadence

- **Patch**: bug fixes, security patches — as needed
- **Minor**: new features, backward-compatible — monthly or as features land
- **Major**: breaking changes — planned and announced via `Sunset`/`Deprecation`
  headers (see `docs/versioning-strategy.md`)

### Automated Flow (Future)

The project has `scripts/generate-changelog.js` for conventional-commit-based
changelog generation. The eventual goal is an automated release flow
(e.g. release-please or changesets) that bumps `package.json`, moves Unreleased
entries under the new version, tags, and builds a versioned Docker image. Until
then, follow the manual steps above.

---

## 11. Dependency Updates & Dependabot Triage

Dependabot opens grouped `production-deps` and `dev-deps` PRs weekly (see
`.github/dependabot.yml`). Major version bumps are **not** part of the weekly
groups — they arrive as individual PRs so they can be reviewed and tested in
isolation.

### Weekly owner rotation

One maintainer is on Dependabot triage duty each week. The rotation is tracked in
the pinned triage issue and announced in the team channel at the start of each
week. The owner is responsible for:

1. **Triage every open Dependabot PR** — no Dependabot PR should be older than
   two weeks without triage.
2. **Confirm `main` is green** before evaluating any dependency PR. If `main`
   itself cannot install or pass CI, fixing `main` takes priority over the
   dependency PRs.
3. **Rebase grouped PRs** once `main` is green:
   ```bash
   gh pr checkout <number>
   git fetch origin main
   git rebase origin/main
   git push --force-with-lease
   ```
4. **Merge or split** the grouped PR:
   - If CI is green and the diff is reviewable, merge it.
   - If CI fails or the diff is too large to review, split it into smaller PRs
     (e.g. one per package or per ecosystem) so the failing bump can be isolated
     and reverted independently.
5. **Handle major bumps individually** — review the changelog, run the full
   suite (`npm run verify && npm test`), and merge or close with a note.
6. **Escalate** any PR that cannot be merged within two weeks by commenting on
   the triage issue with the blocker.

### If a dependency bump breaks CI

- Identify the offending package from the failing job's log.
- Revert or pin that package in a separate PR so `main` returns to green.
- Re-open the bump as an individual PR once the incompatibility is understood.

---

## 12. Implementation Notes & Work Tracking

Branch-specific implementation notes, status files and progress tracking do not belong in the repository root.

Instead:
- **Quick notes** → PR description or commit messages (they're indexed and searchable)
- **Design decisions** → `docs/adr/` as Architecture Decision Records
- **Testing insights** → `docs/testing/` guides and knowledge articles
- **Implementation guide** → CHANGELOG.md entry when the PR merges
- **Temporary debugging** → use `tmp-*.js` or `.local/` (both are ignored)

Do not commit:
- TODO.md or status files at the root
- *_IMPLEMENTATION_*.md files at the root
- PR summaries, change logs or "issues implemented" write-ups under `docs/`. They go stale as soon as the PR merges. Put user-facing changes in `CHANGELOG.md` and reference details in the PR description
- Tool-specific working directories (.kiro/, .memory/, etc.)

This keeps documentation organized and prevents stale working notes from misleading readers.

---

## 13. Security

**Do not open a public GitHub issue for security vulnerabilities.**

See **[SECURITY.md](SECURITY.md)** for:
- The private reporting channel (email or GitHub private vulnerability reporting)
- Supported versions and patching policy
- Response SLAs
- Safe-harbor statement for good-faith researchers

---

## 14. Key Documentation

When working on a feature, these docs will save you time:

| Topic | Document |
|-------|----------|
| Quickstart (fresh clone → first request) | [docs/quickstart.md](docs/quickstart.md) |
| Database schema & ER diagram | [docs/database-schema.md](docs/database-schema.md) |
| SEP-10 web auth & federation | [docs/sep-compliance.md](docs/sep-compliance.md) |
| API endpoint examples | [docs/api-examples.md](docs/api-examples.md) |
| Architecture overview | [docs/architecture.md](docs/architecture.md) |
| Troubleshooting | [docs/developer-troubleshooting-guide.md](docs/developer-troubleshooting-guide.md) |
