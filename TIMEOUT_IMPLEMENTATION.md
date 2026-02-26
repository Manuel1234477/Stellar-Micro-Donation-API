# Defensive Timeouts Implementation

## Overview
This document describes the implementation of defensive timeouts across all external calls in the Stellar Micro Donation API to prevent indefinite blocking.

## Changes Made

### 1. New Timeout Handler Utility (`src/utils/timeoutHandler.js`)
Created a centralized timeout management utility with:
- **TimeoutError**: Custom error class for timeout failures
- **withTimeout()**: Promise wrapper that enforces timeouts
- **executeWithTimeout()**: Advanced wrapper with retry logic
- **TIMEOUT_DEFAULTS**: Configurable timeout constants

#### Timeout Configuration
```javascript
STELLAR_API: 15000ms      // Stellar Horizon API calls
STELLAR_SUBMIT: 30000ms   // Transaction submission
STELLAR_STREAM: 60000ms   // Streaming connections
DATABASE: 10000ms         // Database operations
DATABASE_LONG: 30000ms    // Complex queries
```

### 2. StellarService Updates (`src/services/StellarService.js`)

#### Constructor Changes
- Added timeout configuration with defaults
- Configurable via constructor options

#### Method Updates
All Stellar API calls now have explicit timeouts:

| Method | Operation | Timeout | Retry |
|--------|-----------|---------|-------|
| `loadAccount()` | Load account data | 15s | Yes (3x) |
| `submitTransaction()` | Submit transaction | 30s | No* |
| `friendbot()` | Fund testnet wallet | 15s | Yes (3x) |
| `transaction().call()` | Verify transaction | 15s | Yes (3x) |
| `transactions().call()` | Get history | 15s | Yes (3x) |
| `streamTransactions()` | Stream transactions | 60s | N/A** |

*Transaction submission uses network safety checks instead of retries
**Streaming uses inactivity timeout with automatic reconnection

#### Enhanced Features
- **Timeout-aware retry logic**: Recognizes TimeoutError as retryable
- **Stream timeout protection**: Monitors stream inactivity
- **Detailed logging**: All timeouts logged with context

### 3. Database Updates (`src/utils/database.js`)

All database operations now have 10-second timeouts:
- `getConnection()`: Database connection establishment
- `query()`: SELECT queries
- `run()`: INSERT/UPDATE/DELETE operations
- `get()`: Single row retrieval

#### Timeout Handling
- Automatic connection cleanup on timeout
- Clear error messages with operation context
- Prevents connection leaks

### 4. Background Services

#### RecurringDonationScheduler
- Uses StellarService with built-in timeouts
- Database queries protected by timeout wrapper
- Existing retry logic preserved

#### TransactionReconciliationService
- Uses StellarService with built-in timeouts
- Database queries protected by timeout wrapper
- 5-minute reconciliation interval maintained

## Acceptance Criteria Met

### ✅ No Unbounded Waits
- All external calls have explicit timeouts
- Streaming connections monitored for inactivity
- Database operations bounded

### ✅ Timeouts Logged Clearly
- Timeout errors include:
  - Operation name
  - Timeout duration
  - Timestamp
  - Context (attempt number, etc.)
- Logged at appropriate levels (WARN for retryable, ERROR for final)

### ✅ Graceful Error Handling
- TimeoutError extends Error with additional context
- Retry logic for transient timeouts
- Connection cleanup on database timeouts
- Stream reconnection on timeout

## Testing Recommendations

### Unit Tests
```javascript
// Test timeout enforcement
it('should timeout after configured duration', async () => {
  const slowOperation = () => new Promise(resolve => 
    setTimeout(resolve, 20000)
  );
  await expect(
    withTimeout(slowOperation(), 1000, 'test')
  ).rejects.toThrow(TimeoutError);
});

// Test retry on timeout
it('should retry on timeout error', async () => {
  // Mock implementation
});
```

### Integration Tests
1. Test Stellar API calls with network delays
2. Test database operations with slow queries
3. Test stream timeout and reconnection
4. Verify logging output

### Manual Testing
```bash
# Test with slow network
# Add artificial delay to test timeout behavior

# Monitor logs for timeout messages
tail -f logs/app.log | grep TIMEOUT

# Test stream timeout
# Start stream and wait for inactivity timeout
```

## Configuration

### Environment Variables (Optional)
```env
STELLAR_API_TIMEOUT=15000
STELLAR_SUBMIT_TIMEOUT=30000
STELLAR_STREAM_TIMEOUT=60000
DATABASE_TIMEOUT=10000
```

### Programmatic Configuration
```javascript
const stellarService = new StellarService({
  network: 'testnet',
  apiTimeout: 20000,      // Override default
  submitTimeout: 45000,   // Override default
  streamTimeout: 90000    // Override default
});
```

## Monitoring

### Key Metrics to Track
1. **Timeout frequency**: Count of TimeoutError occurrences
2. **Timeout operations**: Which operations timeout most
3. **Retry success rate**: Timeouts resolved on retry
4. **Average operation duration**: Identify slow operations

### Log Patterns
```
[TIMEOUT] Operation timeout: operation=loadAccount, timeoutMs=15000
[STELLAR_SERVICE] Operation timeout: operation=submitTransaction, attempt=2
[DATABASE] Failed to close database after timeout
```

## Rollback Plan
If issues arise:
1. Revert to previous branch
2. Increase timeout values if too aggressive
3. Disable retry on timeout if causing issues

## Future Improvements
1. Dynamic timeout adjustment based on network conditions
2. Circuit breaker pattern for repeated timeouts
3. Metrics collection and alerting
4. Timeout configuration via admin API
5. Per-operation timeout customization
