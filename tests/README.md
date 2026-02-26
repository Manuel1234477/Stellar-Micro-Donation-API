# Test Organization Guide

## Overview
This directory contains all tests for the Stellar Micro-Donation API, organized by test type and domain for easy navigation and maintainability.

## Directory Structure

```
tests/
├── unit/              # Unit tests (test individual modules in isolation)
│   ├── config/        # Configuration module tests
│   ├── middleware/    # Middleware function tests
│   ├── services/      # Service layer tests
│   ├── utils/         # Utility function tests
│   └── models/        # Data model tests
├── integration/       # Integration tests (test component interactions)
│   ├── api/           # API endpoint integration tests
│   ├── donation/      # Donation flow integration tests
│   ├── security/      # Security feature integration tests
│   ├── stellar/       # Stellar blockchain integration tests
│   ├── logging/       # Logging system integration tests
│   ├── validation/    # Validation integration tests
│   └── regression/    # Regression tests for bug fixes
├── e2e/              # End-to-end tests (full system tests)
├── helpers/          # Shared test utilities and fixtures
└── setup.js          # Jest test configuration
```

## Test Types

### Unit Tests (`tests/unit/`)
Test individual functions, classes, or modules in isolation. These tests:
- Run quickly
- Have no external dependencies
- Mock all dependencies
- Focus on a single unit of code

**Example**: Testing a validation function with various inputs

### Integration Tests (`tests/integration/`)
Test how multiple components work together. These tests:
- May use real dependencies
- Test interactions between modules
- Verify data flow between components
- May use test databases or mock services

**Example**: Testing an API endpoint with middleware, validation, and service layers

### E2E Tests (`tests/e2e/`)
Test complete user workflows through the entire system. These tests:
- Test the full application stack
- Simulate real user scenarios
- May use external services (or mocks)
- Run slower than unit/integration tests

**Example**: Testing a complete donation flow from API request to blockchain transaction

## Naming Conventions

### File Naming
- Use `kebab-case` for all test files
- Unit tests: `module-name.test.js`
- Integration tests: `feature-name-integration.test.js` or `feature-name.test.js`
- Match source file names where applicable

**Examples**:
- `field-validator.test.js` (unit test for `src/utils/fieldValidator.js`)
- `donation-routes-integration.test.js` (integration test for donation routes)
- `mock-stellar-service.test.js` (unit test for MockStellarService)

### Test Suite Naming
Use descriptive `describe()` blocks that clearly indicate what is being tested:

```javascript
describe('Field Validator', () => {
  describe('detectUnknownFields', () => {
    it('should return empty array when all fields are allowed', () => {
      // test code
    });
  });
});
```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Unit Tests Only
```bash
npm run test:unit
```

### Run Integration Tests Only
```bash
npm run test:integration
```

### Run E2E Tests Only
```bash
npm run test:e2e
```

### Run Specific Test File
```bash
npm test tests/unit/utils/field-validator.test.js
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

## Where to Place New Tests

### Adding a Unit Test
1. Identify the source file you're testing (e.g., `src/utils/newUtil.js`)
2. Create test file in corresponding unit directory (e.g., `tests/unit/utils/new-util.test.js`)
3. Use relative imports: `require('../../../src/utils/newUtil')`

### Adding an Integration Test
1. Identify the feature domain (api, security, stellar, etc.)
2. Create test file in appropriate integration subdirectory
3. Use descriptive name indicating what's being integrated
4. Use relative imports: `require('../../../src/...`)'

### Adding an E2E Test
1. Create test file in `tests/e2e/`
2. Name it after the user workflow being tested
3. Use relative imports: `require('../../src/...')`

## Import Path Patterns

### From Unit Tests
```javascript
// Importing from src
const validator = require('../../../src/utils/fieldValidator');

// Importing test helpers
const { resetMockStellarService } = require('../../helpers/testIsolation');
```

### From Integration Tests
```javascript
// Importing from src
const app = require('../../../src/routes/app');

// Importing test helpers
const { resetMockStellarService } = require('../../helpers/testIsolation');
```

### From E2E Tests
```javascript
// Importing from src
const app = require('../../src/routes/app');

// Importing test helpers
const { resetMockStellarService } = require('../helpers/testIsolation');
```

## Test Helpers

Shared test utilities are located in `tests/helpers/`:
- `testIsolation.js` - Functions for isolating test state and resetting mocks

## Best Practices

### 1. Test Organization
- Keep tests close to what they test conceptually
- One test file per source file for unit tests
- Group related integration tests by feature domain

### 2. Test Independence
- Each test should be independent and not rely on other tests
- Use `beforeEach` and `afterEach` for setup and cleanup
- Reset mocks and clear state between tests

### 3. Test Naming
- Use descriptive test names that explain what is being tested
- Follow the pattern: "should [expected behavior] when [condition]"
- Make test failures self-explanatory

### 4. Test Coverage
- Aim for high coverage of critical paths
- Don't sacrifice test quality for coverage percentage
- Focus on testing behavior, not implementation details

### 5. Mock Usage
- Mock external dependencies in unit tests
- Use real implementations in integration tests when possible
- Keep mocks simple and focused

## Common Patterns

### Testing Middleware
```javascript
const middleware = require('../../../src/middleware/myMiddleware');

describe('My Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { body: {}, headers: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  it('should call next() for valid requests', () => {
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

### Testing API Endpoints
```javascript
const request = require('supertest');
const app = require('../../../src/routes/app');

describe('POST /donations', () => {
  it('should create a donation with valid data', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .send({ amount: '100', recipient: 'GXXX...' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});
```

### Testing Services
```javascript
const MyService = require('../../../src/services/MyService');

describe('MyService', () => {
  let service;

  beforeEach(() => {
    service = new MyService();
  });

  it('should process data correctly', async () => {
    const result = await service.processData({ input: 'test' });
    expect(result).toBeDefined();
  });
});
```

## Troubleshooting

### Import Path Errors
If you see "Cannot find module" errors:
1. Check the relative path depth (count `../` needed to reach project root)
2. Verify the source file exists at the expected location
3. Ensure you're using the correct path separator (`/` not `\`)

### Test Isolation Issues
If tests pass individually but fail when run together:
1. Check for shared state between tests
2. Ensure proper cleanup in `afterEach` hooks
3. Verify mocks are reset between tests
4. Use `testIsolation` helpers for environment cleanup

### Slow Tests
If tests run slowly:
1. Check for unnecessary async operations
2. Reduce timeout values in tests
3. Mock external services instead of using real ones
4. Consider moving slow tests to integration or e2e suites

## Contributing

When adding new tests:
1. Follow the directory structure and naming conventions
2. Add appropriate documentation in test comments
3. Ensure tests are independent and repeatable
4. Update this README if adding new test categories
5. Run the full test suite before committing

## Questions?

For questions about test organization or best practices, refer to:
- `.kiro/specs/test-organization-refactor/` - Original refactoring spec
- Project documentation in `docs/`
- Team guidelines and standards
