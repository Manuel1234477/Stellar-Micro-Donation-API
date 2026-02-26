# Test Organization and Naming Refactor - Design

## Overview
This design document outlines the strategy for reorganizing 70+ test files from a flat structure into a logical, maintainable hierarchy that mirrors the source code organization and follows consistent naming conventions.

## Design Principles

### 1. Mirror Source Structure
Test organization should reflect the `src/` directory structure, making it intuitive to locate tests for any given source file.

### 2. Separation of Concerns
- **Unit tests**: Test individual functions/modules in isolation
- **Integration tests**: Test interactions between components
- **Helper utilities**: Shared test utilities and fixtures

### 3. Consistent Naming
- All files use `kebab-case.test.js`
- Integration tests use `-integration.test.js` suffix
- Test file names match the module they test

### 4. Zero Logic Changes
- No modifications to test assertions or logic
- Only file moves and import path updates
- All tests must pass after refactoring

## Proposed Directory Structure

```
tests/
├── unit/
│   ├── config/
│   │   ├── field-schemas.test.js
│   │   ├── replay-detection-config.test.js
│   │   ├── security-config.test.js
│   │   └── config.test.js
│   ├── middleware/
│   │   ├── error-handler.test.js
│   │   ├── idempotency.test.js
│   │   ├── logger.test.js
│   │   ├── payload-size-limit.test.js
│   │   ├── rate-limiter.test.js
│   │   ├── rate-limit-headers.test.js
│   │   ├── rbac-middleware.test.js
│   │   ├── replay-detection-middleware.test.js
│   │   ├── request-counter.test.js
│   │   └── validation-middleware.test.js
│   ├── services/
│   │   ├── mock-stellar-service.test.js
│   │   ├── scheduler-resilience.test.js
│   │   ├── transaction-reconciliation.test.js
│   │   ├── transaction-state-machine.test.js
│   │   └── transaction-sync-consistency.test.js
│   ├── utils/
│   │   ├── correlation.test.js
│   │   ├── data-masker.test.js
│   │   ├── field-validator.test.js
│   │   ├── replay-detector-logic.test.js
│   │   ├── replay-detector-tracking.test.js
│   │   ├── replay-detector-fingerprint.test.js
│   │   ├── replay-detector-cleanup.test.js
│   │   ├── sanitizer.test.js
│   │   ├── startup-diagnostics.test.js
│   │   └── validators.test.js
│   └── models/
│       ├── api-keys.test.js
│       └── permissions.test.js
├── integration/
│   ├── api/
│   │   ├── api-routes.test.js
│   │   ├── donation-routes-integration.test.js
│   │   ├── wallet-analytics-integration.test.js
│   │   └── integration.test.js
│   ├── donation/
│   │   ├── donation-boundary.test.js
│   │   ├── donation-limits.test.js
│   │   └── recurring-donation-failures.test.js
│   ├── security/
│   │   ├── abuse-detection.test.js
│   │   ├── idempotency-integration.test.js
│   │   ├── negative-authorization.test.js
│   │   ├── payload-field-validation-integration.test.js
│   │   ├── payload-size-limit-integration.test.js
│   │   ├── permission-integration.test.js
│   │   ├── rbac-validation.test.js
│   │   ├── replay-detection-integration.test.js
│   │   ├── sanitization-integration.test.js
│   │   └── unknown-field-error-format.test.js
│   ├── stellar/
│   │   ├── account-funding.test.js
│   │   ├── advanced-failure-scenarios.test.js
│   │   ├── failure-scenarios.test.js
│   │   ├── network-timeout-scenarios.test.js
│   │   ├── stellar-network-failures.test.js
│   │   ├── stellar-retry-logic.test.js
│   │   ├── transaction-status.test.js
│   │   └── transaction-sync-failures.test.js
│   ├── logging/
│   │   ├── logger-integration.test.js
│   │   ├── logger-masking.test.js
│   │   ├── replay-logging-verification.test.js
│   │   └── response-headers-verification.test.js
│   ├── validation/
│   │   ├── memo-integration.test.js
│   │   ├── memo-validation.test.js
│   │   └── validation.test.js
│   └── regression/
│       ├── error-codes.test.js
│       ├── error-hardening.test.js
│       ├── regression.test.js
│       ├── regression-additional.test.js
│       └── test-isolation.test.js
├── e2e/
│   ├── debug-mode.test.js
│   └── request-id-correlation.test.js
├── helpers/
│   └── test-isolation.js
├── setup.js
└── README.md
```

## File Mapping

### Current → New Location

#### Config Tests
- `tests/config.test.js` → `tests/unit/config/config.test.js`
- `tests/fieldSchemas.test.js` → `tests/unit/config/field-schemas.test.js`
- `tests/replayDetectionConfig.test.js` → `tests/unit/config/replay-detection-config.test.js`
- `tests/security-config.test.js` → `tests/unit/config/security-config.test.js`

#### Middleware Tests
- `tests/error-handler-middleware.test.js` → `tests/unit/middleware/error-handler.test.js`
- `tests/idempotency.test.js` → `tests/unit/middleware/idempotency.test.js`
- `tests/logger.test.js` → `tests/unit/middleware/logger.test.js`
- `tests/payloadSizeLimit.test.js` → `tests/unit/middleware/payload-size-limit.test.js`
- `tests/rateLimiter.test.js` → `tests/unit/middleware/rate-limiter.test.js`
- `tests/rateLimitHeaders.test.js` → `tests/unit/middleware/rate-limit-headers.test.js`
- `tests/rbac-middleware.test.js` → `tests/unit/middleware/rbac-middleware.test.js`
- `tests/replayDetectionMiddleware.test.js` → `tests/unit/middleware/replay-detection-middleware.test.js`
- `tests/RequestCounter.test.js` → `tests/unit/middleware/request-counter.test.js`
- `tests/validation-middleware.test.js` → `tests/unit/middleware/validation-middleware.test.js`

#### Service Tests
- `tests/MockStellarService.test.js` → `tests/unit/services/mock-stellar-service.test.js`
- `tests/scheduler-resilience.test.js` → `tests/unit/services/scheduler-resilience.test.js`
- `tests/transaction-reconciliation.test.js` → `tests/unit/services/transaction-reconciliation.test.js`
- `tests/transaction-state-machine.test.js` → `tests/unit/services/transaction-state-machine.test.js`
- `tests/transaction-sync-consistency.test.js` → `tests/unit/services/transaction-sync-consistency.test.js`

#### Utils Tests
- `tests/correlation.test.js` → `tests/unit/utils/correlation.test.js`
- `tests/dataMasker.test.js` → `tests/unit/utils/data-masker.test.js`
- `tests/fieldValidator.test.js` → `tests/unit/utils/field-validator.test.js`
- `tests/replayDetectionLogic.test.js` → `tests/unit/utils/replay-detector-logic.test.js`
- `tests/trackingStore.test.js` → `tests/unit/utils/replay-detector-tracking.test.js`
- `tests/fingerprint.test.js` → `tests/unit/utils/replay-detector-fingerprint.test.js`
- `tests/cleanupTimer.test.js` → `tests/unit/utils/replay-detector-cleanup.test.js`
- `tests/sanitizer.test.js` → `tests/unit/utils/sanitizer.test.js`
- `tests/startupDiagnostics.test.js` → `tests/unit/utils/startup-diagnostics.test.js`
- `tests/validation.test.js` → `tests/unit/utils/validators.test.js`

#### Model Tests
- `tests/apiKeys.test.js` → `tests/unit/models/api-keys.test.js`
- `tests/permissions.test.js` → `tests/unit/models/permissions.test.js`

#### API Integration Tests
- `tests/api.test.js` → `tests/integration/api/api-routes.test.js`
- `tests/donation-routes-integration.test.js` → `tests/integration/api/donation-routes-integration.test.js`
- `tests/wallet-analytics-integration.test.js` → `tests/integration/api/wallet-analytics-integration.test.js`
- `tests/integration.test.js` → `tests/integration/api/integration.test.js`

#### Donation Integration Tests
- `tests/donation-boundary.test.js` → `tests/integration/donation/donation-boundary.test.js`
- `tests/donation-limits.test.js` → `tests/integration/donation/donation-limits.test.js`
- `tests/recurring-donation-failures.test.js` → `tests/integration/donation/recurring-donation-failures.test.js`

#### Security Integration Tests
- `tests/abuse-detection.test.js` → `tests/integration/security/abuse-detection.test.js`
- `tests/idempotency-integration.test.js` → `tests/integration/security/idempotency-integration.test.js`
- `tests/negative-authorization.test.js` → `tests/integration/security/negative-authorization.test.js`
- `tests/payload-field-validation-integration.test.js` → `tests/integration/security/payload-field-validation-integration.test.js`
- `tests/payloadSizeLimit-integration.test.js` → `tests/integration/security/payload-size-limit-integration.test.js`
- `tests/permission-integration.test.js` → `tests/integration/security/permission-integration.test.js`
- `tests/rbac-validation.test.js` → `tests/integration/security/rbac-validation.test.js`
- `tests/sanitization-integration.test.js` → `tests/integration/security/sanitization-integration.test.js`
- `tests/unknownFieldErrorFormat.test.js` → `tests/integration/security/unknown-field-error-format.test.js`

#### Replay Detection Integration Tests
- `tests/replayLogging.verification.test.js` → `tests/integration/logging/replay-logging-verification.test.js`
- `tests/responseHeaders.verification.test.js` → `tests/integration/logging/response-headers-verification.test.js`

#### Stellar Integration Tests
- `tests/account-funding.test.js` → `tests/integration/stellar/account-funding.test.js`
- `tests/advanced-failure-scenarios.test.js` → `tests/integration/stellar/advanced-failure-scenarios.test.js`
- `tests/failure-scenarios.test.js` → `tests/integration/stellar/failure-scenarios.test.js`
- `tests/network-timeout-scenarios.test.js` → `tests/integration/stellar/network-timeout-scenarios.test.js`
- `tests/stellar-network-failures.test.js` → `tests/integration/stellar/stellar-network-failures.test.js`
- `tests/stellar-retry-logic.test.js` → `tests/integration/stellar/stellar-retry-logic.test.js`
- `tests/transaction-status.test.js` → `tests/integration/stellar/transaction-status.test.js`
- `tests/transaction-sync-failures.test.js` → `tests/integration/stellar/transaction-sync-failures.test.js`

#### Logging Integration Tests
- `tests/logger-integration.test.js` → `tests/integration/logging/logger-integration.test.js`
- `tests/logger-masking.test.js` → `tests/integration/logging/logger-masking.test.js`

#### Validation Integration Tests
- `tests/memo-integration.test.js` → `tests/integration/validation/memo-integration.test.js`
- `tests/memo-validation.test.js` → `tests/integration/validation/memo-validation.test.js`

#### Regression Tests
- `tests/error-codes.test.js` → `tests/integration/regression/error-codes.test.js`
- `tests/error-hardening.test.js` → `tests/integration/regression/error-hardening.test.js`
- `tests/regression.test.js` → `tests/integration/regression/regression.test.js`
- `tests/regression-additional.test.js` → `tests/integration/regression/regression-additional.test.js`
- `tests/test-isolation.test.js` → `tests/integration/regression/test-isolation.test.js`

#### E2E Tests
- `tests/debug-mode.test.js` → `tests/e2e/debug-mode.test.js`
- `tests/requestId-correlation.test.js` → `tests/e2e/request-id-correlation.test.js`

#### Deprecated/Utility Files (to be reviewed)
- `tests/test-edge-cases.js` → Review and integrate into appropriate test files
- `tests/test-send-donation.js` → Review and integrate into appropriate test files
- `tests/wallet-analytics.test.js` → `tests/integration/api/wallet-analytics.test.js`

## Implementation Strategy

### Phase 1: Preparation
1. Create new directory structure
2. Document current test coverage baseline
3. Create migration script for automated moves

### Phase 2: Unit Tests Migration
1. Move config tests
2. Move middleware tests
3. Move service tests
4. Move utils tests
5. Move model tests
6. Update import paths
7. Run tests to verify

### Phase 3: Integration Tests Migration
1. Move API integration tests
2. Move donation integration tests
3. Move security integration tests
4. Move stellar integration tests
5. Move logging integration tests
6. Move validation integration tests
7. Move regression tests
8. Update import paths
9. Run tests to verify

### Phase 4: E2E Tests Migration
1. Move E2E tests
2. Update import paths
3. Run tests to verify

### Phase 5: Cleanup & Documentation
1. Remove old test files
2. Update test documentation
3. Create test organization guide
4. Update CI/CD configuration if needed
5. Final test run

## Import Path Updates

### Pattern 1: Relative imports from test to src
**Before**: `require('../src/utils/fieldValidator')`
**After**: `require('../../../src/utils/fieldValidator')` (for unit tests)
**After**: `require('../../../src/utils/fieldValidator')` (for integration tests)

### Pattern 2: Helper imports
**Before**: `require('./helpers/testIsolation')`
**After**: `require('../../helpers/testIsolation')` (for unit tests)
**After**: `require('../../helpers/testIsolation')` (for integration tests)

### Pattern 3: Setup file
**Before**: Automatically loaded by Jest
**After**: Update `jest.config.js` to point to `tests/setup.js`

## Naming Convention Rules

### File Naming
1. Use `kebab-case` for all test files
2. Suffix with `.test.js` for unit tests
3. Suffix with `-integration.test.js` for integration tests
4. Match source file names where applicable

### Examples
- `RequestCounter.test.js` → `request-counter.test.js`
- `MockStellarService.test.js` → `mock-stellar-service.test.js`
- `apiKeys.test.js` → `api-keys.test.js`
- `fieldSchemas.test.js` → `field-schemas.test.js`

## Test Configuration Updates

### jest.config.js
```javascript
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html']
};
```

### package.json scripts
```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "jest tests/e2e",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

## Documentation

### tests/README.md
Create comprehensive guide covering:
- Directory structure explanation
- Where to place new tests
- Naming conventions
- Running specific test suites
- Writing tests that follow conventions

## Risk Mitigation

### Risks
1. **Import path errors**: Incorrect relative paths after moving files
2. **Test failures**: Tests may fail due to path issues
3. **CI/CD breakage**: Pipeline may need configuration updates
4. **Lost tests**: Files accidentally not moved

### Mitigation Strategies
1. **Automated migration script**: Reduce manual errors
2. **Incremental approach**: Move and verify in phases
3. **Git tracking**: Use `git mv` to preserve history
4. **Test baseline**: Document passing tests before starting
5. **Rollback plan**: Keep old structure until verification complete

## Validation Criteria

### Success Metrics
- [ ] All 70+ test files moved to new locations
- [ ] All tests pass with same results as before
- [ ] No test logic modified
- [ ] All import paths updated correctly
- [ ] CI/CD pipeline runs successfully
- [ ] Test coverage remains unchanged
- [ ] Documentation updated

### Verification Steps
1. Run full test suite before refactoring (baseline)
2. After each phase, run affected tests
3. After completion, run full test suite
4. Compare coverage reports before/after
5. Verify CI/CD pipeline
6. Manual review of random sample of moved files

## Correctness Properties

### Property 1: Test Count Preservation
**Description**: The total number of test files must remain constant
**Validation**: Count files before and after migration
```bash
# Before
find tests -name "*.test.js" | wc -l

# After
find tests -name "*.test.js" | wc -l
```

### Property 2: Test Logic Immutability
**Description**: No test assertions or logic should change
**Validation**: Git diff should only show file moves and import path changes
```bash
git diff --stat
# Should show only file renames and import updates
```

### Property 3: Test Pass Rate Consistency
**Description**: All tests that passed before must pass after
**Validation**: Compare test results before and after
```bash
# Before
npm test 2>&1 | tee before.log

# After
npm test 2>&1 | tee after.log

# Compare
diff before.log after.log
```

### Property 4: Import Path Correctness
**Description**: All import paths must resolve correctly
**Validation**: No module resolution errors
```bash
npm test 2>&1 | grep -i "cannot find module"
# Should return no results
```

### Property 5: Coverage Preservation
**Description**: Code coverage percentage must not decrease
**Validation**: Compare coverage reports
```bash
# Before
npm run test:coverage > coverage-before.txt

# After
npm run test:coverage > coverage-after.txt
```

## Migration Script Outline

```javascript
// migrate-tests.js
const fs = require('fs');
const path = require('path');

const fileMapping = {
  'config.test.js': 'unit/config/config.test.js',
  'fieldSchemas.test.js': 'unit/config/field-schemas.test.js',
  // ... full mapping
};

function updateImportPaths(content, oldPath, newPath) {
  // Calculate relative path difference
  // Update require() statements
  // Return updated content
}

function migrateFile(oldPath, newPath) {
  // Read file content
  // Update import paths
  // Create new directory if needed
  // Write to new location
  // Verify file was written correctly
}

// Execute migration
Object.entries(fileMapping).forEach(([old, new]) => {
  migrateFile(old, new);
});
```

## Rollback Plan

If issues arise:
1. Revert all changes using Git
2. Analyze failures
3. Fix migration script
4. Re-attempt migration

```bash
# Rollback command
git reset --hard HEAD
git clean -fd
```

## Timeline Estimate

- Phase 1 (Preparation): 1 hour
- Phase 2 (Unit Tests): 2 hours
- Phase 3 (Integration Tests): 3 hours
- Phase 4 (E2E Tests): 30 minutes
- Phase 5 (Cleanup): 1 hour
- **Total**: ~7.5 hours

## Future Considerations

### Potential Enhancements
1. Add test tags for filtering (e.g., @slow, @integration)
2. Separate smoke tests for quick validation
3. Performance test suite
4. Visual regression tests
5. Contract tests for API endpoints

### Maintenance Guidelines
1. New tests must follow directory structure
2. Test file names must match source files
3. Integration tests require `-integration.test.js` suffix
4. Update README when adding new test categories
