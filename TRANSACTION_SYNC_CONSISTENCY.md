# Transaction Sync Consistency Checks

## Overview

The Transaction Sync Service ensures that local transaction records always reflect the on-chain state of the Stellar blockchain. This feature implements comprehensive consistency checks and automatic reconciliation logic to detect and resolve discrepancies between local database records and on-chain transactions.

## Features

- Automated consistency checking between local and on-chain transaction states
- Detection of 5 types of inconsistencies
- Automatic reconciliation with configurable options
- Comprehensive logging of all sync operations
- No silent failures - all errors are logged and reported

## Inconsistency Types

### 1. MISSING_LOCAL
**Description**: Transaction exists on the Stellar blockchain but not in the local database.

**Detection**: Compares on-chain transaction IDs with local transaction records.

**Reconciliation**: Fetches the full transaction details from Horizon and creates a new local record with:
- Transaction ID
- Ledger number
- Timestamp
- Status (confirmed/failed)
- Amount, donor, and recipient information

### 2. ORPHANED_LOCAL
**Description**: Transaction is marked as confirmed locally but does not exist on-chain.

**Detection**: Checks for confirmed local transactions that have no corresponding on-chain record.

**Reconciliation**: Marks the orphaned transaction as `failed` since it was never actually confirmed on the blockchain.

### 3. STATUS_MISMATCH
**Description**: Local transaction status does not match the on-chain confirmation state.

**Detection**: Compares local status with on-chain `successful` flag.

**Reconciliation**: Updates the local status to match the on-chain state (typically from `pending` to `confirmed`).

### 4. LEDGER_MISMATCH
**Description**: Local ledger number does not match the on-chain ledger number.

**Detection**: Compares `stellarLedger` field with Horizon's `ledger_attr`.

**Reconciliation**: Updates the local ledger number to match the on-chain value.

### 5. DELAYED_CONFIRMATION
**Description**: Transaction has been pending for more than 5 minutes without on-chain confirmation.

**Detection**: Checks age of pending transactions that don't appear on-chain.

**Reconciliation**: Not auto-reconciled. Flagged for manual review as it may indicate a stuck transaction or network issues.

## Usage

### Basic Sync with Consistency Check

```javascript
const TransactionSyncService = require('./src/services/TransactionSyncService');

const syncService = new TransactionSyncService('https://horizon-testnet.stellar.org');

// Sync wallet transactions with consistency check
const result = await syncService.syncWalletTransactions(publicKey, {
  performConsistencyCheck: true,
  autoReconcile: true,
  limit: 200
});

console.log(`Synced ${result.synced} transactions`);
console.log(`Consistency: ${result.consistencyReport.isConsistent ? 'OK' : 'Issues found'}`);
console.log(`Inconsistencies: ${result.consistencyReport.inconsistencies.length}`);
```

### Manual Consistency Check

```javascript
// Perform consistency check without syncing new transactions
const report = await syncService.performConsistencyCheck(publicKey);

console.log(`Local transactions: ${report.localCount}`);
console.log(`On-chain transactions: ${report.onChainCount}`);
console.log(`Inconsistencies found: ${report.inconsistencies.length}`);

// Review inconsistencies
report.inconsistencies.forEach(issue => {
  console.log(`Type: ${issue.type}`);
  console.log(`Data:`, issue.data);
});
```

### Manual Reconciliation

```javascript
// Get consistency report
const report = await syncService.performConsistencyCheck(publicKey);

// Manually reconcile specific inconsistencies
if (report.inconsistencies.length > 0) {
  const results = await syncService.reconcileInconsistencies(report.inconsistencies);
  
  console.log(`Resolved: ${results.resolved.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Skipped: ${results.skipped.length}`);
}
```

### Configuration Options

```javascript
const options = {
  performConsistencyCheck: true,  // Enable consistency checking (default: true)
  autoReconcile: true,            // Automatically fix inconsistencies (default: true)
  limit: 200                      // Number of transactions to fetch (default: 200)
};

const result = await syncService.syncWalletTransactions(publicKey, options);
```

## Consistency Report Structure

```javascript
{
  timestamp: '2024-02-20T10:00:00Z',
  publicKey: 'GTEST123...',
  localCount: 10,
  onChainCount: 11,
  isConsistent: false,
  inconsistencies: [
    {
      type: 'MISSING_LOCAL',
      data: {
        stellarTxId: 'abc123...',
        ledger: 12345,
        timestamp: '2024-02-20T09:00:00Z',
        description: 'Transaction exists on-chain but not in local database'
      },
      timestamp: '2024-02-20T10:00:00Z'
    }
  ],
  summary: {
    total: 1,
    byType: {
      MISSING_LOCAL: 1
    }
  }
}
```

## Recovery Procedures

### Scenario 1: Missing Local Transactions

**Symptoms**: Transactions appear on Stellar Explorer but not in your application.

**Recovery**:
```javascript
// Run sync with auto-reconcile enabled
const result = await syncService.syncWalletTransactions(publicKey, {
  performConsistencyCheck: true,
  autoReconcile: true
});

// Missing transactions will be automatically created locally
```

### Scenario 2: Orphaned Local Transactions

**Symptoms**: Transactions show as confirmed locally but don't exist on-chain.

**Recovery**:
```javascript
// Run consistency check
const report = await syncService.performConsistencyCheck(publicKey);

// Orphaned transactions will be marked as failed
await syncService.reconcileInconsistencies(report.inconsistencies);
```

### Scenario 3: Status Mismatches

**Symptoms**: Transactions stuck in pending status despite being confirmed on-chain.

**Recovery**:
```javascript
// Auto-reconciliation will update status to confirmed
const result = await syncService.syncWalletTransactions(publicKey, {
  autoReconcile: true
});
```

### Scenario 4: Delayed Confirmations

**Symptoms**: Transactions pending for more than 5 minutes.

**Manual Review Required**:
1. Check Stellar Explorer for transaction status
2. Verify network connectivity
3. Check if transaction was submitted successfully
4. Consider resubmitting if transaction is truly lost

## Logging

All sync operations are logged with timestamps and severity levels:

```javascript
// Access sync logs
const logs = syncService.getSyncLog();

logs.forEach(log => {
  console.log(`[${log.timestamp}] [${log.level}] ${log.message}`);
});

// Filter error logs
const errors = logs.filter(log => log.level === 'ERROR');
```

## Best Practices

1. **Regular Syncing**: Run consistency checks periodically (e.g., every hour) to catch issues early.

2. **Monitor Delayed Confirmations**: Set up alerts for transactions pending longer than 5 minutes.

3. **Review Reconciliation Results**: Always check the reconciliation results for failed operations.

4. **Backup Before Reconciliation**: Consider backing up your database before running auto-reconciliation on production data.

5. **Test on Testnet First**: Validate sync behavior on Stellar testnet before deploying to mainnet.

## Error Handling

The service never fails silently. All errors are:
- Logged with ERROR level
- Included in the sync log
- Thrown as exceptions for critical failures
- Reported in reconciliation results

```javascript
try {
  const result = await syncService.syncWalletTransactions(publicKey);
} catch (error) {
  console.error('Sync failed:', error.message);
  
  // Check logs for details
  const logs = syncService.getSyncLog();
  const errorLogs = logs.filter(log => log.level === 'ERROR');
  console.error('Error details:', errorLogs);
}
```

## Testing

Comprehensive test suite covering:
- All 5 inconsistency types
- Reconciliation logic for each type
- Auto-reconciliation behavior
- Error handling and logging
- Full sync workflow

Run tests:
```bash
npm test -- tests/transaction-sync-consistency.test.js
```

## Implementation Details

- Uses Stellar Horizon API for on-chain data
- Compares transactions using Stellar transaction IDs
- Handles partial confirmations and network delays
- Supports both testnet and mainnet
- Thread-safe for concurrent operations

## Future Enhancements

- Webhook notifications for inconsistencies
- Scheduled automatic consistency checks
- Dashboard for monitoring sync health
- Metrics and analytics for sync performance
