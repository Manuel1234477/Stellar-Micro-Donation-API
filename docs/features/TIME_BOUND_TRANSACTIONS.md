# Stellar Time-Bound Transactions (minTime/maxTime)

## Overview

Time-bound transactions allow donations to be valid only within a specific time window on the Stellar network. This feature uses Stellar's transaction time-bounds (`minTime` and `maxTime` fields) to implement clock-based transaction validation, providing security for time-locked grants, scheduled disbursements, and expiration-based donations.

## Motivation

### Use Cases

1. **Time-Locked Grants**: Ensure donations are only submitted during a specific grant period (e.g., "This grant is only valid from Jan 1-31, 2024")
2. **Scheduled Disbursements**: Control when matching funds or earned rewards can be claimed (e.g., "Bonus available for 24 hours after account creation")
3. **Conditional Donations**: Tie donation validity to external events (e.g., "Donate only if organization reaches membership milestone by March 31")
4. **Clock Skew Protection**: Mitigate issues where submitting wallet clocks are significantly out of sync with the network

### Security Benefits

- **Replay Attack Prevention**: Constraining transaction time windows reduces the replay attack surface
- **Deterministic Behavior**: Time-bounded transactions behave predictably when submitted outside their window
- **Audit Trail**: Timestamp bounds are stored with each transaction for compliance and forensics

## Technical Implementation

### API Changes

#### Request: `POST /api/v1/donations`

Two optional fields have been added:

```json
{
  "amount": "100.0",
  "recipient": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  "validAfter": 1704067200,      // Optional: Unix timestamp (seconds)
  "validBefore": 1704153600      // Optional: Unix timestamp (seconds)
}
```

**Field Definitions:**

- `validAfter` (optional, integer): **Minimum valid time** in Unix seconds
  - Maps to Stellar's `minTime` field in transaction time bounds
  - `0` or omitted = not restricted (valid from the beginning of time)
  - Transaction is **NOT** valid before this timestamp

- `validBefore` (optional, integer): **Maximum valid time** in Unix seconds
  - Maps to Stellar's `maxTime` field in transaction time bounds
  - `0` or omitted = not restricted (valid to the end of time)
  - Transaction is **NOT** valid after this timestamp

#### Validation Rules

**Strict Constraint: `validAfter < validBefore`**

If both `validAfter` and `validBefore` are provided:
- Must satisfy: `validAfter <  validBefore` (strictly less than, not equal)
- **Violation**: Immediate **400 Bad Request** with error code `INVALID_TIME_BOUNDS`

```json
{
  "success": false,
  "error": {
    "code": "INVALID_TIME_BOUNDS",
    "message": "validAfter must be strictly less than validBefore"
  }
}
```

### Stellar SDK Integration

The time bounds are passed to the `TransactionBuilder` constructor:

```javascript
const timebounds = {
  minTime: String(validAfter || '0'),  // '0' = no minimum
  maxTime: String(validBefore || '0')  // '0' = no maximum
};

const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
  fee: this.baseFee,
  networkPassphrase: this.networkPassphrase,
  timebounds,  // ← Time-bound configuration
})
  .addOperation(StellarSdk.Operation.payment({
    destination: destinationPublic,
    asset: paymentAsset,
    amount: amount.toString(),
  }))
  .build();
```

### Database Storage

Time bounds are persisted for auditing:

```sql
ALTER TABLE transactions ADD COLUMN validAfter INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN validBefore INTEGER DEFAULT 0;
```

- `validAfter INTEGER DEFAULT 0`: Unix timestamp of minimum valid time
- `validBefore INTEGER DEFAULT 0`: Unix timestamp of maximum valid time
- Default value `0` = no bound in that direction

### Mock Service Clock Simulation

For testing, the `MockStellarService` implements controllable system time:

```javascript
// Set mock system time for testing
stellarService.setMockSystemTime(unixTimestamp);

// Get current system time (mock or real)
const currentTime = stellarService.getCurrentSystemTime();

// Reset to use real time
stellarService.resetMockSystemTime();
```

When a transaction is submitted outside its time window:

```javascript
if (validAfter && currentTime < validAfter) {
  throw new BusinessLogicError(
    'Transaction error: Time bounds violation. ' +
    `Current time (${currentTime}) is before validAfter (${validAfter}). ` +
    'Transaction is not yet valid.'
  );
}

if (validBefore && currentTime > validBefore) {
  throw new BusinessLogicError(
    'Transaction error: Time bounds violation. ' +
    `Current time (${currentTime}) is after validBefore (${validBefore}). ` +
    'Transaction has expired.'
  );
}
```

## Examples

### Example 1: Simple Time-Locked Donation

```bash
curl -X POST http://localhost:3000/api/v1/donations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Idempotency-Key: unique-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "100.0",
    "recipient": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    "donor": "GBKK7IXRM6HX6OABVUMCYXFVFKDIQCJBAFSJX5PXFN4V5RPOIGRSKRQSB",
    "memo": "Grant Period: Jan 1-31, 2024",
    "validAfter": 1704067200,
    "validBefore": 1704153600
  }'
```

- **Valid Time Window**: Jan 1-31, 2024 (UTC)
- **Submission**: Only succeeds if submitted during this window
- **Outside Window**: Transaction rejected with "Transaction has expired" or "Transaction is not yet valid"

### Example 2: One-Way Constraints

**Only Lower Bound (validAfter):**
```json
{
  "amount": "50.0",
  "recipient": "...",
  "validAfter": 1704067200
}
```
- Transaction valid from Jan 1, 2024 onwards
- No upper time limit

**Only Upper Bound (validBefore):**
```json
{
  "amount": "50.0",
  "recipient": "...",
  "validBefore": 1704153600
}
```
- Transaction valid until Jan 31, 2024
- Valid from any time in the past up to Jan 31, 2024

### Example 3: Invalid Configuration (Rejected)

```json
{
  "amount": "100.0",
  "recipient": "...",
  "validAfter": 1704153600,    // Jan 31
  "validBefore": 1704067200   // Jan 1 (INVALID: before validAfter)
}
```

**Response:**
```json
{
  "status": 400,
  "success": false,
  "error": {
    "code": "INVALID_TIME_BOUNDS",
    "message": "validAfter must be strictly less than validBefore"
  }
}
```

## Clock Skew Considerations

### What is Clock Skew?

Clock skew occurs when system clocks are out of synchronization:
- Submitting wallet's clock is 1 hour ahead of network consensus
- Transaction marked valid `until 3:00 PM` but network time is 2:30 PM
- Result: Temporary submission failures until network moves forward or wallet clock is corrected

### Mitigation Strategies

1. **Buffer Time**: Add a safety margin
   - If you want transaction valid until `3:00 PM`, set `validBefore` to `3:30 PM`
   - Tolerates minor clock skew (typically < 5 minutes)

2. **Generous Windows**: Use wider time windows
   - Instead of 1-minute windows, use 1-hour windows
   - Reduces sensitivity to minor clock differences

3. **Monitor Failure Patterns**: Log transactions rejected for time bounds
   - Indicates persistent clock skew
   - Trigger alerts for wallet clock maintenance

4. **NTP Synchronization**: Ensure donor wallet systems have NTP enabled
   - Unix/Linux: `ntpd` or `chrony`
   - Windows: Windows Time Service
   - Reduces clock skew to < 1 second

### Network Time vs. Ledger Time

Stellar uses **ledger time** (not wall-clock time) for transaction validation:
- Each ledger has a `close_time` (Unix timestamp)
- Transactions are valid if `ledger_time ≥ minTime AND ledger_time ≤ maxTime`
- Ledger times are deterministic and replay-not possible

**Implication**: Time bounds are microscopically enforceable; clock skew on the submitting wallet doesn't matter for *transaction validity*, only for *whether we submit at all*.

## Testing

### Running Time-Bound Tests

```bash
npm test -- tests/time-bound-transactions.test.js
```

### Test Coverage

1. **Valid Window Tests**:
   - Donation accepted within valid time window
   - Donation with only lower bound (validAfter)
   - Donation with only upper bound (validBefore)
   - Backward compatibility (no time bounds)

2. **Validation Tests**:
   - Immediate 400 error when `validAfter ≥ validBefore`
   - Clear error messages with error code

3. **Failure Simulation Tests**:
   - Transaction fails when submitted before `validAfter`
   - Transaction fails when submitted after `validBefore`
   - Edge cases (boundary timestamps, far-future dates)

4. **Integration Tests**:
   - Time bounds work with memos, notes, tags
   - Time bounds work with other donation features
   - Storage and audit trail

5. **Mock Service Tests**:
   - Clock manipulation via `setMockSystemTime()`
   - Realistic error messages for expired/future transactions

### Manual Testing with Mock Service

```javascript
const { getStellarService } = require('./src/config/stellar');
const stellar = getStellarService();

// Get current mock time
const now = stellar.getCurrentSystemTime(); // Unix seconds

// Set mock to 1 hour in the future
stellar.setMockSystemTime(now + 3600);

// Submit donation with validBefore = now (will fail: "expired")
// ...

// Reset to real time
stellar.resetMockSystemTime();
```

## API Response Examples

### Success (201 Created)

All time-bound configurations that pass API validation return:

```json
{
  "success": true,
  "data": {
    "verified": true,
    "transactionHash": "abc123...",
    "estimatedFee": 100,
    "estimatedFeeXLM": "0.00001"
  }
}
```

### Time Bounds Validation Error (400 Bad Request)

```json
{
  "success": false,
  "error": {
    "code": "INVALID_TIME_BOUNDS",
    "message": "validAfter must be strictly less than validBefore"
  }
}
```

### Time Window Expired During Submission (500 Server Error)

```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_FAILED",
    "message": "Transaction error: Time bounds violation. Current time (1704153700) is after validBefore (1704153600). Transaction has expired."
  }
}
```

### Future Transaction Not Yet Valid (500 Server Error)

```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_FAILED",
    "message": "Transaction error: Time bounds violation. Current time (1704067000) is before validAfter (1704067200). Transaction is not yet valid."
  }
}
```

## Limitations & Design Decisions

1. **Unix Seconds Only**: Time bounds use Unix seconds, not milliseconds
   - Stellar network operates on 1-second granularity
   - No need for sub-second precision

2. **No Renewal**: Once a time window closes, it cannot be extended
   - To allow a missed window, create a new donation with updated times

3. **No Conditional Logic**: Time bounds are absolute, not probabilistic
   - Either the window is open or closed; no "grace period" concept

4. **API-Level Validation**: `validAfter < validBefore` constraint checked at API, not at Stellar
   - Prevents wasted network calls
   - Provides immediate feedback

5. **Zero = Unlimited**: Using `0` to indicate "no bound" in either direction
   - Stellar SDK convention: `minTime=0` and `maxTime=0` = infinite bounds

## Future Enhancements

1. **Recurring Time Bounds**: Support automated windows for recurring gifts
2. **Relative Time**: Accept durations like "+24h" instead of absolute timestamps
3. **Condition-Based**: Tie time bounds to external event webhooks
4. **Grace Periods**: Allow short post-expiration submission windows
5. **Time Bound Analytics**: Dashboard showing which transactions expired vs. succeeded

## Integration Guide

### Step 1: Migrate Database

```bash
node src/scripts/migrations/003_add_timebounds_to_transactions.js
```

### Step 2: Update Donation Client

```javascript
const donation = {
  amount: '100.0',
  recipient: 'GBRPYHIL...',
  validAfter: Math.floor(Date.now() / 1000),                // Now
  validBefore: Math.floor(Date.now() / 1000) + 86400 * 30   // 30 days from now
};

const response = await fetch('http://localhost:3000/api/v1/donations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(donation)
});
```

### Step 3: Add Error Handling

```javascript
if (response.status === 400) {
  const error = await response.json();
  if (error.error.code === 'INVALID_TIME_BOUNDS') {
    console.error('Time bounds constraint violated:', error.error.message);
    // Validate validAfter < validBefore on client before submitting
  }
}

if (response.status === 500) {
  const error = await response.json();
  if (error.message && error.message.includes('Time bounds violation')) {
    console.error('Transaction submitted outside valid time window');
    // Retry later or recalculate bounds
  }
}
```

## References

- [Stellar Transaction Time Bounds](https://developers.stellar.org/docs/encyclopedia/transactions-specialized)
- [Stellar SDK TransactionBuilder](https://developers.stellar.org/docs/reference/javascript-stellar-sdk/transaction-builder)
- [Unix Time / Epoch Time](https://en.wikipedia.org/wiki/Unix_time)
- [Clock Skew in Distributed Systems](https://en.wikipedia.org/wiki/Clock_skew)

## Troubleshooting

### "Transaction has expired" Despite Current Time

**Cause**: Network ledger time has advanced past `validBefore`
**Solution**: 
- Increase `validBefore` buffer (add 5-10 minutes)
- Check wallet system clock synchronization

### "Transaction is not yet valid" Despite `validAfter` in Past

**Cause**: Network ledger time hasn't reached `validAfter` yet
**Solution**:
- Decrease `validAfter` (or set to 0)
- Check wallet system clock synchronization
- Verify time values are in Unix seconds, not milliseconds

### Inconsistent Validation Between API and Network

**Cause**: Extended clock skew; local time differs significantly from Stellar network
**Solution**:
1. Enable NTP on wallet system
2. Check Stellar network status: https://status.stellar.org/
3. Wait for network ledger time to align
4. Re-submit with wider time window

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Feature Status**: Stable
