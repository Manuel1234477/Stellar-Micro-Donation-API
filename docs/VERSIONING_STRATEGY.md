# Versioning Strategy

This document defines how the Stellar Micro-Donation API is versioned, how releases are published, and how contributors should reason about breaking vs. non-breaking changes.

---

## Table of Contents

- [Semantic Versioning Overview](#semantic-versioning-overview)
- [Version Number Rules](#version-number-rules)
- [Breaking vs. Non-Breaking Changes](#breaking-vs-non-breaking-changes)
- [API Endpoint Versioning](#api-endpoint-versioning)
- [Release Flow](#release-flow)
- [Hotfix Releases](#hotfix-releases)
- [Deprecation Policy](#deprecation-policy)
- [Changelog Requirements](#changelog-requirements)
- [Pre-release Labels](#pre-release-labels)

---

## Semantic Versioning Overview

This project follows [Semantic Versioning 2.0.0](https://semver.org/) (SemVer). Every released version is represented as:

```
MAJOR.MINOR.PATCH
```

| Segment | When it increments |
|---------|--------------------|
| `MAJOR` | Incompatible / breaking API changes |
| `MINOR` | New backwards-compatible functionality |
| `PATCH` | Backwards-compatible bug fixes |

**Example progression:**

```
1.0.0  →  Initial stable release
1.1.0  →  New /wallets/batch endpoint added
1.1.1  →  Fix edge case in idempotency key validation
2.0.0  →  Donation payload field renamed (breaking)
```

The current version is always reflected in [package.json](../package.json) under the `"version"` field.

---

## Version Number Rules

### MAJOR increment — bump when you:

- Remove or rename an existing API endpoint
- Remove or rename a required or optional request field
- Change the meaning or type of an existing response field
- Change authentication behaviour in a way that invalidates existing API keys
- Drop support for a previously supported Node.js major version
- Alter database schema in a way that is not backwards-compatible

### MINOR increment — bump when you:

- Add a new endpoint
- Add new optional request fields (old requests still work)
- Add new fields to existing responses (consumers must be tolerant of unknown fields)
- Add a new feature flag or configuration option
- Add new npm scripts that do not affect runtime behaviour
- Expand rate-limit allowances

### PATCH increment — bump when you:

- Fix a bug without changing the public interface
- Improve performance without altering observable behaviour
- Update documentation only (prefer `docs:` commit prefix instead of a release)
- Update dependency patch/minor versions (security patches, etc.)
- Fix a typo in an error message that does not affect parsing

---

## Breaking vs. Non-Breaking Changes

### Breaking changes

A change is **breaking** if a consumer that worked correctly with version `N` can fail or behave differently after upgrading to version `N+1` **without any code changes on their side**.

Common examples for this project:

| Area | Breaking example |
|------|-----------------|
| Donations API | Renaming `amount` → `donation_amount` in `POST /donations` |
| Wallets API | Removing `GET /wallets/:id/balance` |
| Auth | Requiring a new mandatory header (`X-Api-Version`) |
| Response shape | Changing `{ "id": "..." }` to `{ "donationId": "..." }` |
| Errors | Changing HTTP status codes for existing error conditions |
| Scheduler | Removing a recurring-donation frequency type (e.g. `weekly`) |

Breaking changes **must**:

1. Increment `MAJOR` version
2. Be documented in `CHANGELOG.md` under a `### Breaking Changes` sub-heading
3. Trigger an API path version bump (see [API Endpoint Versioning](#api-endpoint-versioning)) if the change affects a public route
4. Be announced with a minimum **4-week deprecation notice** before the old behaviour is removed (see [Deprecation Policy](#deprecation-policy))

### Non-breaking changes

A change is **non-breaking** (backwards-compatible) if existing consumers can upgrade without any modification.

Common examples:

| Area | Non-breaking example |
|------|---------------------|
| Donations API | Adding an optional `note` field to `POST /donations` |
| Wallets API | Adding a new `GET /wallets/:id/stats` endpoint |
| Response | Adding a new `createdAt` field to existing responses |
| Config | Adding a new optional environment variable |
| Docs | Updating README, guides, or inline comments |

Non-breaking additions increment `MINOR`; fixes increment `PATCH`.

---

## API Endpoint Versioning

URL-based versioning is used to isolate breaking change surfaces:

```
/v1/donations
/v1/wallets
/v2/donations   ← introduced with breaking change in MAJOR v2
```

Rules:

- All routes are prefixed with `/v{MAJOR}` (e.g. `/v1`, `/v2`).
- A new URL version is introduced **only on a MAJOR bump**.
- The previous URL version remains available for the deprecation window (minimum 4 weeks after the new MAJOR release).
- `MINOR` and `PATCH` releases never introduce a new URL prefix — they are additive to the existing prefix.

When a new URL version is introduced:

1. Create a new route file (e.g. `src/routes/v2/donations.js`).
2. Mount both old and new versions in `app.js` during the deprecation window.
3. Add a `Deprecation` response header to the old version:
   ```
   Deprecation: version="v1", sunset="2026-06-30"
   ```

---

## Release Flow

```
feature/fix branch  →  main (develop)  →  release tag  →  GitHub Release
```

### Step-by-step

1. **All work merges into `main` via pull request** (see [Branch Protection](BRANCH_PROTECTION.md)).

2. **Determine the version bump** using the rules above. When in doubt, discuss in the related issue or pull request before releasing.

3. **Update `CHANGELOG.md`** with all changes since the last release (see [Changelog Requirements](#changelog-requirements)).

4. **Bump the version** in `package.json`:

   ```bash
   # Patch fix
   npm version patch --no-git-tag-version

   # New feature
   npm version minor --no-git-tag-version

   # Breaking change
   npm version major --no-git-tag-version
   ```

   `--no-git-tag-version` is used so the tag is created separately after review.

5. **Commit the version bump:**

   ```bash
   git add package.json pnpm-lock.yaml CHANGELOG.md
   git commit -m "chore: release v$(node -p "require('./package.json').version")"
   ```

6. **Create and push a signed tag:**

   ```bash
   VERSION=$(node -p "require('./package.json').version")
   git tag -a "v$VERSION" -m "Release v$VERSION"
   git push origin main --follow-tags
   ```

7. **Create a GitHub Release** from the tag:
   - Title: `v{VERSION}`
   - Body: copy the relevant section from `CHANGELOG.md`
   - Mark as **pre-release** if the label is `alpha` or `beta`

8. **CI pipeline** runs automatically on the new tag. All required checks (tests, coverage, lint) must pass — see [CI Pipeline](CI_PIPELINE.md).

---

## Hotfix Releases

For critical production bugs that cannot wait for the normal release cycle:

1. Branch off the latest release tag:

   ```bash
   git checkout -b hotfix/v1.2.1 v1.2.0
   ```

2. Apply the minimal fix, add a test covering the regression.

3. Follow steps 3–8 of the [Release Flow](#release-flow) directly on the hotfix branch.

4. Merge the hotfix branch back into `main`:

   ```bash
   git checkout main
   git merge --no-ff hotfix/v1.2.1
   git branch -d hotfix/v1.2.1
   ```

Hotfixes **always** produce a `PATCH` increment unless the fix itself introduces a breaking change (rare; if so, treat as a MAJOR).

---

## Deprecation Policy

When a feature, endpoint, or behaviour is scheduled for removal:

1. **Announce** the deprecation in the GitHub issue tracker with the label `deprecation` at least **4 weeks** before the MAJOR release that removes it.

2. **Log a deprecation warning** server-side when the deprecated path is exercised:

   ```js
   console.warn('[DEPRECATED] GET /v1/wallets/:id/balance — use GET /v2/wallets/:id/balance instead. Removal scheduled for v2.0.0.');
   ```

3. **Add a `Deprecation` response header** on affected endpoints:

   ```
   Deprecation: version="v1"
   Sunset: Mon, 30 Jun 2026 00:00:00 GMT
   ```

4. **Document** the migration path in `CHANGELOG.md` and the relevant `docs/` guide.

5. **Remove** the deprecated code only after the sunset date has passed and the MAJOR version has been released.

---

## Changelog Requirements

Every release must include a `CHANGELOG.md` update. Use [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [1.2.0] - 2026-03-15

### Added
- `GET /v1/wallets/:id/stats` endpoint for donation analytics (#185)
- Optional `note` field on `POST /v1/donations`

### Changed
- Rate limit window for donation endpoints increased from 15 min to 30 min

### Deprecated
- `GET /v1/wallets/:id/balance` — use `GET /v1/wallets/:id/stats` instead (removal in v2.0.0)

### Fixed
- Idempotency key not persisted on Stellar network timeout (#201)

### Security
- Upgraded `stellar-sdk` to patch CVE-XXXX-XXXX
```

Rules:

- Entries are written for humans, not machines — describe the impact, not the diff.
- Every entry links to the relevant GitHub issue or PR number.
- `### Breaking Changes` is a required sub-section under any MAJOR release entry.
- Do not leave an `[Unreleased]` section in the file at release time — rename it to the version and date.

---

## Pre-release Labels

For early testing of MAJOR changes, pre-release versions may be published:

| Label | Format | Meaning |
|-------|--------|---------|
| Alpha | `2.0.0-alpha.1` | Internal testing only; API may change |
| Beta | `2.0.0-beta.1` | External testing; API is stabilising |
| Release Candidate | `2.0.0-rc.1` | Feature-complete; only critical fixes accepted |

Pre-releases:

- Are tagged in Git with the full label (e.g. `v2.0.0-alpha.1`).
- Are marked as **pre-release** in GitHub Releases.
- Are **never** the default installation target.
- Must still pass CI (tests, coverage, lint) before tagging.

---

## Quick Reference

| Change type | Version bump | New URL prefix? |
|-------------|-------------|-----------------|
| Remove or rename endpoint | MAJOR | Yes |
| Remove or rename request/response field | MAJOR | Yes |
| Add new optional field | MINOR | No |
| Add new endpoint | MINOR | No |
| Bug fix | PATCH | No |
| Docs only | No release needed | No |
| Security patch (no API change) | PATCH | No |

---

*Related documents:*
- [Branch Protection and Merge Policy](BRANCH_PROTECTION.md)
- [CI Pipeline Documentation](CI_PIPELINE.md)
- [API Examples](API_EXAMPLES.md)
- [Architecture Overview](ARCHITECTURE.md)
