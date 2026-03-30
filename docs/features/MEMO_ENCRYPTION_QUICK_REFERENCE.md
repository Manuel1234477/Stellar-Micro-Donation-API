# Quick Reference - Memo Encryption API

## Essential Usage Examples

### Encrypting a Memo

```javascript
const MemoEncryptionService = require('./services/MemoEncryptionService');
const memoKeyManager = require('./utils/memoKeyManager');

// Initialize at startup
memoKeyManager.initializeKeyStorage();

// Encrypt a memo
const encrypted = MemoEncryptionService.encryptMemoForRecipient(
  "Thank you for your donation!",
  "GBBC3F5GGX3USHVKEEB7HBQWP7HDELURREFKEZBUS7Z5Z7K7VIXTPJDB"  // recipient address
);

// Results include:
// - encrypted.memoEnvelope: Encrypted Stellar ECDH envelope
// - encrypted.memoHash: SHA-256 hash for on-chain MEMO_HASH
// - encrypted.encryptionMetadata: {keyVersion, algorithm, createdAt}

// Store in database
transaction.memoEnvelope = encrypted.memoEnvelope;
transaction.memoHash = encrypted.memoHash;
transaction.encryptionMetadata = encrypted.encryptionMetadata;
```

### Decrypting a Memo

```javascript
// Recipient decrypts using their secret key
const plaintext = MemoEncryptionService.decryptMemoForRecipient(
  transaction.memoEnvelope,
  "SBFKQ4RNOHUQVTVJLF2CBFQP7PJP27AOFBLWHGQFGDQQFYBBG43IJSB"  // recipient secret
);

console.log(plaintext);  // "Thank you for your donation!"
```

### Key Rotation

```javascript
// Step 1: Initiate rotation (admin only)
const rotationInfo = MemoEncryptionService.initiateKeyRotation();
console.log(`Created new version: ${rotationInfo.newVersion}`);
console.log(`Memos needing re-encryption: ${rotationInfo.memosRequiringReencryption}`);

// Step 2: Run batch re-encryption job
for (const memoId of rotationInfo.memoIds) {
  const tx = Transaction.getById(memoId);
  const recipientSecret = await getRecipientSecret(tx.recipientAddress);
  
  const updated = MemoEncryptionService.reencryptMemoToLatestVersion(
    tx,
    recipientSecret
  );
  
  Transaction.update(memoId, {
    memoEnvelope: updated.memoEnvelope,
    encryptionMetadata: updated.encryptionMetadata,
  });
}
```

### Checking Encryption Status

```javascript
const allTransactions = Transaction.getAll();
const status = MemoEncryptionService.getEncryptionStatus(allTransactions);

console.log({
  activeVersion: status.activeVersion,
  memosEncrypted: status.memosEncryptedCount,
  memosWithOldVersion: status.memosUsingOldVersions,
  rotationRequired: status.rotationRequired,
});
```

## HTTP Endpoints

### POST /transactions/:id/decrypt-memo

```bash
curl -X POST http://localhost:3000/transactions/550e8400/decrypt-memo \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "recipientSecret": "SBFKQ4RNOHUQVTVJLF2CBFQP7PJP27AOFBLWHGQFGDQQFYBBG43IJSB"
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "transactionId": "550e8400-e29b-41d4-a716-446655440000",
    "memo": "Thank you!",
    "encryptedAt": "2026-03-29T10:30:45.000Z"
  }
}
```

### POST /admin/encryption/memo-rotate

```bash
curl -X POST http://localhost:3000/admin/encryption/memo-rotate \
  -H "Authorization: Bearer ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "rotationStatus": "initiated",
    "previousVersion": 1,
    "newVersion": 2,
    "memosRequiringReencryption": 1547,
    "memoIds": ["id1", "id2", ...],
    "nextSteps": ["Run batch job to re-encrypt..."]
  }
}
```

## Common Scenarios

### Creating a Donation with Encrypted Memo

```javascript
// In donation creation endpoint
if (req.body.encryptMemo && req.body.memo) {
  const encrypted = MemoEncryptionService.encryptMemoForRecipient(
    req.body.memo,
    req.body.recipientAddress
  );

  donation.memoEnvelope = encrypted.memoEnvelope;
  donation.memoHash = encrypted.memoHash;
  donation.encryptionMetadata = encrypted.encryptionMetadata;
  donation.memo = null;  // Clear plaintext
} else {
  donation.memo = req.body.memo || null;
}
```

### Recipient Reading Their Memo

```javascript
// Recipient calls POST /transactions/:id/decrypt-memo with their secret key
// In the endpoint handler:
const plaintext = MemoEncryptionService.decryptMemoForRecipient(
  tx.memoEnvelope,
  req.body.recipientSecret
);

res.json({ success: true, data: { memo: plaintext } });
```

### Emergency Key Rotation

```javascript
// If key compromise suspected:
const rotation = MemoEncryptionService.initiateKeyRotation();

// Immediately run re-encryption (or mark for urgent reschedule)
// Then retire old key:
memoKeyManager.clearAllKeys();  // Only for testing!
// In production, keep old version for time-bounded decryption then archive
```

## Key Functions Reference

| Function | Purpose | Usage |
|----------|---------|-------|
| `encryptMemoForRecipient(plaintext, address, options)` | Encrypt memo | Before DB storage |
| `decryptMemoForRecipient(envelope, secret)` | Decrypt memo | Recipient reads memo |
| `initiateKeyRotation()` | Create new version | Admin operation |
| `getMemosToReencrypt(records, oldVersion)` | Find memos to update | Batch job |
| `reencryptMemoToLatestVersion(record, secret)` | Re-encrypt to new version | Batch job |
| `getEncryptionStatus(records)` | Get diagnostics | Monitoring |
| `getActiveKeyVersion()` | Current version | Logging/audit |
| `getAllKeyVersions()` | All versions with metadata | Status queries |

## Permissions Required

| Endpoint | Permission |
|----------|------------|
| `POST /transactions/:id/decrypt-memo` | `transactions:read` |
| `POST /admin/encryption/memo-rotate` | `admin:all` |

## Environment Variables

```bash
# Optional: custom key storage directory
MEMO_KEYS_DIR=/secure/path/to/keys
```

## Testing

```bash
# Run all memo encryption tests
npm test -- tests/memo-encryption-extended.test.js

# With coverage report
npm test -- tests/memo-encryption-extended.test.js --coverage
```

## Error Handling

```javascript
try {
  const encrypted = MemoEncryptionService.encryptMemoForRecipient(
    memo,
    address
  );
} catch (err) {
  if (err.message.includes('Invalid Stellar')) {
    // Handle invalid address
  } else {
    // Handle other encryption errors
  }
}

try {
  const plaintext = MemoEncryptionService.decryptMemoForRecipient(
    envelope,
    secret
  );
} catch (err) {
  // Wrong secret key or tampered envelope
  return res.status(403).json({
    success: false,
    error: { code: 'DECRYPTION_FAILED', message: err.message }
  });
}
```

## Performance Tips

- Encryption: ~40ms per memo (acceptable for on-demand)
- Decryption: ~35ms per memo (acceptable for recipient requests)
- Batch re-encryption: Process 100+ memos in parallel for efficiency
- Use connection pooling for database updates during rotation

## Security Reminders

1. **Never log secret keys**: Secure all Stellar secret key handling
2. **Use HTTPS**: All encryption-related endpoints must use HTTPS + TLS
3. **Backup keys**: Regular backups of `data/memo-keys/keys.json`
4. **Monitor access**: Log all decryption requests
5. **Rotate regularly**: Every 90 days or after suspected compromise
6. **Test recovery**: Regular drills of backup/restore procedures

---

For more details, see [MEMO_ENCRYPTION_EXTENDED.md](./MEMO_ENCRYPTION_EXTENDED.md)
