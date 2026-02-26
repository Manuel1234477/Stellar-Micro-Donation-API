# Test Coverage Enforcement

This document describes the test coverage enforcement system for the Stellar Micro-Donation API.

## Overview

Test coverage thresholds are automatically enforced on every pull request to prevent code quality regression.

## Current Thresholds

Minimum coverage required:
- **Branches**: 30%
- **Functions**: 30%
- **Lines**: 30%
- **Statements**: 30%

## How It Works

### Local Testing

Run coverage locally:
```bash
npm run test:coverage
```

This generates:
- Console output with coverage summary
- `coverage/` directory with detailed HTML report
- `coverage/lcov.info` for CI integration

### CI Enforcement

The coverage workflow (`.github/workflows/coverage.yml`) runs on:
- Pull requests to `main` or `develop`
- Pushes to `main` or `develop`

**Process:**
1. Checkout code
2. Install dependencies
3. Run tests with coverage
4. Jest automatically fails if thresholds not met
5. Upload coverage report as artifact

### Failure Behavior

If coverage drops below thresholds:
- ❌ CI check fails
- PR cannot be merged
- Clear error message shows which metrics failed
- Coverage report available as artifact

## Configuration

Coverage settings in `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 30,
    functions: 30,
    lines: 30,
    statements: 30,
  },
}
```

Files included in coverage:
```javascript
collectCoverageFrom: [
  'src/**/*.js',
  '!src/scripts/**',
  '!src/config/**',
]
```

## Viewing Coverage Reports

### Locally

After running `npm run test:coverage`:
```bash
open coverage/lcov-report/index.html
```

### In CI

1. Go to failed workflow run
2. Download "coverage-report" artifact
3. Extract and open `lcov-report/index.html`

## Improving Coverage

### Check Uncovered Code

```bash
npm run test:coverage
# Review console output for uncovered lines
```

### Focus Areas

Priority for coverage improvement:
1. Core business logic (services, models)
2. API routes and middleware
3. Utility functions
4. Error handling paths

### Writing Tests

Add tests in `tests/` directory:
- Unit tests for individual functions
- Integration tests for API endpoints
- Mock external dependencies (Stellar network)

## Best Practices

1. **Don't lower thresholds** - Maintain or increase coverage over time
2. **Test meaningful code** - Focus on business logic, not boilerplate
3. **Use mocks appropriately** - Mock external services, not internal logic
4. **Review coverage reports** - Identify untested edge cases
5. **Add tests with new features** - Maintain coverage as code grows

## Excluded Files

Not included in coverage:
- `src/scripts/**` - Database initialization scripts
- `src/config/**` - Configuration files
- `tests/**` - Test files themselves
- `node_modules/` - Dependencies

## Troubleshooting

### Coverage Fails Locally But Not in CI

- Clear Jest cache: `npx jest --clearCache`
- Ensure same Node.js version
- Check for environment-specific code

### Coverage Report Not Generated

- Ensure `coverage/` directory exists
- Check file permissions
- Verify Jest configuration

### False Positives

Some code may be difficult to test:
- Error handling for rare conditions
- External service failures
- Environment-specific code

Consider:
- Adding `/* istanbul ignore next */` comments sparingly
- Mocking external dependencies
- Refactoring for testability

## Future Improvements

As test coverage improves, gradually increase thresholds:
- Target: 50% coverage (medium term)
- Goal: 70% coverage (long term)
- Ideal: 80%+ coverage for critical paths

## Related Documentation

- [CI Testing Guide](CI_TESTING.md)
- [Test Failures Documentation](../TEST_FAILURES.md)
- [Contributing Guidelines](../CONTRIBUTING.md)

## Metrics Explained

- **Statements**: Individual executable statements
- **Branches**: if/else, switch cases, ternary operators
- **Functions**: Function and method definitions
- **Lines**: Physical lines of code (may contain multiple statements)

## Example Output

```
--------------------------------|---------|----------|---------|---------|
File                            | % Stmts | % Branch | % Funcs | % Lines |
--------------------------------|---------|----------|---------|---------|
All files                       |   31.12 |    34.3  |  35.33  |  31.02  |
 src/services                   |   30.81 |    35.02 |  23.91  |  31.01  |
  MockStellarService.js         |   67.77 |    64.95 |  84.61  |  68.47  |
--------------------------------|---------|----------|---------|---------|
✅ Coverage thresholds met!
```
