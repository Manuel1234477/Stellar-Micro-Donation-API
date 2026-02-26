# Chaos Testing Quick Reference Guide

## What is Chaos Testing?

Chaos testing introduces controlled random failures to verify system resilience and surface hidden assumptions. Unlike traditional tests that verify expected behavior, chaos tests verify the system handles unexpected failures gracefully.

## Quick Start

### Run Chaos Tests
```bash
# Run all chaos tests
npm test -- chaos-testing.test.js

# Run with verbose output
npm test -- chaos-testing.test.js --verbose

# Run specific chaos category
npm test -- chaos-testing.test.js -t "Database Chaos"
```

### Skip Chaos Tests
```bash
# Skip during regular test runs
npm test -- --testPathIgnorePatterns=chaos-testing

# Or set environment variable
SKIP_CHAOS=true npm test
```

## Configuration

Edit `tests/chaos-testing.test.js` to adjust chaos parameters:

```javascript
const CHAOS_CONFIG = {
  // Probability of random failures (0-1)
  failureProbability: 0.3,  // 30% failure rate
  
  // Number of iterations for each test
  iterations: 20,
  
  // Enable detailed logging
  verbose: false,
};
```

### Recommended Configurations

**Development (Quick Feedback)**
```javascript
failureProbability: 0.2,
iterations: 10,
verbose: true,
```

**CI/CD (Balanced)**
```javascript
failureProbability: 0.3,
iterations: 20,
verbose: false,
```

**Nightly (Thorough)**
```javascript
failureProbability: 0.5,
iterations: 50,
verbose: true,
```

## Test Categories

### 1. Random Transaction Failures
Tests intermittent Stellar network failures
- ✅ No data corruption
- ✅ Balance consistency
- ✅ System recovery

### 2. Database Chaos
Tests database-level failures
- ✅ Lock handling
- ✅ I/O error recovery
- ✅ Connection timeouts

### 3. Race Condition Chaos
Tests concurrent operation safety
- ✅ No double-spending
- ✅ Balance consistency
- ✅ Transaction ordering

### 4. Resource Exhaustion
Tests system under load
- ✅ No memory leaks
- ✅ Proper cleanup
- ✅ Graceful degradation

### 5. Timing-Based Chaos
Tests timing variations
- ✅ No race conditions
- ✅ Timeout handling
- ✅ Sequence management

### 6. Error Recovery
Tests cascading failure recovery
- ✅ Recovery from failures
- ✅ No cascading corruption
- ✅ Clear error messages

## Using ChaosHelper

The `ChaosHelper` utility provides reusable chaos injection:

```javascript
const ChaosHelper = require('./helpers/chaosHelper');

// Create chaos helper
const chaos = new ChaosHelper({
  failureProbability: 0.3,
  minDelay: 0,
  maxDelay: 100,
  verbose: true,
});

// Wrap function with chaos
const chaoticFunction = chaos.wrapWithChaos(
  originalFunction,
  [new Error('Chaos error 1'), new Error('Chaos error 2')]
);

// Simulate flaky operation with retries
await chaos.simulateFlakyOperation(async () => {
  return await someOperation();
}, { maxRetries: 3, retryDelay: 100 });

// Get metrics
const metrics = chaos.getMetrics();
console.log(`Success rate: ${metrics.successRate}%`);
```

## Interpreting Results

### Success Criteria
- ✅ **Crashes: 0** - System never crashes
- ✅ **Data Corruption: 0** - Data remains consistent
- ✅ **Success Rate: >95%** - Most operations complete or fail gracefully

### Example Output
```
📊 Chaos Testing Results:
   Total Tests: 120
   Failures: 36          ← Expected (chaos injected)
   Crashes: 0            ← Must be 0
   Data Corruption: 0    ← Must be 0
   Successful Recoveries: 84
   Success Rate: 100.00% ← System didn't crash
```

### What to Look For

**🚨 Red Flags**
- Crashes > 0
- Data Corruption > 0
- Success Rate < 95%
- Inconsistent balances
- Memory leaks

**✅ Good Signs**
- Graceful error handling
- Consistent data state
- Proper error messages
- Automatic recovery
- No resource leaks

## Common Issues

### Issue: High Crash Rate
**Symptoms**: Crashes > 0  
**Cause**: Unhandled exceptions  
**Fix**: Add try-catch blocks, improve error handling

### Issue: Data Corruption
**Symptoms**: Inconsistent balances or state  
**Cause**: Race conditions, missing transactions  
**Fix**: Add transaction locking, improve concurrency control

### Issue: Memory Leaks
**Symptoms**: Increasing memory usage  
**Cause**: Unclosed connections, unsubscribed listeners  
**Fix**: Ensure proper cleanup in finally blocks

### Issue: Cascading Failures
**Symptoms**: One failure causes many others  
**Cause**: Missing error boundaries  
**Fix**: Add circuit breakers, isolate failures

## Best Practices

### 1. Run Regularly
- **Daily**: During development
- **Pre-commit**: Skip (too slow)
- **CI/CD**: On pull requests
- **Nightly**: Full suite with high iterations

### 2. Start Small
- Begin with low failure rates (10-20%)
- Increase gradually as system improves
- Use fewer iterations during development

### 3. Document Findings
- Record new failure patterns
- Update CHAOS_TESTING_RESULTS.md
- Track improvements over time

### 4. Fix Critical Issues First
- Priority 1: Crashes and data corruption
- Priority 2: Poor error messages
- Priority 3: Performance under chaos

### 5. Use in Production
- Apply lessons to monitoring
- Create alerts for chaos patterns
- Test disaster recovery procedures

## Integration Examples

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  testMatch: [
    '**/tests/**/*.test.js',
    '!**/tests/chaos-testing.test.js', // Skip by default
  ],
};
```

### GitHub Actions
```yaml
name: Chaos Testing
on:
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM

jobs:
  chaos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm test -- chaos-testing.test.js
      - name: Check Results
        run: |
          if grep -q "Crashes: 0" test-results.txt; then
            echo "✅ Chaos tests passed"
          else
            echo "❌ Chaos tests failed"
            exit 1
          fi
```

### Pre-commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Skip chaos tests in pre-commit
npm test -- --testPathIgnorePatterns=chaos-testing
```

## Advanced Usage

### Custom Chaos Scenarios
```javascript
const ChaosHelper = require('./helpers/chaosHelper');

// Create custom scenario
const customScenario = ChaosHelper.createScenario('Payment Chaos', {
  failureProbability: 0.4,
  iterations: 30,
  concurrency: 5,
  description: 'Chaos testing for payment flows',
});

// Use predefined scenarios
const scenario = ChaosHelper.SCENARIOS.HEAVY_CHAOS;
```

### Chaos Injection Patterns
```javascript
// Pattern 1: Wrap existing function
const chaoticDb = chaos.createChaoticDbQuery(Database.query);

// Pattern 2: Inline chaos
if (chaos.shouldFail()) {
  throw new Error('Chaos injected failure');
}

// Pattern 3: Concurrent chaos
const results = await chaos.simulateConcurrentChaos([
  () => operation1(),
  () => operation2(),
  () => operation3(),
]);
```

## Troubleshooting

### Tests Taking Too Long
- Reduce `iterations` in CHAOS_CONFIG
- Decrease `maxDelay` in ChaosHelper
- Run specific test categories only

### Too Many Failures
- Decrease `failureProbability`
- Check if system has real issues
- Review error handling logic

### Not Finding Issues
- Increase `failureProbability`
- Add more test scenarios
- Increase `iterations`
- Test more edge cases

## Resources

- **Main Test File**: `tests/chaos-testing.test.js`
- **Helper Utility**: `tests/helpers/chaosHelper.js`
- **Results Documentation**: `docs/CHAOS_TESTING_RESULTS.md`
- **This Guide**: `docs/CHAOS_TESTING_GUIDE.md`

## Support

For questions or issues:
1. Check CHAOS_TESTING_RESULTS.md for known issues
2. Review test output for specific failures
3. Adjust CHAOS_CONFIG for your needs
4. Document new findings in results file

---

**Remember**: Chaos testing is about finding problems before they find you in production! 🌪️
