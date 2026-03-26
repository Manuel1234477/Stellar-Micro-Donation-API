# Donation Refund Workflow

## Overview

The donation refund workflow enables authorized users to initiate refunds for confirmed donations. Refunds create a reverse transaction on the Stellar network and update the original transaction status to `refunded`. This feature includes configurable eligibility windows and comprehensive audit logging for compliance.

## Features

- **Secure Refund Processing**: Only confirmed donations can be refunded
- **Eligibility Window**: Configurable time window (default: 30 days) for refund eligibility
- **Double Refund Prevention**: Prevents refunding already-refunded donations
- **Reverse Transactions**: Creates reverse Stellar transactions with `REFUND:` memo prefix
- **Audit Trail**: All refunds logged with original and reverse transaction IDs
- **Permission-Based Access**: Requires `donations:update` permission
- **Error Handling**: Comprehensive validation and error messages

## Configuration

### Environment Variables

```bash
# Refund eligibility window in days (default: 30)
REFUND_ELIGIBILITY_WINDOW_DAYS=30
```

## API Endpoint

### POST /donations/:id/refund

Initiate a refund for a confirmed donation.

**Authentication**: Required (API key with `donations:update` permission)

**Parameters**:
- `id` (path, required): Donation ID to refund
- `reason` (body, optional): Reason for refund

**Request Example**:
```bash
curl -X POST http://localhost:3000/donations/123/refund \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Customer requested refund due to duplicate charge"
  }'
```

**Success Response (201)**:
```json
{
  "success": true,
  "data": {
    "refundId": 1,
    "originalDonationId": "123",
    "reverseTxId": "tx-refund-abc123def456",
    "reverseLedger": 12345,
    "amount": 100,
    "reason": "Customer requested refund due to duplicate charge",
    "refundedAt": "2026-03-24T10:30:00.000Z",
    "status": "pending"
  }
}
```

**Error Responses**:

**422 - Refund Window Expired**:
```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_FAILED",
    "message": "Refund window has expired. Donations can only be refunded within 30 days of creation.",
    "details": {
      "donationId": "123",
      "donationDate": "2026-02-20T10:00:00.000Z",
      "daysSinceDonation": 32,
      "eligibilityWindowDays": 30
    }
  }
}
```

**422 - Already Refunded**:
```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_FAILED",
    "message": "Donation has already been refunded",
    "details": {
      "donationId": "123",
      "currentStatus": "refunded"
    }
  }
}
```

**422 - Not Confirmed**:
```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_FAILED",
    "message": "Cannot refund donation with status \"pending\". Only confirmed donations can be refunded.",
    "details": {
      "donationId": "123",
      "currentStatus": "pending"
    }
  }
}
```

**404 - Not Found**:
```json
{
  "success": false,
  "error": {
    "code": "DONATION_NOT_FOUND",
    "message": "Donation not found"
  }
}
```

## Database Schema

### Refunds Table

```sql
CREATE TABLE refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_donation_id TEXT NOT NULL,
  reverse_transaction_id TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  reason TEXT,
  refunded_at DATETIME NOT NULL,
  stellar_ledger INTEGER,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (original_donation_id) REFERENCES transactions(id)
);

-- Indexes for fast lookups
CREATE INDEX idx_refunds_original_donation_id ON refunds(original_donation_id);
CREATE INDEX idx_refunds_reverse_transaction_id ON refunds(reverse_transaction_id);
CREATE INDEX idx_refunds_status ON refunds(status);
```

## Refund Workflow

### Step 1: Validation
1. Verify donation exists
2. Check donation status is `CONFIRMED`
3. Verify donation is within eligibility window
4. Prevent double refunds

### Step 2: Reverse Transaction
1. Retrieve sender's encrypted secret key
2. Decrypt secret key
3. Create reverse Stellar transaction:
   - Destination: Original donor wallet
   - Amount: Original donation amount
   - Memo: `REFUND:{donationId}`

### Step 3: Record Refund
1. Insert refund record in database
2. Update original donation status to `refunded`
3. Store reverse transaction ID and ledger

### Step 4: Audit Logging
1. Log refund operation with `FINANCIAL_OPERATION` category
2. Include original and reverse transaction IDs
3. Store refund reason and timestamp

## Eligibility Rules

### Refund Window
- **Default**: 30 days from donation timestamp
- **Configurable**: Via `REFUND_ELIGIBILITY_WINDOW_DAYS` environment variable
- **Calculation**: `(now - donationTimestamp) <= eligibilityWindowDays`

### Donation Status Requirements
- ✅ **CONFIRMED**: Can be refunded
- ❌ **PENDING**: Cannot be refunded (not yet submitted to Stellar)
- ❌ **SUBMITTED**: Cannot be refunded (awaiting confirmation)
- ❌ **REFUNDED**: Cannot be refunded again (already refunded)

## Audit Logging

All refund operations are logged with the following details:

```javascript
{
  category: 'FINANCIAL_OPERATION',
  action: 'DONATION_CREATED', // Reused for refund tracking
  severity: 'MEDIUM',
  result: 'SUCCESS',
  userId: senderId,
  requestId: correlationId,
  resource: 'donation:123',
  details: {
    operation: 'refund',
    originalDonationId: '123',
    refundId: 1,
    amount: 100,
    reason: 'Customer requested',
    reverseTxId: 'tx-refund-abc123',
    originalTxId: 'tx-original-xyz789'
  }
}
```

## Security Considerations

### Encryption
- Sender's secret key is decrypted only when needed
- Decrypted key is never logged or stored
- Reverse transaction is created immediately after decryption

### Authorization
- Requires `donations:update` permission
- Only API keys with appropriate role can initiate refunds
- All refund operations are audit-logged

### Idempotency
- Reverse transaction ID is unique (UNIQUE constraint)
- Prevents duplicate refunds via database constraint
- Refund status prevents double-refund attempts

### Validation
- Donation must exist and be confirmed
- Eligibility window is strictly enforced
- Amount validation ensures XLM precision

## Error Handling

### Validation Errors (400)
- Missing required fields
- Invalid donation ID format

### Not Found (404)
- Donation does not exist

### Business Logic Errors (422)
- Donation not confirmed
- Refund window expired
- Already refunded
- Sender has no secret key

### Server Errors (500)
- Database failures
- Stellar network errors
- Encryption/decryption failures

## Testing

### Test Coverage
- ✅ Successful refund of confirmed donations
- ✅ Refund eligibility window enforcement
- ✅ Prevention of double refunds
- ✅ Reverse transaction creation
- ✅ Audit logging
- ✅ Error handling for ineligible donations
- ✅ Permission-based access control
- ✅ Edge cases (no reason, network errors, etc.)

### Running Tests
```bash
npm test tests/implement-donation-refund-workflow.test.js
```

### Minimum Coverage
- **Target**: 95% code coverage
- **Lines**: 95%+
- **Branches**: 95%+
- **Functions**: 95%+
- **Statements**: 95%+

## Migration

### Running the Migration
```bash
node src/scripts/migrations/addRefundsTable.js
```

### Rollback
```sql
DROP TABLE IF EXISTS refunds;
```

## Examples

### Example 1: Successful Refund
```bash
# Create a donation first
curl -X POST http://localhost:3000/donations \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "100",
    "recipient": "GDONOR123",
    "donor": "Alice"
  }'

# Response: { "data": { "transactionHash": "123" } }

# Wait for confirmation, then refund
curl -X POST http://localhost:3000/donations/123/refund \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Customer requested refund"
  }'
```

### Example 2: Refund Outside Window
```bash
# Attempt to refund donation from 31 days ago
curl -X POST http://localhost:3000/donations/456/refund \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Too late"
  }'

# Response: 422 Unprocessable Entity
# "Refund window has expired. Donations can only be refunded within 30 days of creation."
```

### Example 3: Double Refund Prevention
```bash
# First refund succeeds
curl -X POST http://localhost:3000/donations/789/refund \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "First refund" }'

# Second refund attempt fails
curl -X POST http://localhost:3000/donations/789/refund \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Second refund" }'

# Response: 422 Unprocessable Entity
# "Donation has already been refunded"
```

## Monitoring

### Audit Log Queries
```javascript
// Get all refunds in the last 24 hours
const logs = await AuditLogService.query({
  category: 'FINANCIAL_OPERATION',
  action: 'DONATION_CREATED',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  limit: 100
});

// Filter for refund operations
const refunds = logs.filter(log => 
  log.details && log.details.includes('refund')
);
```

### Metrics
- Total refunds processed
- Refunds by reason
- Refund success rate
- Average refund processing time
- Refunds outside eligibility window (rejected)

## Troubleshooting

### Issue: "Refund window has expired"
**Solution**: Check the donation timestamp and `REFUND_ELIGIBILITY_WINDOW_DAYS` configuration. Donations can only be refunded within the configured window.

### Issue: "Cannot refund donation with status pending"
**Solution**: Wait for the donation to be confirmed on the Stellar network before attempting refund.

### Issue: "Donation has already been refunded"
**Solution**: The donation was previously refunded. Check the refund record in the database.

### Issue: Stellar network timeout during refund
**Solution**: The reverse transaction failed to submit. Check Stellar network status and retry.

## Future Enhancements

- [ ] Partial refunds (refund less than original amount)
- [ ] Batch refunds (refund multiple donations in one request)
- [ ] Refund scheduling (schedule refund for future date)
- [ ] Refund status tracking (pending → confirmed → completed)
- [ ] Refund analytics dashboard
- [ ] Automatic refunds based on rules (e.g., fraud detection)

## Related Documentation

- [Donation Flow](../API_FLOW.md)
- [Audit Logging](../AUDIT_LOGGING.md)
- [Error Handling](../security/ERROR_HANDLING.md)
- [Transaction State Machine](../features/TRANSACTION_CONFIRMATION_THRESHOLD.md)
