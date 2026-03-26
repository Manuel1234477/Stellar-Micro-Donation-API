# Test Coverage Guide

## Overview

This project enforces minimum test coverage thresholds to maintain code quality and prevent regression. Coverage is automatically checked on every pull request and push to main/develop branches.

## Current Thresholds

All metrics must meet or exceed **30%** coverage:

- **Branches**: 30%
- **Functions**: 30%
- **Lines**: 30%
- **Statements**: 30%

## Running Coverage Locally

### Generate Coverage Report

```bash
npm run test:coverage
```

This will:
- Run all tests with coverage collection
- Generate multiple report formats (text, HTML, LCOV, JSON)
- Display coverage summary in terminal
- Create detailed HTML report in `coverage/lcov-report/index.html`

### View HTML Report

```bash
# After running coverage
open coverage/lcov-report/index.html  # macOS
start coverage/lcov-report/index.html # Windows
xdg-open coverage/lcov-report/index.html # Linux
```

The HTML report shows:
- File-by-file coverage breakdown
- Line-by-line coverage visualization
- Uncovered code highlighted in red
- Partially covered branches in yellow

## CI/CD Integration

### Automatic Checks

Coverage is enforced through GitHub Actions:

1. **On Pull Request**: Coverage workflow runs automatically
2. **Threshold Check**: Jest validates all metrics meet 30% minimum
3. **Build Status**: 
   - ✅ **Pass**: Coverage meets thresholds, PR can merge
   - ❌ **Fail**: Coverage below thresholds, PR blocked

### Coverage Workflow

The `.github/workflows/coverage.yml` workflow:
- Runs on every PR and push to main/develop
- Executes `npm run test:coverage:ci`
- Uploads coverage reports as artifacts (30-day retention)
- Fails the build if thresholds not met

## Understanding Coverage Metrics

### Statements
Percentage of executable statements that were executed during tests.

### Branches
Percentage of conditional branches (if/else, switch, ternary) that were tested.

### Functions
Percentage of functions that were called during tests.

### Lines
Percentage of code lines that were executed during tests.

## Improving Coverage

### 1. Identify Uncovered Code

```bash
npm run test:coverage
# Look for files with low coverage percentages
```

### 2. Add Tests for Uncovered Areas

Focus on:
- Critical business logic
- Error handling paths
- Edge cases
- Conditional branches

### 3. Write Effective Tests

```javascript
// Example: Testing both branches
describe('validateAmount', () => {
  it('should accept valid amounts', () => {
    expect(validateAmount(10)).toBe(true);
  });
  
  it('should reject negative amounts', () => {
    expect(validateAmount(-5)).toBe(false);
  });
});
```

### 4. Verify Improvement

```bash
npm run test:coverage
# Check that coverage percentages increased
```

## Coverage Reports

### Text Summary (Terminal)
Displayed after running tests, shows overall percentages.

### HTML Report
Interactive report with file navigation and line-by-line coverage.

### LCOV Report
Machine-readable format for CI/CD integration and coverage tools.

### JSON Summary
Programmatic access to coverage data.

## Best Practices

### Do's
- ✅ Run coverage before submitting PRs
- ✅ Test critical business logic thoroughly
- ✅ Cover error handling paths
- ✅ Test edge cases and boundary conditions
- ✅ Aim for meaningful tests, not just coverage numbers

### Don'ts
- ❌ Don't write tests just to hit coverage numbers
- ❌ Don't ignore failing coverage checks
- ❌ Don't commit coverage reports to git (they're in .gitignore)
- ❌ Don't lower thresholds to pass checks

## Troubleshooting

### Coverage Below Threshold

**Problem**: CI fails with "Coverage threshold not met"

**Solution**:
1. Run `npm run test:coverage` locally
2. Check which files have low coverage
3. Add tests for uncovered code
4. Verify coverage meets thresholds
5. Commit and push changes

### Coverage Report Not Generated

**Problem**: No coverage directory created

**Solution**:
```bash
# Clean and reinstall
rm -rf node_modules coverage
npm install
npm run test:coverage
```

### Tests Pass But Coverage Fails

**Problem**: Tests succeed but coverage check fails

**Solution**: This is expected behavior. Coverage thresholds are independent of test results. Add more tests to increase coverage.

## Configuration Files

### jest.config.js
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

### package.json
```json
{
  "scripts": {
    "test:coverage": "jest --coverage",
    "test:coverage:ci": "jest --coverage --ci --maxWorkers=2"
  }
}
```

## Future Improvements

### Short Term
- Increase thresholds to 40% as coverage improves
- Add per-file coverage requirements for critical modules
- Generate coverage badges for README

### Medium Term
- Target 50-60% overall coverage
- Implement coverage diff reporting (show coverage change in PRs)
- Add coverage trends tracking

### Long Term
- Achieve 70%+ coverage for production code
- 90%+ coverage for critical business logic
- Integrate with code review tools

## Related Documentation

- [Test Coverage Implementation](../COVERAGE_IMPLEMENTATION.md)
- [CI Pipeline Documentation](./CI_PIPELINE.md)
- [Contributing Guide](../Contributing.txt)

## Support

If you encounter issues with coverage:
1. Check this guide for troubleshooting steps
2. Review the [CI Pipeline docs](./CI_PIPELINE.md)
3. Open an issue with coverage report output
