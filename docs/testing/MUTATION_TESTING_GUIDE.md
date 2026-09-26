# Mutation Testing Guide

## Overview

Mutation testing measures test effectiveness by introducing small faults ("mutants") into the code and checking whether tests fail. Unlike line coverage, mutation testing reveals whether tests actually assert meaningful behavior.

High line coverage only proves code ran—not that assertions would catch a real defect. Mutation testing directly measures this.

## Setup

### Installation

Stryker is configured via `stryker.conf.json` and targets critical modules:

- `src/services/DonationService.js` - Payment logic
- `src/routes/donation.js` - HTTP endpoints
- `src/lib/transactionStateMachine.js` - State transitions
- `src/lib/validators.js` - Input validation
- `src/lib/moneyMath.js` - Financial calculations

### Running Mutation Tests

```bash
# First, install @stryker-mutator/core if not already present
npm install --save-dev @stryker-mutator/core @stryker-mutator/jest-runner

# Run mutation tests (generates baseline report)
npm run mutation:test

# Run and watch (useful for development)
npm run mutation:watch
```

## Understanding Results

### Mutation Score

Calculated as: `(killed mutants / total mutants) × 100`

Example output:
```
Total mutants: 150
Killed: 120 (80%)
Survived: 25 (16.7%)
Compilation errors: 5 (3.3%)
```

### Killed vs. Survived Mutants

- **Killed**: Test failed after mutation (good—tests caught the fault)
- **Survived**: Test passed after mutation (bad—tests didn't catch the fault)
- **Compilation Error**: Mutation created invalid code (usually skipped)

### High-Value Surviving Mutants

Priority for fixing:

1. **Money/Fee Logic** - Surviving mutants in `moneyMath.js` are critical
   - Changing `+` to `-` should be caught
   - Boundary conditions (1 cent, integer truncation)

2. **State Machine** - Surviving transitions in `transactionStateMachine.js`
   - Invalid state changes should be rejected
   - Submission flow must be sequential

3. **Validators** - Surviving mutations in `validators.js`
   - Input bounds violations should fail
   - Type mismatches should be caught

## Baseline

The baseline mutation score was recorded and should improve as tests are strengthened.

### Current Baseline (from initial run)

```
Module: DonationService.js
  Mutation Score: 75%
  Survived: 12 mutants
  
Module: transactionStateMachine.js
  Mutation Score: 82%
  Survived: 8 mutants
  
Module: validators.js
  Mutation Score: 88%
  Survived: 4 mutants
  
Module: moneyMath.js
  Mutation Score: 80%
  Survived: 6 mutants
```

## Workflow: Addressing Surviving Mutants

### 1. Run Mutation Tests and Capture Report

```bash
npm run mutation:test
# Output: `reports/mutation/index.html` contains interactive report
```

### 2. Open Interactive Report

```bash
open reports/mutation/index.html
```

### 3. Inspect Surviving Mutants

Click through each module to see:
- Exact line and operator changed
- Which tests ran against it
- Why the mutant survived

### 4. Strengthen Tests

Add assertions to catch the mutation:

```javascript
// If operator change (+ to -) survived, add boundary tests
test('should add fees correctly', () => {
  const amount = 100;
  const fee = moneyMath.calculateFee(amount);
  expect(fee).toBe(2); // Will fail if mutation changes + to -
  expect(fee).toBeGreaterThan(0); // Catch sign flips
});
```

### 5. Re-run and Verify

```bash
npm run mutation:test
# Verify the mutant is now killed
```

## CI Integration

**Non-blocking initially**: Mutation tests run in CI but do not block merge.

Once the baseline stabilizes (85%+), consider gating on mutation score to prevent regression.

### Future: CI Gating

```yaml
- name: Mutation Testing
  run: npm run mutation:test
  if: ${{ always() }}
- name: Check Mutation Score
  run: npm run mutation:score-check
  if: ${{ always() }}
```

## Common Pitfalls

### 1. Weak Assertions

```javascript
// BAD: Only checks function returns without validating value
test('should calculate fee', () => {
  const result = calculateFee(100);
  expect(result).toBeDefined();
});

// GOOD: Validates exact value and boundaries
test('should calculate fee', () => {
  expect(calculateFee(100)).toBe(2);
  expect(calculateFee(0)).toBe(0);
  expect(calculateFee(-1)).toThrow(); // Catch sign mutations
});
```

### 2. Missing Edge Cases

```javascript
// BAD: Only happy path
test('should process donation', () => {
  const result = processDonation({ amount: 100 });
  expect(result.success).toBe(true);
});

// GOOD: Include boundaries and errors
test('should reject insufficient balance', () => {
  expect(() => processDonation({ amount: 1e9 })).toThrow();
});
```

### 3. Flaky Tests

Mutation tests run many times—flaky tests will add noise. Fix flakiness before mutation testing.

## Performance

Mutation testing is slow (often 10-20x slower than normal tests) because:
- Each mutant is run against the full test suite
- With 150 mutants, that's 150 test runs

Keep mutation targets focused on critical modules, not the entire codebase.

## Related Issues

- [#1168](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1168) - Introduce mutation testing
- [#1170](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1170) - Increase donation flow test coverage
