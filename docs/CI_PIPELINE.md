# CI Pipeline Structure

This document describes the CI/CD pipeline structure for the Stellar Micro-Donation API.

## Overview

The CI pipeline runs multiple independent jobs in parallel for faster feedback and clearer results.

## Pipeline Jobs

### 1. Test (`test`)
**Purpose**: Run the full test suite

**Steps**:
- Checkout code
- Setup Node.js 18
- Install dependencies
- Run `npm test`

**Fails if**: Any test fails

---

### 2. Coverage (`coverage`)
**Purpose**: Enforce test coverage thresholds

**Steps**:
- Checkout code
- Setup Node.js 18
- Install dependencies
- Run `npm run test:coverage`
- Upload coverage report as artifact

**Fails if**: Coverage drops below 30%

**Artifacts**: Coverage report (30-day retention)

---

### 3. Lint (`lint`)
**Purpose**: Static code analysis and security linting

**Steps**:
- Checkout code
- Setup Node.js 18
- Install dependencies
- Run `npm run lint:security`

**Fails if**: ESLint errors found (warnings allowed up to 100)

---

### 4. Security (`security`)
**Purpose**: Dependency vulnerability scanning

**Steps**:
- Checkout code
- Setup Node.js 18
- Install dependencies
- Run `npm audit --audit-level=critical`

**Fails if**: Critical vulnerabilities found

**Note**: Continues on error to not block PRs

---

### 5. Status (`status`)
**Purpose**: Aggregate results and provide final status

**Steps**:
- Check all job results
- Display summary
- Fail if any required job failed

**Depends on**: test, coverage, lint, security

## Parallel Execution

All jobs (test, coverage, lint, security) run **in parallel** for faster CI times.

```
┌─────────┐
│ PR/Push │
└────┬────┘
     │
     ├──────┬──────┬──────┬──────┐
     │      │      │      │      │
     ▼      ▼      ▼      ▼      ▼
  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
  │Test│ │Cov │ │Lint│ │Sec │ │... │
  └──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘ └────┘
     │      │      │      │
     └──────┴──────┴──────┘
              │
              ▼
          ┌────────┐
          │ Status │
          └────────┘
```

## Viewing Results

### GitHub UI

1. Go to PR or commit
2. Click "Checks" tab
3. See all jobs with individual status
4. Click job name to view logs

### Status Checks

Each job appears as a separate status check:
- ✅ Run Tests
- ✅ Test Coverage
- ✅ Code Linting
- ✅ Security Checks
- ✅ CI Status

## Failure Identification

### Clear Job Names
Each job has a descriptive name showing what failed:
- "Run Tests" - Test suite failure
- "Test Coverage" - Coverage below threshold
- "Code Linting" - Linting errors
- "Security Checks" - Vulnerabilities found

### Structured Output
Each job provides specific error messages:
- Test failures show which tests failed
- Coverage shows which metrics are below threshold
- Linting shows file, line, and rule violated
- Security shows vulnerable packages

### Quick Navigation
Click failed job → See exact error → Fix issue

## Configuration

### Workflow File
`.github/workflows/ci.yml`

### Triggers
- Pull requests to `main` or `develop`
- Pushes to `main` or `develop`

### Node Version
All jobs use Node.js 18

### Caching
npm dependencies cached for faster runs

## Benefits

### Speed
- Parallel execution reduces total CI time
- Independent jobs don't wait for each other
- Typical run: ~2-3 minutes (vs 5-6 sequential)

### Clarity
- Each concern has its own job
- Easy to identify what failed
- Clear separation of responsibilities

### Maintainability
- Jobs can be updated independently
- Easy to add new checks
- Simple to disable specific jobs

## Adding New Jobs

To add a new CI check:

1. Add job to `.github/workflows/ci.yml`:
```yaml
new-check:
  name: New Check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
    - run: npm ci
    - run: npm run new-check
```

2. Add to status job dependencies:
```yaml
needs: [test, coverage, lint, security, new-check]
```

3. Update status check logic if needed

## Troubleshooting

### Job Stuck/Timeout
- Default timeout: 360 minutes
- Add `timeout-minutes: 10` to job if needed

### Flaky Tests
- Check test logs for timing issues
- Consider increasing test timeout
- Use `--maxWorkers=1` for serial execution

### Cache Issues
- Clear cache: Delete and re-run workflow
- Check `package-lock.json` is committed

### Dependency Conflicts
- Ensure `npm ci` is used (not `npm install`)
- Check Node.js version matches local

## Related Documentation

- [Test Coverage](TEST_COVERAGE.md)
- [Static Security Analysis](STATIC_SECURITY_ANALYSIS.md)
- [CI Testing Guide](CI_TESTING.md)

## Metrics

**Target CI Time**: < 3 minutes
**Current Jobs**: 5 (4 parallel + 1 status)
**Success Rate**: Track in GitHub Insights
