# Chaos Testing Feature

## Overview
Chaos testing is a resilience testing approach that introduces controlled random failures to verify system stability and surface hidden assumptions. This feature helps ensure the Stellar Micro Donation API handles unexpected failures gracefully without crashes or data corruption.

## Purpose
- Verify system resilience under adverse conditions
- Surface hidden assumptions in code
- Test error handling and recovery mechanisms
- Ensure data integrity during failures
- Validate system stability under stress

## Implementation

### Test Files
- `tests/chaos-simple.test.js` - Quick verification tests (recommended)
- `tests/chaos-testing.test.js` - Comprehensive chaos suite
- `tests/helpers/chaosHelper.js` - Reusable chaos utilities

### Helper Utility
The `ChaosHelper` class provides reusable chaos injection:
- Random failure injection
- Configurable failure rates
- Metrics tracking
- Concurrent operation testing
- Predefined chaos scenarios

## Usage

### Run Chaos Tests
```bash
# Quick verification (recommended)
npm test -- chaos-simple.test.js

# Comprehensive suite
npm run test:chaos

# Skip chaos tests
npm run test:no-chaos
```

### Configuration
Chaos behavior is configurable in test files:

```javascript
const CHAOS_CONFIG = {
  failureProbability: 0.3,  // 30% failure rate
  iterations: 20,            // 20 iterations per test
  verbose: false,            // Detailed logging
};
```

## Test Scenarios

### 1. Random Transaction Failures
Tests system behavior when Stellar transactions randomly fail
- Verifies no crashes occur
- Ensures system remains responsive
- Validates error handling

### 2. Balance Consistency
Tests financial data integrity under chaos
- Verifies balance matches successful transactions
- Ensures no phantom transactions
- Validates atomic operations

### 3. Concurrent Operations
Tests concurrent transaction handling with failures
- Verifies no race conditions
- Ensures proper transaction ordering
- Validates system responsiveness

### 4. High Failure Rate Recovery
Tests system recovery under extreme conditions
- 70% failure rate
- Verifies eventual success
- Ensures no permanent damage

## Results

### Latest Test Run
```
📊 Quick Chaos Results:
   Total: 43
   Success: 20
   Failures: 23
   Crashes: 0
   Status: ✅ PASS
```

### Key Findings
✅ **Zero Crashes**: System never crashes despite failures  
✅ **Data Integrity**: No corruption detected  
✅ **Balance Consistency**: Financial data remains accurate  
✅ **Error Recovery**: System recovers from failures  
✅ **Responsiveness**: Remains operational after errors

## Integration

### CI/CD Pipeline
```yaml
# Run chaos tests nightly
- name: Chaos Testing
  run: npm test -- chaos-simple.test.js
  
# Fail if crashes detected
- name: Check Results
  run: |
    if grep -q "Crashes: 0" test-output.txt; then
      echo "✅ Chaos tests passed"
    else
      exit 1
    fi
```

### Development Workflow
1. Run chaos tests before major releases
2. Use to validate error handling improvements
3. Run after significant refactoring
4. Include in nightly test runs

## Metrics Tracked

- **Total Operations**: Number of operations attempted
- **Successes**: Operations that completed successfully
- **Failures**: Operations that failed (expected in chaos)
- **Crashes**: System crashes (should always be 0)
- **Status**: Overall pass/fail status

## Best Practices

### When to Run
- ✅ Before production deployments
- ✅ After error handling changes
- ✅ During nightly builds
- ❌ Not in pre-commit hooks (too slow)

### Interpreting Results
- **Crashes = 0**: Required for passing
- **Some failures**: Expected and healthy
- **All failures**: Check failure rate configuration
- **All successes**: Increase failure rate

### Adjusting Chaos
```javascript
// Light chaos (development)
failureProbability: 0.1,  // 10%
iterations: 10,

// Moderate chaos (CI/CD)
failureProbability: 0.3,  // 30%
iterations: 20,

// Heavy chaos (nightly)
failureProbability: 0.5,  // 50%
iterations: 50,
```

## Documentation

- **Quick Reference**: `docs/CHAOS_TESTING_GUIDE.md`
- **Detailed Results**: `docs/CHAOS_TESTING_RESULTS.md`
- **Implementation Summary**: `CHAOS_TESTING_SUMMARY.md`

## Future Enhancements

### Planned
- [ ] Chaos testing dashboard
- [ ] Production chaos engineering
- [ ] Automated chaos scheduling
- [ ] Advanced failure patterns

### Potential Additions
- [ ] Network latency simulation
- [ ] Database corruption scenarios
- [ ] Memory pressure testing
- [ ] CPU throttling simulation

## Support

For questions or issues:
1. Review `docs/CHAOS_TESTING_GUIDE.md`
2. Check test output for specific failures
3. Adjust configuration as needed
4. Document new findings

## References

- [Chaos Engineering Principles](https://principlesofchaos.org/)
- [Netflix Chaos Monkey](https://netflix.github.io/chaosmonkey/)
- [Testing in Production](https://www.infoq.com/articles/testing-in-production/)

---

**Status**: ✅ Implemented and Tested  
**Version**: 1.0.0  
**Last Updated**: 2026-02-26
