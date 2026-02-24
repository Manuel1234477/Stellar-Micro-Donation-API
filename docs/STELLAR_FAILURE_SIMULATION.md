# Stellar Network Failure Simulation

## Overview

The MockStellarService now includes comprehensive failure simulation capabilities to test how the application handles various Stellar network failures, timeouts, and error conditions.

## Features

### Failure Types Supported

1. **timeout** - Request timeout errors
2. **network_error** - General network connectivity issues
3. **service_unavailable** - Stellar Horizon service unavailable
4. **bad_sequence** - Transaction sequence number mismatch
5. **tx_failed** - Transaction failed due to network congestion
6. **tx_insufficient_fee** - Transaction fee too low
7. **connection_refused** - Connection refused by server
8. **rate_limit_horizon** - Horizon API rate limit exceeded
9. **partial_response** - Incomplete/corrupted response data
10. **ledger_closed** - Transaction missed ledger window

### Key Capabilities

- **Configurable Probability**: Set failure rate from 0% to 100%
- **Consecutive Failure Tracking**: Monitor failure streaks
- **Auto-Recovery**: Automatically recover after N consecutive failures
- **Retryable Errors**: All simulated errors include retry guidance
- **State Preservation**: Failures don't corrupt internal state

## Usage

### Basic Usage

```javascript
const { getStellarService } = require('./src/config/stellar');

// Get mock stellar service
const stellarService = getStellarService();

// Enable timeout simulation (100% failure rate)
stellarService.enableFailureSimulation('timeout', 1.0);

// Try operation - will fail with timeout
try {
  await stellarService.getBalance(publicKey);
} catch (error) {
  console.log(error.message); // "Request timeout..."
  console.log(error.details.retryable); // true
  console.log(error.details.retryAfter); // 5000 (ms)
}

// Disable failure simulation
stellarService.disableFailureSimulation();
```

### Intermittent Failures

```javascript
// Simulate 30% failure rate
stellarService.enableFailureSimulation('network_error', 0.3);

// Some requests will fail, others will succeed
for (let i = 0; i < 10; i++) {
  try {
    await stellarService.getBalance(publicKey);
    console.log('Success');
  } catch (error) {
    console.log('Failed');
  }
}
```

### Auto-Recovery After Consecutive Failures

```javascript
// Enable failure simulation
stellarService.enableFailureSimulation('timeout', 1.0);

// Set max consecutive failures before auto-recovery
stellarService.setMaxConsecutiveFailures(3);

// First 3 attempts will fail, then auto-recover
for (let i = 0; i < 5; i++) {
  try {
    await stellarService.getBalance(publicKey);
    console.log(`Attempt ${i + 1}: Success`);
  } catch (error) {
    console.log(`Attempt ${i + 1}: Failed`);
  }
}
// Output:
// Attempt 1: Failed
// Attempt 2: Failed
// Attempt 3: Failed
// Attempt 4: Success
// Attempt 5: Success
```

## Testing Scenarios

### Test Timeout Handling

```javascript
describe('Timeout Handling', () => {
  test('should handle timeout gracefully', async () => {
    stellarService.enableFailureSimulation('timeout', 1.0);
    
    await expect(
      stellarService.getBalance(publicKey)
    ).rejects.toThrow(/timeout/i);
  });
});
```

### Test Retry Logic

```javascript
describe('Retry Logic', () => {
  test('should retry on transient errors', async () => {
    stellarService.enableFailureSimulation('network_error', 1.0);
    stellarService.setMaxConsecutiveFailures(2);
    
    // Should succeed after 2 failures
    const balance = await stellarService.getBalance(publicKey);
    expect(balance).toBeDefined();
  });
});
```

### Test Transaction Failures

```javascript
describe('Transaction Failures', () => {
  test('should handle bad sequence error', async () => {
    stellarService.enableFailureSimulation('bad_sequence', 1.0);
    
    await expect(
      stellarService.sendDonation({
        sourceSecret,
        destinationPublic,
        amount: '100',
        memo: 'Test'
      })
    ).rejects.toThrow(/bad_seq/i);
  });
});
```

### Test Concurrent Operations

```javascript
describe('Concurrent Operations', () => {
  test('should handle concurrent failures', async () => {
    stellarService.enableFailureSimulation('timeout', 0.5);
    stellarService.setMaxConsecutiveFailures(2);
    
    const promises = Array(10).fill(null).map(() =>
      stellarService.getBalance(publicKey)
    );
    
    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled');
    
    expect(successful.length).toBeGreaterThan(0);
  });
});
```

## Error Response Format

All simulated failures return errors with the following structure:

```javascript
{
  message: "Request timeout - Stellar network may be experiencing high load. Please try again.",
  code: "TRANSACTION_FAILED",
  details: {
    retryable: true,      // Whether this error can be retried
    retryAfter: 5000      // Suggested retry delay in milliseconds
  }
}
```

## Retry Guidance by Error Type

| Error Type | Retryable | Retry Delay | Notes |
|------------|-----------|-------------|-------|
| timeout | Yes | 5000ms | Network may be slow |
| network_error | Yes | 3000ms | Connection issues |
| service_unavailable | Yes | 10000ms | Service maintenance |
| bad_sequence | Yes | 1000ms | Concurrent transaction |
| tx_failed | Yes | 2000ms | Network congestion |
| tx_insufficient_fee | Yes | 1000ms | Increase fee |
| connection_refused | Yes | 5000ms | Server unavailable |
| rate_limit_horizon | Yes | 60000ms | Rate limit exceeded |
| partial_response | Yes | 2000ms | Data corruption |
| ledger_closed | Yes | 5000ms | Missed ledger window |

## Best Practices

### 1. Always Clean Up

```javascript
afterEach(() => {
  if (stellarService.disableFailureSimulation) {
    stellarService.disableFailureSimulation();
  }
});
```

### 2. Test Both Success and Failure Paths

```javascript
test('should handle intermittent failures', async () => {
  stellarService.enableFailureSimulation('timeout', 0.5);
  
  const results = [];
  for (let i = 0; i < 10; i++) {
    try {
      await stellarService.getBalance(publicKey);
      results.push('success');
    } catch (error) {
      results.push('failure');
    }
  }
  
  expect(results).toContain('success');
  expect(results).toContain('failure');
});
```

### 3. Verify State Integrity

```javascript
test('should not corrupt state on failure', async () => {
  const initialBalance = await stellarService.getBalance(publicKey);
  
  stellarService.enableFailureSimulation('tx_failed', 1.0);
  
  try {
    await stellarService.sendDonation({...});
  } catch (error) {
    // Expected failure
  }
  
  stellarService.disableFailureSimulation();
  const finalBalance = await stellarService.getBalance(publicKey);
  
  expect(finalBalance.balance).toBe(initialBalance.balance);
});
```

### 4. Test Retry Exhaustion

```javascript
test('should fail after max retries', async () => {
  stellarService.enableFailureSimulation('timeout', 1.0);
  stellarService.setMaxConsecutiveFailures(0); // Never recover
  
  await expect(
    stellarService.getBalance(publicKey)
  ).rejects.toThrow();
});
```

## Real-World Scenarios

### Network Congestion

```javascript
// Simulate high network congestion
stellarService.enableFailureSimulation('tx_failed', 0.7);

// Multiple transactions, some will fail
const results = await Promise.allSettled(
  transactions.map(tx => stellarService.sendDonation(tx))
);
```

### Service Degradation and Recovery

```javascript
// Phase 1: Service degradation (80% failure)
stellarService.enableFailureSimulation('service_unavailable', 0.8);
// ... perform operations ...

// Phase 2: Recovery (20% failure)
stellarService.enableFailureSimulation('service_unavailable', 0.2);
// ... perform operations ...

// Phase 3: Full recovery
stellarService.disableFailureSimulation();
```

### Rate Limiting

```javascript
// Simulate hitting rate limits
stellarService.enableFailureSimulation('rate_limit_horizon', 1.0);

try {
  await stellarService.getBalance(publicKey);
} catch (error) {
  // Wait for suggested retry delay
  await new Promise(resolve => 
    setTimeout(resolve, error.details.retryAfter)
  );
  
  // Retry after delay
  stellarService.disableFailureSimulation();
  const balance = await stellarService.getBalance(publicKey);
}
```

## Integration with Existing Tests

The failure simulation integrates seamlessly with existing tests:

```javascript
describe('Donation Flow', () => {
  test('should handle network failures during donation', async () => {
    const donor = await stellarService.createWallet();
    const recipient = await stellarService.createWallet();
    
    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey);
    
    // Enable failure simulation
    stellarService.enableFailureSimulation('timeout', 0.3);
    stellarService.setMaxConsecutiveFailures(2);
    
    // Donation should eventually succeed despite failures
    const result = await stellarService.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '100',
      memo: 'Test donation'
    });
    
    expect(result.transactionId).toBeDefined();
  });
});
```

## Limitations

1. **No Actual Network Delay**: Failures are instant, no actual network latency
2. **Simplified Error Responses**: Real Stellar errors may have more complex structures
3. **No Partial State Changes**: Transactions either fully succeed or fully fail
4. **No Network Partition Simulation**: Can't simulate split-brain scenarios
5. **No Byzantine Failures**: Can't simulate malicious node behavior

## Future Enhancements

- [ ] Add network latency simulation
- [ ] Support custom error messages
- [ ] Add failure injection at specific points
- [ ] Support failure patterns (e.g., every Nth request fails)
- [ ] Add metrics collection for failure analysis
- [ ] Support conditional failures based on operation type
- [ ] Add failure replay from logs

## Related Documentation

- [MockStellarService Documentation](./MOCK_STELLAR_GUIDE.md)
- [Test Coverage Guide](./COVERAGE_GUIDE.md)
- [Error Handling](../src/utils/errors.js)
- [Retry Logic](../src/services/StellarService.js)

## Support

For issues or questions about failure simulation:
1. Check test examples in `tests/stellar-network-failures.test.js`
2. Review retry logic tests in `tests/stellar-retry-logic.test.js`
3. See MockStellarService implementation in `src/services/MockStellarService.js`
