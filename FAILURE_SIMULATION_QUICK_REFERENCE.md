# Stellar Failure Simulation - Quick Reference

## 🚀 Quick Start

```javascript
const stellarService = getStellarService();

// Enable failure
stellarService.enableFailureSimulation('timeout', 1.0);

// Disable failure
stellarService.disableFailureSimulation();
```

## 📋 Failure Types

| Type | Description | Retry Delay |
|------|-------------|-------------|
| `timeout` | Request timeout | 5s |
| `network_error` | Connection issues | 3s |
| `service_unavailable` | Horizon maintenance | 10s |
| `bad_sequence` | Sequence mismatch | 1s |
| `tx_failed` | Network congestion | 2s |
| `tx_insufficient_fee` | Fee too low | 1s |
| `connection_refused` | Server unavailable | 5s |
| `rate_limit_horizon` | Rate limit hit | 60s |
| `partial_response` | Data corruption | 2s |
| `ledger_closed` | Missed ledger | 5s |

## 🎯 Common Patterns

### 100% Failure Rate
```javascript
stellarService.enableFailureSimulation('timeout', 1.0);
```

### 50% Failure Rate
```javascript
stellarService.enableFailureSimulation('network_error', 0.5);
```

### Auto-Recovery After 3 Failures
```javascript
stellarService.enableFailureSimulation('timeout', 1.0);
stellarService.setMaxConsecutiveFailures(3);
```

## 🧪 Test Examples

### Test Timeout
```javascript
test('should handle timeout', async () => {
  stellarService.enableFailureSimulation('timeout', 1.0);
  await expect(
    stellarService.getBalance(publicKey)
  ).rejects.toThrow(/timeout/i);
});
```

### Test Retry Logic
```javascript
test('should retry on failure', async () => {
  stellarService.enableFailureSimulation('network_error', 1.0);
  stellarService.setMaxConsecutiveFailures(2);
  
  const balance = await stellarService.getBalance(publicKey);
  expect(balance).toBeDefined();
});
```

### Test Intermittent Failures
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

## 🔧 Error Response

```javascript
{
  message: "Request timeout - Stellar network may be...",
  code: "TRANSACTION_FAILED",
  details: {
    retryable: true,
    retryAfter: 5000
  }
}
```

## 📝 Best Practices

1. **Always clean up**:
```javascript
afterEach(() => {
  stellarService.disableFailureSimulation();
});
```

2. **Test both paths**:
```javascript
// Test success and failure
stellarService.enableFailureSimulation('timeout', 0.5);
```

3. **Verify state integrity**:
```javascript
const before = await stellarService.getBalance(publicKey);
// ... failure ...
const after = await stellarService.getBalance(publicKey);
expect(after.balance).toBe(before.balance);
```

## 🎬 Real-World Scenarios

### Network Congestion
```javascript
stellarService.enableFailureSimulation('tx_failed', 0.7);
```

### Service Degradation
```javascript
// Phase 1: Heavy degradation
stellarService.enableFailureSimulation('service_unavailable', 0.8);

// Phase 2: Recovery
stellarService.enableFailureSimulation('service_unavailable', 0.2);

// Phase 3: Normal
stellarService.disableFailureSimulation();
```

### Rate Limiting
```javascript
stellarService.enableFailureSimulation('rate_limit_horizon', 1.0);
```

## 📚 Full Documentation

See [STELLAR_FAILURE_SIMULATION.md](docs/STELLAR_FAILURE_SIMULATION.md) for complete guide.

## 🧪 Run Tests

```bash
# All failure tests
npm test tests/stellar-network-failures.test.js

# Retry logic tests
npm test tests/stellar-retry-logic.test.js
```
