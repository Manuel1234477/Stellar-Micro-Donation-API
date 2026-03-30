# Stellar Account Data Entries (Manage Data Operations)

## Overview

The Account Data Entries feature enables wallets to store arbitrary key-value metadata directly on the Stellar ledger using the `manageData` operation. This allows lightweight, on-chain storage of wallet metadata without requiring additional database tables.

## Use Cases

- **Account Tiers**: Store customer tier levels (`bronze`, `silver`, `gold`)
- **KYC Status**: Track verification status (`pending`, `verified`, `rejected`)
- **Account Metadata**: Custom application-specific data
- **Compliance Information**: Lightweight regulatory metadata

## ⚠️ SECURITY WARNING

**On-chain data is PUBLICLY READABLE.** Anyone can inspect your account on Stellar and see all data entries. 

**DO NOT STORE:**
- Personally Identifiable Information (PII)
- Secrets or API keys
- Private credentials
- Sensitive personal details
- Encrypted private data (encryption keys would still be exposed)

Use this feature only for non-sensitive, public metadata.

## API Endpoints

### POST /wallets/:id/data

Create or update a data entry on a wallet's Stellar account.

**Authentication**: Required (API key with `wallets:update` permission)

**Parameters**:
- `id` (path): Wallet ID
- `secretKey` (body): Secret key of the wallet owner (required)
- `key` (body): Data entry key (required, max 64 bytes)
- `value` (body): Data entry value (optional, max 64 bytes)

**Example Request**:
```bash
curl -X POST https://api.example.com/wallets/42/data \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "secretKey": "SBZVMB74Z76QZ3ZVK4QQXYKG7EGBFYHE...",
    "key": "account_tier",
    "value": "premium"
  }'
```

**Success Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "hash": "abc123def456...",
    "ledger": 42000000
  }
}
```

**Error Responses**:
- `400 Bad Request`: Key or value exceeds 64 bytes, or required field missing
- `404 Not Found`: Wallet not found
- `401 Unauthorized`: Invalid authentication

### GET /wallets/:id/data

Retrieve all current data entries for a wallet from the Stellar network.

**Authentication**: Required (API key with `wallets:read` permission)

**Parameters**:
- `id` (path): Wallet ID

**Example Request**:
```bash
curl https://api.example.com/wallets/42/data \
  -H "Authorization: Bearer your-api-key"
```

**Success Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "account_tier": "premium",
    "kyc_status": "verified",
    "custom_field": "custom_value"
  },
  "count": 3
}
```

**Empty Response**:
```json
{
  "success": true,
  "data": {},
  "count": 0
}
```

### DELETE /wallets/:id/data/:key

Remove a specific data entry from a wallet's Stellar account.

**Authentication**: Required (API key with `wallets:update` permission)

**Parameters**:
- `id` (path): Wallet ID
- `key` (path): Data entry key to delete
- `secretKey` (body): Secret key of the wallet owner (required)

**Example Request**:
```bash
curl -X DELETE https://api.example.com/wallets/42/data/account_tier \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "secretKey": "SBZVMB74Z76QZ3ZVK4QQXYKG7EGBFYHE..."
  }'
```

**Success Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "hash": "xyz789uvw123...",
    "ledger": 42000001
  }
}
```

**Notes**:
- Deleting a non-existent key is idempotent and returns success
- Deletion is performed by setting the value to `null` on-chain

## Byte Length Validation

Keys and values are limited to **64 bytes** in UTF-8 encoding, enforced by Stellar. This middleware validates at the API level using `Buffer.byteLength()`.

### Byte Counting Examples

```javascript
// ASCII characters (1 byte each)
Buffer.byteLength('hello_world', 'utf8') // 11 bytes ✓

// Emoji (4 bytes each)
Buffer.byteLength('🌟', 'utf8') // 4 bytes
Buffer.byteLength('🌟🌟🌟🌟', 'utf8') // 16 bytes ✓

// Chinese characters (3 bytes each)
Buffer.byteLength('中', 'utf8') // 3 bytes
Buffer.byteLength('中文数据', 'utf8') // 12 bytes ✓

// Mixed content
Buffer.byteLength('Hello世界🌟', 'utf8') // 5 + 6 + 4 = 15 bytes ✓
```

### Exceeding Limits

If a key or value exceeds 64 bytes:

```json
{
  "success": false,
  "error": {
    "code": "KEY_EXCEEDS_BYTE_LIMIT",
    "message": "Key exceeds 64 bytes (72 bytes). Please use a shorter key or ASCII-only characters."
  }
}
```

## Implementation Details

### Service Layer

The `StellarService` provides two core methods:

```javascript
// Set or update a data entry
async setAccountData(secretKey, key, value)
  // Returns: { hash, ledger }

// Delete a data entry
async deleteAccountData(secretKey, key)
  // Returns: { hash, ledger }
```

Both methods:
1. Load the account from Stellar
2. Build a transaction with the `manageData` operation
3. Sign the transaction with the provided secret key
4. Submit to the Stellar network
5. Verify submission with network safety checks

### Mock Service

For testing, `MockStellarService` maintains a `data_attr` object within account state:

```javascript
mockWallet.data_attr = {
  'account_tier': 'cHJlbWl1bQ==', // base64-encoded
  'kyc_status': 'dmVyaWZpZWQ=='
}
```

### Validation Middleware

The `validateDataEntry` middleware ensures:
- Key is present and is a string
- Value (if provided) is a string or null
- Key byte length ≤ 64 bytes
- Value byte length ≤ 64 bytes

## Common Patterns

### Account Tier Management

```bash
# Set tier
curl -X POST https://api.example.com/wallets/42/data \
  -H "Authorization: Bearer key" \
  -d '{
    "secretKey": "S...",
    "key": "tier",
    "value": "gold"
  }'

# Upgrade tier
curl -X POST https://api.example.com/wallets/42/data \
  -H "Authorization: Bearer key" \
  -d '{
    "secretKey": "S...",
    "key": "tier",
    "value": "platinum"
  }'

# Clear tier (delete)
curl -X DELETE https://api.example.com/wallets/42/data/tier \
  -H "Authorization: Bearer key" \
  -d '{"secretKey": "S..."}'
```

### KYC Status Tracking

```bash
# Mark as pending verification
curl -X POST https://api.example.com/wallets/42/data \
  -d '{"secretKey": "S...", "key": "kyc", "value": "pending"}'

# Mark as verified
curl -X POST https://api.example.com/wallets/42/data \
  -d '{"secretKey": "S...", "key": "kyc", "value": "verified"}'

# Mark as rejected
curl -X POST https://api.example.com/wallets/42/data \
  -d '{"secretKey": "S...", "key": "kyc", "value": "rejected"}'
```

## Error Handling

### Validation Errors

```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "Key field is required"
  }
}
```

### Byte Limit Errors

```json
{
  "success": false,
  "error": {
    "code": "VALUE_EXCEEDS_BYTE_LIMIT",
    "message": "Value exceeds 64 bytes (128 bytes). Please use shorter data or ASCII-only characters."
  }
}
```

### Wallet Not Found

```json
{
  "success": false,
  "error": {
    "code": "WALLET_NOT_FOUND",
    "message": "Wallet not found"
  }
}
```

### Network Errors

```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_FAILED",
    "message": "Failed to submit transaction to Stellar network"
  }
}
```

## Stellar Concepts

### manageData Operation

The Stellar `manageData` operation creates, updates, or deletes key-value data entries on an account:

```javascript
// Set data
StellarSdk.Operation.manageData({
  name: 'account_tier',
  value: 'premium'
})

// Delete data (set value to null)
StellarSdk.Operation.manageData({
  name: 'account_tier',
  value: null
})
```

### Transaction Sequence

Each `manageData` operation increments the account's sequence number, preventing replay attacks.

### Network Safety

The implementation includes:
- Automatic retry on transient errors
- Exponential backoff with jitter
- Transaction verification after submission failures
- Timeout handling

## Testing

Run the test suite:

```bash
npm test -- tests/account-data-entries.test.js
```

Tests cover:
- ✅ Setting and updating entries
- ✅ Byte limit validation (ASCII, UTF-8, emoji, Chinese characters)
- ✅ Deleting entries
- ✅ Error scenarios
- ✅ Edge cases (exactly 64 bytes, multi-byte encodings)

## Performance Considerations

- Each operation creates an on-chain transaction (costs 100 stroops base fee)
- Data is immediately committed to the ledger
- No database queries required for read operations (unless caching)
- Stellar limits data storage to entries with reasonable key/value sizes

## See Also

- [Stellar Documentation: Manage Data](https://developers.stellar.org/learn/fundamentals/transactions/operations-and-payments#manage-data)
- [Stellar Ledger Entries](https://developers.stellar.org/learn/fundamentals/ledger-entries)
- [XDR: External Data Representation](https://developers.stellar.org/learn/fundamentals/xdr)
