# Flaky Test Quarantine and Retry Policy

## Overview

Flaky tests—tests that pass or fail randomly—degrade CI signal and erode developer trust. This document establishes a quarantine mechanism and retry policy to isolate and track flaky tests while they're being fixed.

## Policy

### Identifying Flaky Tests

A test is considered flaky if:
- It fails intermittently without code changes
- It passes on re-run without modification
- It fails in bulk runs but passes in isolation

### Quarantine Process

1. **Detect**: When a flaky test is discovered, add it to the `tests/quarantine.js` registry
2. **Tag**: Mark the test with `.skip()` or use the `FLAKY_TEST` environment variable
3. **Track**: Add an issue to track removal from quarantine with an owner and deadline
4. **Document**: Link the issue in the test code
5. **Run**: Quarantined tests run separately with bounded retries (see CI configuration)

### Quarantine Registry

Quarantined tests are tracked in `tests/quarantine.js`:

```javascript
// tests/quarantine.js
module.exports = {
  'test-name': {
    issue: '#XXXX',
    owner: 'username',
    reason: 'Intermittent Horizon timeout',
    addedDate: '2026-06-29',
    deadline: '2026-07-15',
  },
};
```

### Retry Policy

- **Main test suite**: No retries (failures must be real)
- **Quarantined tests**: Up to 3 retries (allows transient failures)
- **CI gate**: Quarantined tests do not block merges (separate job)

### Removing from Quarantine

To remove a test from quarantine:
1. Verify the root cause is fixed (not just intermittent luck)
2. Run the test 20+ times in isolation to confirm stability
3. Update `tests/quarantine.js` to remove the entry
4. Close the tracking issue
5. Remove retry logic from the test

## CI Configuration

### Main Test Job

- Runs all non-quarantined tests
- No retries
- Blocks merge on failure

### Quarantine Job (separate)

- Runs only quarantined tests with 3 retries per test
- Does not block merge
- Reports flake rates in summary

## Implementation

### Jest Configuration

Create `jest.config.quarantine.js` to run quarantined tests separately:

```javascript
module.exports = {
  ...baseConfig,
  testMatch: ['**/tests/**/*.quarantine.test.js'],
};
```

Quarantined tests are named with `.quarantine.test.js` suffix for easy identification.

### Avoiding Silent Accumulation

- Review quarantine list quarterly
- Set deadline for each quarantined test
- Escalate tests past deadline to team leads
- Report flake rates in weekly metrics

## Example: Marking a Test as Quarantined

```javascript
describe('Donation flow with Horizon timeout (QUARANTINED)', () => {
  // Reference tracking issue
  // @quarantine #1234 - Intermittent Stellar network timeouts
  
  it('should retry Horizon submission on timeout', async () => {
    // Test implementation
  });
});
```

## Related Issues

- [#1171](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1171) - Establish flaky-test quarantine and retry policy
