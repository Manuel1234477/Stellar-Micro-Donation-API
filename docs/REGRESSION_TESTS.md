# Regression Test Suite

**Issue:** #182  
**Purpose:** Protect recently merged features from breaking changes

## Overview

Comprehensive regression tests for features merged in recent PRs:
- **Debug Mode** (#179)
- **API Key Permissions** (#180)
- **Abuse Detection** (#181)

## Test Coverage

### Debug Mode Tests (4 tests)
- Production safety (debug disabled in production)
- Development enablement
- Configuration validation
- Function availability

### API Key Permissions Tests (6 tests)
- Admin-only permission enforcement
- User transaction access
- Guest write operation denial
- Guest read operation allowance
- Transaction permission definitions
- Wildcard permission support

### Abuse Detection Tests (8 tests)
- Request tracking without blocking
- Burst threshold flagging
- Failure tracking without blocking
- Failure threshold flagging
- Statistics availability
- Null IP handling
- Double-flag prevention

### Integration Tests (3 tests)
- Admin abuse signal access
- Non-admin denial
- Failed permission tracking

### Backward Compatibility Tests (3 tests)
- Existing log functions
- Existing permission constants
- Role hierarchy maintenance

### Edge Case Tests (3 tests)
- Rapid successive requests
- Mixed success/failure patterns
- Invalid role handling

## Running Tests

```bash
# Run regression tests only
npm test tests/regression.test.js

# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

## Test Results

```
Test Suites: 1 passed
Tests:       26 passed
Time:        ~0.4s
```

## Regression Detection

These tests will **fail** if:

1. **Debug mode is enabled in production** - Security risk
2. **Permission checks are removed** - Authorization bypass
3. **Abuse detection stops tracking** - Loss of observability
4. **Role hierarchy changes** - Privilege escalation risk
5. **Backward compatibility breaks** - API contract violation

## CI Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Pre-merge checks

Failing regression tests **block merges**.

## Maintenance

### Adding New Regression Tests

When merging new features:

1. Add test section to `tests/regression.test.js`
2. Cover critical functionality
3. Test edge cases
4. Verify backward compatibility

Example:

```javascript
describe('New Feature (#XXX)', () => {
  it('should maintain core behavior', () => {
    // Test critical path
  });

  it('should handle edge cases', () => {
    // Test boundaries
  });
});
```

### Test Stability

All regression tests are:
- ✅ **Deterministic** - No random failures
- ✅ **Fast** - Complete in <1 second
- ✅ **Isolated** - No external dependencies
- ✅ **Clear** - Obvious failure reasons

### Flaky Test Policy

**Zero tolerance for flaky tests.**

If a test fails intermittently:
1. Fix immediately or remove
2. Investigate root cause
3. Add proper setup/teardown
4. Never use `setTimeout` or random values

## Coverage

Regression tests add **26 test cases** covering:
- Security features (debug mode, permissions)
- Observability features (abuse detection)
- Integration points
- Backward compatibility
- Edge cases

## Benefits

1. **Confidence** - Safe to refactor
2. **Documentation** - Tests show expected behavior
3. **Fast feedback** - Catch breaks immediately
4. **Quality gate** - Prevent regressions from merging

## Related Documentation

- [Debug Mode](./features/DEBUG_MODE.md)
- [API Key Permissions Audit](./API_KEY_PERMISSIONS_AUDIT.md)
- [Abuse Detection](./ABUSE_DETECTION.md)
