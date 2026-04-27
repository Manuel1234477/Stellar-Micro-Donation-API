# Contributing to Stellar Micro-Donation API

Thank you for helping improve this project! This guide covers everything you need to contribute effectively.

## Table of Contents

- [Dev Setup](#dev-setup)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Conventional Commits](#conventional-commits)
- [Pull Request Process](#pull-request-process)
- [Branch Naming](#branch-naming)
- [Security](#security)
- [Getting Help](#getting-help)

---

## Dev Setup

### Prerequisites

- **Node.js v18 or higher** (v20 LTS recommended)
- **npm v9+**
- **Git**

### Local Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/Stellar-Micro-Donation-API.git
cd Stellar-Micro-Donation-API

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — minimum required for local dev:
#   MOCK_STELLAR=true        (no real Stellar account needed)
#   API_KEYS=dev_key_123
#   ENCRYPTION_KEY=          (run `npm run generate-key` to create one)

# 4. Generate an encryption key
npm run generate-key

# 5. Initialize the database
npm run init-db

# 6. Start the server
npm run dev          # auto-reload on file changes
```

The API will be available at `http://localhost:3000`.
Swagger UI (dev only): `http://localhost:3000/docs`

### Stellar Credentials

For local development, always use `MOCK_STELLAR=true` — no real Stellar account is required. The mock service simulates all blockchain operations.

For testnet integration testing, create a free account at [Stellar Laboratory](https://laboratory.stellar.org/) and set:

```env
MOCK_STELLAR=false
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

---

## Coding Standards

### Linting

This project uses **ESLint** with security plugins. Run before every commit:

```bash
npm run lint
```

Fix all lint errors before opening a PR.

### Naming Conventions

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables & functions | `camelCase` | `donationAmount`, `createWallet()` |
| Classes | `PascalCase` | `DonationService`, `WalletBuilder` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_DONATION_AMOUNT` |
| Files (source) | `camelCase` | `donationService.js` |
| Files (tests) | `kebab-case.test.js` | `donation-routes.test.js` |
| Environment variables | `UPPER_SNAKE_CASE` | `STELLAR_NETWORK` |

### Code Style

- Use `const`/`let` — never `var`
- Prefer `async`/`await` over raw Promise chains
- All exported functions must have JSDoc comments
- Use error classes from `src/utils/errors.js` — don't throw raw `Error` in route handlers
- Wrap all async route handlers with `asyncHandler` from `src/utils/asyncHandler.js`

---

## Testing

### Running Tests

```bash
npm test                     # full test suite
npm run test:coverage        # with coverage report
npm run check-coverage       # verify thresholds
npm test -- path/to/test.js  # single file
npm test -- --randomize      # random order (verify isolation)
```

### Coverage Thresholds

PRs must **maintain or improve** current coverage. Minimum thresholds enforced in CI:

| Metric | Minimum |
|--------|---------|
| Branches | 60% |
| Functions | 60% |
| Lines | 60% |
| Statements | 60% |

### Writing Tests

- Place tests in `tests/` mirroring the source structure
- Use `MockStellarService` — never call the live Stellar network in tests
- Tests must be fully isolated (no shared state, no order dependency)
- Use the builder helpers in `tests/builders/` for common test data

```js
'use strict';

const request = require('supertest');

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test_key';

const app = require('../src/routes/app');

describe('POST /api/v1/donations', () => {
  it('creates a donation successfully', async () => {
    const res = await request(app)
      .post('/api/v1/donations')
      .set('X-API-Key', 'test_key')
      .send({ senderPublicKey: 'G...', recipientPublicKey: 'G...', amount: '10' });
    expect(res.status).toBe(201);
  });
});
```

---

## Conventional Commits

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description> [#issue]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that is neither fix nor feature |
| `security` | Security improvement |
| `chore` | Build process, dependencies, tooling |
| `perf` | Performance improvement |

### Examples

```
feat: add webhook notifications for completed donations #412
fix: handle missing memo field in transaction sync #388
docs: add CONTRIBUTING.md and GitHub issue templates #759
security: implement path-based CSP to support Swagger UI #757
```

**Breaking changes** — append `!` and add a `BREAKING CHANGE:` footer:

```
feat!: require API key scopes for all donation endpoints #450

BREAKING CHANGE: API keys without explicit scopes will be rejected.
```

---

## Pull Request Process

### Before Opening a PR

1. Rebase onto latest `main`: `git fetch origin && git rebase origin/main`
2. All tests pass: `npm test`
3. Coverage thresholds met: `npm run check-coverage`
4. No lint errors: `npm run lint`
5. No secrets or credentials committed

### Merge Requirements

A PR will be merged when **all** of the following are true:

- ✅ All CI checks pass (tests, coverage, lint, security scan)
- ✅ At least **one maintainer approval**
- ✅ No unresolved review comments
- ✅ PR description references the issue (`Closes #NNN`)
- ✅ Commits follow Conventional Commits format

### PR Description Template

```
## Summary
What this PR does and why.

## Changes
- Specific change 1
- Specific change 2

## Testing
Commands run and scenarios covered.

## Related Issue
Closes #NNN
```

Keep PRs focused — **one feature or fix per PR**.

---

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/short-description` | `feature/add-webhook-support` |
| Bug fix | `fix/short-description` | `fix/scheduler-timezone-bug` |
| Docs | `docs/short-description` | `docs/update-api-reference` |
| Security | `security/short-description` | `security/csp-swagger-fix` |
| Chore | `chore/short-description` | `chore/upgrade-dependencies` |

Use lowercase and hyphens, not underscores.

---

## Security

- **Never commit** secrets, API keys, private keys, or `.env` files
- Report vulnerabilities privately via [GitHub Security Advisories](../../security/advisories/new) — do not open a public issue
- Use `src/utils/validationHelpers.js` for input validation
- Use `src/utils/sanitizer.js` for user-supplied strings
- See [Security Documentation](docs/security/) for the full threat model

---

## Getting Help

- **Bugs / feature requests** → [Open an Issue](../../issues/new/choose)
- **General questions** → [GitHub Discussions](../../discussions)
- **Troubleshooting** → [Developer Troubleshooting Guide](docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md)
