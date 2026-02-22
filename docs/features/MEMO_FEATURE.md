# Transaction Memo Feature

## Overview

The memo feature allows transactions to include an optional text message that is stored in the database and included in Stellar blockchain transactions. This is useful for adding context, references, or notes to donations.

## Specifications

### Memo Constraints

- **Type**: String (UTF-8 text)
- **Maximum Length**: 28 bytes (Stellar MEMO_TEXT limit)
- **Optional**: Memo can be empty or omitted
- **Encoding**: UTF-8
- **Restrictions**: Cannot contain null bytes (`\0`)

### Important Notes

- Multi-byte characters (emojis, special Unicode) count as multiple bytes
- Whitespace is trimmed before validation
- Empty memos are valid and stored as empty strings

## API Usage

### Creating a Donation with Memo

**Endpoint**: `POST /donations`

**Request Body**:
```json
{
  "amount": 50.0,
  "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU",
  "recipient": "GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJGTAY5XJJGUJMUC5XNOD",
  "memo": "Donation for education"
}
```

**Response** (Success):
```json
{
  "success": true,
  "data": {
    "id": "1708456789012",
    "amount": 50.0,
    "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNOD...",
    "recipient": "GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJG...",
    "memo": "Donation for education",
    "timestamp": "2026-02-20T10:30:00.000Z",
    "status": "pending"
  }
}
```

### Creating a Donation without Memo

The memo field is optional and can be omitted:

```json
{
  "amount": 25.0,
  "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNOD...",
  "recipient": "GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJG..."
}
```

### Error Responses

**Memo Too Long**:
```json
{
  "success": false,
  "error": {
    "code": "MEMO_TOO_LONG",
    "message": "Memo exceeds maximum length of 28 bytes (current: 35 bytes)",
    "maxLength": 28,
    "currentLength": 35
  }
}
```

**Invalid Memo Type**:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_MEMO_TYPE",
    "message": "Memo must be a string"
  }
}
```

**Invalid Memo Content**:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_MEMO_CONTENT",
    "message": "Memo cannot contain null bytes"
  }
}
```

## Database Schema

The `transactions` table includes a `memo` column:

```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  senderId INTEGER NOT NULL,
  receiverId INTEGER NOT NULL,
  amount REAL NOT NULL,
  memo TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (senderId) REFERENCES users(id),
  FOREIGN KEY (receiverId) REFERENCES users(id)
);
```

## Migration

For existing databases, run the migration script to add the memo column:

```bash
node src/scripts/addMemoColumn.js
```

This script:
- Checks if the memo column already exists
- Adds the column if needed
- Is idempotent (safe to run multiple times)
- Provides clear success/error messages

## Security Considerations

### Input Validation

- All memos are validated before storage
- Length is checked in bytes, not characters
- Null bytes are rejected
- Non-string inputs are rejected

### Sanitization

- Whitespace is trimmed
- Null bytes are removed
- XSS protection is handled by proper JSON encoding

### Data Privacy

- Memos are stored in plaintext
- Memos are included in blockchain transactions (public)
- Do not include sensitive information in memos
- Consider data privacy regulations (GDPR, etc.)

## Testing

### Unit Tests

Run memo validation tests:
```bash
npm test tests/memo-validation.test.js
```

### Integration Tests

Run memo integration tests:
```bash
npm test tests/memo-integration.test.js
```

### Manual Testing

Test with curl:

```bash
# With memo
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-123" \
  -d '{
    "amount": 10.0,
    "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNOD...",
    "recipient": "GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJG...",
    "memo": "Test donation"
  }'

# Without memo
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-124" \
  -d '{
    "amount": 5.0,
    "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNOD...",
    "recipient": "GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJG..."
  }'
```

## Best Practices

### For API Consumers

1. **Keep memos concise**: 28 bytes is limited
2. **Avoid sensitive data**: Memos are public on blockchain
3. **Use ASCII when possible**: Multi-byte characters reduce available space
4. **Handle validation errors**: Check for MEMO_TOO_LONG errors
5. **Test with edge cases**: Maximum length, special characters, etc.

### For Developers

1. **Always validate**: Use MemoValidator before storage
2. **Sanitize input**: Trim whitespace, remove null bytes
3. **Handle empty memos**: Treat null/undefined/empty string consistently
4. **Test byte length**: Not character length
5. **Document limitations**: Make constraints clear to API users

## Examples

### Valid Memos

```javascript
// Simple text
"Donation for charity"

// With numbers
"Invoice #12345"

// With special characters
"Thank you! ❤️"

// Maximum length (28 ASCII characters)
"abcdefghijklmnopqrstuvwxyz12"

// Empty (valid)
""
```

### Invalid Memos

```javascript
// Too long (29 bytes)
"abcdefghijklmnopqrstuvwxyz123"

// Contains null byte
"test\0memo"

// Not a string
123
```

## Stellar Integration

When implementing real Stellar integration, memos will be added to transactions using the Stellar SDK:

```javascript
const StellarSdk = require('stellar-sdk');

// Create transaction with memo
const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET
})
  .addOperation(StellarSdk.Operation.payment({
    destination: destinationPublic,
    asset: StellarSdk.Asset.native(),
    amount: amount
  }))
  .addMemo(StellarSdk.Memo.text(memo)) // Add memo here
  .setTimeout(180)
  .build();
```

## Troubleshooting

### Memo validation fails with "too long" error

**Problem**: Memo appears to be under 28 characters but validation fails.

**Solution**: Check for multi-byte characters. Use `Buffer.byteLength(memo, 'utf8')` to check actual byte length.

### Memo not appearing in transaction

**Problem**: Memo is sent but not stored/retrieved.

**Solution**: 
1. Verify database migration ran successfully
2. Check that memo column exists in transactions table
3. Ensure memo is being passed through all layers (API → Service → Database)

### Special characters causing issues

**Problem**: Emojis or Unicode characters cause validation errors.

**Solution**: These characters use multiple bytes. Either use fewer characters or stick to ASCII.

## Future Enhancements

Potential improvements for future versions:

1. **Multiple memo types**: Support MEMO_ID, MEMO_HASH, MEMO_RETURN
2. **Memo templates**: Pre-defined memo formats for common use cases
3. **Memo encryption**: Optional encryption for sensitive memos
4. **Memo search**: Search transactions by memo content
5. **Memo analytics**: Track common memo patterns

## References

- [Stellar Memo Documentation](https://developers.stellar.org/docs/glossary/transactions/#memo)
- [Stellar SDK Memo Types](https://stellar.github.io/js-stellar-sdk/Memo.html)
- [UTF-8 Encoding](https://en.wikipedia.org/wiki/UTF-8)
