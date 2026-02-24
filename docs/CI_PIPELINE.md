# CI Pipeline Documentation

## Overview
The CI pipeline automatically runs on every pull request to ensure code quality, test coverage, and security before merging changes.

## Triggers
- **Pull Requests**: Automatically runs when PRs are opened or updated against `main` or `develop` branches
- **Push Events**: Runs on direct pushes to `main` or `develop` branches
- **Manual**: Can be triggered manually via GitHub Actions UI using `workflow_dispatch`

## Pipeline Jobs

### 1. Test Job
Runs the complete test suite to verify functionality.

**Steps:**
- Checkout code
- Setup Node.js 18
- Install dependencies with `npm ci`
- Initialize database
- Run tests with `npm test`

**Environment:**
- `CI: true` - Indicates CI environment
- `MOCK_STELLAR: true` - Uses mock Stellar network
- `API_KEYS: test-key-1,test-key-2` - Test API keys

### 2. Coverage Job
Generates test coverage reports and uploads them as artifacts.

**Steps:**
- Checkout code
- Setup Node.js 18
- Install dependencies
- Initialize database
- Run `npm run test:coverage`
- Upload coverage reports (30-day retention)

**Artifacts:**
- Coverage reports available in GitHub Actions artifacts
- Includes both text and lcov formats

### 3. Lint Job
Checks code quality and style using ESLint with security plugins.

**Steps:**
- Checkout code
- Setup Node.js 18
- Install dependencies
- Run `npm run lint:security`

**Configuration:**
- Maximum 100 warnings allowed
- Includes security and secrets detection plugins

### 4. Security Job
Audits npm dependencies for known vulnerabilities.

**Steps:**
- Checkout code
- Setup Node.js 18
- Install dependencies
- Run `npm audit --audit-level=critical`

**Note:** Continues on error to not block PRs, but reports issues

### 5. Status Job
Aggregates results from all jobs and provides final pass/fail status.

**Behavior:**
- Runs after all other jobs complete
- Checks results of test, coverage, and lint jobs
- Fails if any critical job fails
- Security job failures don't block (informational only)

## Status Checks on PRs

When you create or update a PR, you'll see these status checks:

- ✅ **Run Tests** - Test suite passed
- ✅ **Test Coverage** - Coverage generated successfully
- ✅ **Code Linting** - Code quality checks passed
- ℹ️ **Security Checks** - Dependency audit (informational)
- ✅ **CI Status** - Overall pipeline status

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
npm run lint:security

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
npm run lint:security

# Auto-fix where possible
npm run lint:security -- --fix
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
