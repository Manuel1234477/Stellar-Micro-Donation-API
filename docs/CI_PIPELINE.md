# CI Pipeline Documentation

## Overview
The CI pipeline automatically runs on every pull request to ensure code quality, test coverage, and security before merging changes.

## Triggers
- **Pull Requests**: Runs when PRs are opened or updated against `main` or `master`
- **Push Events**: Runs on pushes to `main` or `master`

## Pipeline Jobs

All jobs live in `.github/workflows/ci.yml`.

### 1. Lint Job (`lint`)
- `npm run lint`: ESLint with the security, no-secrets and local plugins. It
  fails on any error, and on more warnings than the `--max-warnings` ratchet in
  `package.json` allows. When you fix warnings, lower that number in the same PR.
  It never goes up. The `.eslintcache` file is cached between runs.
- `npm run migrate:check`: migration ID ordering.
- `npm run examples:validate`: example curl/Postman files.

### 2. Guards Job (`guards`)
Repository conventions that ESLint cannot express (#1790):

| Script | Enforces | Baseline |
|---|---|---|
| `check:no-float-money` | ADR-004: no float arithmetic on money | `KNOWN_FLOAT_MONEY` in the script |
| `check:test-naming` | `docs/TEST_NAMING_CONVENTION.md` | `KNOWN_LEGACY` in the script |
| `check:isolation` | Suites restore env/globals and use unique fixtures | `KNOWN_LEAKS` in the script |
| `check:i18n-orphans` | No orphaned i18n keys | none |
| `validate:rbac` | RBAC permission/role config is valid | none |
| `typecheck` | JSDoc types (`tsc --noEmit`) | **non-blocking** until main has 0 type errors |

Each baseline only lists findings that were already on `main` when the guard
was added. Shrink them as you fix entries, and never add to them for new code.
Every guard has a `--strict` mode that ignores its baseline.

### 3. Test Job (`test`, Node 20.x and 22.x)
Runs `npm run test:coverage:ci`, the coverage threshold, the OpenAPI sync check,
the no-JSON-persistence and changelog checks, and `npm audit --audit-level=high`.

### 4. Quarantine Job (`quarantine`, non-blocking)
Runs `*.quarantine.test.js` suites with retries. The main test job excludes
them. Each one is registered in `tests/quarantine.js` with an owner, a tracking
issue and a deadline (see `docs/testing/FLAKY_TEST_POLICY.md`).

### 5. Smoke Job (`smoke`)
Boots the app with the mock Stellar service and runs `npm run test:smoke`.

### Scheduled: Mutation Testing
`.github/workflows/mutation-weekly.yml` runs Stryker every Monday on the modules
in `stryker.conf.json`. It uploads the `mutation-report` artifact and does not
block merge.

## Required Status Checks

Once `main` is green, a repository admin should make these checks required for
merges into `main` (Settings → Branches → branch protection rule for `main` →
"Require status checks to pass"):

- `lint`
- `guards`
- `Test on Node.js 20.x`
- `Test on Node.js 22.x`
- `smoke`

`quarantine` must stay optional.

## Dependency Updates

Dependabot (`.github/dependabot.yml`) opens:

- one grouped PR for production minor/patch bumps (`production-deps`),
- one grouped PR for dev minor/patch bumps (`dev-deps`),
- one grouped PR for security minor/patch fixes (`security-patches`),
- one grouped PR for GitHub Actions minor/patch bumps (`actions-updates`),
- **a separate PR for every major version bump**. The `dependabot-labels`
  workflow labels these `major-update`.

How to handle them:

1. **Grouped minor/patch and security PRs.** Merge when CI is green. While
   `main` is red, a PR can be merged if every job it fails also fails on the
   latest `main` run. Compare the two runs job by job, and note that comparison
   in the PR before merging. Run `npm audit --audit-level=high` locally on the PR
   branch to confirm it does not add advisories.
2. **`major-update` PRs.** Never auto-merge. Read the upstream changelog,
   migrate config if needed (for example ESLint flat config or TypeScript
   compiler options), and get a second reviewer.
3. **When `main` turns green again**, comment `@dependabot rebase` on every
   open Dependabot PR so it re-runs against the fixed baseline.
4. **Closing without merging.** Leave a comment with the reason, for example
   "superseded by #NNN" or "blocked on major migration #NNN".

## Local Testing

Before pushing, you can run the same checks locally:

```bash
# Install dependencies
npm ci

# Initialize database
npm run init-db

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linting
npm run lint

# Run security audit
npm audit
```

## Environment Variables

### Required for Tests
- `MOCK_STELLAR=true` - Uses mock Stellar network instead of real network
- `API_KEYS=test-key-1,test-key-2` - Test API keys for authentication

### CI Environment
- `CI=true` - Automatically set by GitHub Actions

## Performance Optimizations

1. **Dependency Caching**: npm dependencies are cached between runs
2. **Parallel Execution**: All jobs run in parallel for faster feedback
3. **Clean Installs**: Uses `npm ci` for reproducible builds

## Troubleshooting

### Pipeline Fails on PR
1. Check which job failed in the GitHub Actions tab
2. Review the job logs for specific errors
3. Run the same command locally to reproduce
4. Fix the issue and push again

### Linting Failures
```bash
# Run locally to see issues
npm run lint

# Auto-fix where possible
npm run lint -- --fix
```

### Test Failures
```bash
# Run tests locally
npm test

# Run specific test file
npm test -- path/to/test.js

# Run with verbose output
npm test -- --verbose
```

### Coverage Issues
```bash
# Generate coverage report locally
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

## Best Practices

1. **Always run tests locally** before pushing
2. **Fix linting issues** before creating PR
3. **Check coverage** for new code
4. **Review security warnings** from audit
5. **Keep dependencies updated** to avoid vulnerabilities

## Workflow File Location
`.github/workflows/ci.yml`

## Related Documentation
- [Contributing Guide](../Contributing.txt)
- [Testing Documentation](../tests/README.md)
- [Security Guidelines](../SECURITY_NOTES.md)
