# Stellar Account Trustline Management

This feature provides comprehensive trustline management capabilities for Stellar accounts, allowing users to establish, modify, and remove trustlines for custom assets.

## Overview

Trustlines in Stellar allow accounts to hold custom assets issued by other accounts. This feature provides a complete API for managing trustlines including validation, balance checks, and audit logging.

## API Endpoints

### POST /wallets/:id/trustlines
Create a trustline for a custom asset on the wallet's Stellar account.

**Request:**
```json
{
  "secretKey": "SABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF",
  "assetCode": "USD",
  "issuerPublic": "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF",
  "limit": "10000.0000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "hash": "mock_a1b2c3d4e5f6...",
    "ledger": 123456,
    "assetCode": "USD",
    "issuerPublic": "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF",
    "limit": "10000.0000000"
  }
}
```

### DELETE /wallets/:id/trustlines/:asset
Remove a trustline for a custom asset from the wallet's Stellar account.

**Request:**
```json
{
  "secretKey": "SABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF",
  "issuerPublic": "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "hash": "mock_f1e2d3c4b5a6...",
    "ledger": 123457,
    "assetCode": "USD",
    "issuerPublic": "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF"
  }
}
```

### GET /wallets/:id/trustlines
List all trustlines for the wallet's Stellar account with their balances.

**Response:**
```json
{
  "success": true,
  "data": {
    "trustlines": [
      {
        "asset": {
          "code": "USD",
          "issuer": "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF"
        },
        "balance": "100.5000000",
        "limit": "10000.0000000"
      },
      {
        "asset": {
          "code": "EUR",
          "issuer": "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEG"
        },
        "balance": "0.0000000",
        "limit": "922337203685.4775807"
      }
    ],
    "count": 2
  }
}
```

## Service Methods

### StellarService Methods

#### addTrustline(publicKey, asset)
Establish a trustline for an asset.

**Parameters:**
- `publicKey` (string): Account public key
- `asset` (object): Asset object with `code` and `issuer` properties

**Returns:** Promise<{hash: string, ledger: number}>

#### removeTrustline(publicKey, asset)
Remove a trustline for an asset.

**Parameters:**
- `publicKey` (string): Account public key  
- `asset` (object): Asset object with `code` and `issuer` properties

**Returns:** Promise<{hash: string, ledger: number}>

#### getTrustlines(publicKey)
List all trustlines for an account with their balances.

**Parameters:**
- `publicKey` (string): Account public key

**Returns:** Promise<Array<{asset: Object, balance: string, limit: string}>>

### MockStellarService Methods

The mock service provides identical methods for testing without network calls:

- `addTrustline(publicKey, asset)` - Simulates trustline creation in memory
- `removeTrustline(publicKey, asset)` - Simulates trustline removal in memory
- `getTrustlines(publicKey)` - Returns mock trustline data from memory

## Validation

### Asset Code Validation
- Must be 1-12 alphanumeric characters
- Only letters A-Z and numbers 0-9 are allowed
- Case-sensitive (uppercase recommended for consistency)

### Issuer Validation
- Must be a valid Stellar public key (56 characters starting with 'G')
- Must match format: `G[A-Z2-7]{55}`

### Balance Validation
- Trustlines can only be removed if the balance is zero
- Balance precision is limited to 7 decimal places

### Limit Validation
- Trust limit must be a positive numeric string
- Maximum limit: "922337203685.4775807" (Stellar network maximum)
- If not specified, defaults to maximum limit

## Security Considerations

### Secret Key Handling
- Secret keys are only used for transaction signing
- Keys are validated before use
- Audit logging tracks all trustline operations

### Permission Requirements
- `WALLETS_UPDATE` permission required for add/remove operations
- `WALLETS_READ` permission required for listing trustlines

### Audit Logging
All trustline operations are logged with:
- User ID and IP address
- Operation type (created, updated, removed, listed)
- Asset details and transaction hashes
- Request correlation IDs

## Error Handling

### Common Error Codes

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `INVALID_LIMIT` | Trust limit validation failed | 400 |
| `WALLET_NOT_FOUND` | Account does not exist | 404 |
| `TRANSACTION_FAILED` | Stellar operation failed | 400 |

### Validation Errors

- **400 Bad Request**: Invalid asset code, issuer, or parameters
- **404 Not Found**: Account or trustline does not exist
- **409 Conflict**: Trustline already exists (for add operations)
- **422 Unprocessable Entity**: Balance not zero (for remove operations)

## Examples

### Adding a Trustline

```javascript
const stellar = getStellarService();
const result = await stellar.addTrustline(
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
  {
    code: 'USD',
    issuer: 'GHIJKLMNOPQRSTUVWXYZ1234567890ABCDEG'
  }
);
console.log(`Trustline created: ${result.hash}`);
```

### Removing a Trustline

```javascript
const stellar = getStellarService();
const result = await stellar.removeTrustline(
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
  {
    code: 'USD',
    issuer: 'GHIJKLMNOPQRSTUVWXYZ1234567890ABCDEG'
  }
);
console.log(`Trustline removed: ${result.hash}`);
```

### Listing Trustlines

```javascript
const stellar = getStellarService();
const trustlines = await stellar.getTrustlines(
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
);
console.log(`Found ${trustlines.length} trustlines`);
trustlines.forEach(tl => {
  console.log(`${tl.asset.code}: ${tl.balance} / ${tl.limit}`);
});
```

## Testing

The feature includes comprehensive tests covering:

1. **Success Scenarios**: Adding, removing, and listing trustlines
2. **Validation**: Asset codes, issuers, and limits
3. **Error Conditions**: Duplicate trustlines, non-zero balances, invalid accounts
4. **Edge Cases**: Maximum/minimum lengths, special characters, multiple assets
5. **Mock Service**: In-memory testing without network dependencies

Run tests with:
```bash
npm test -- add-stellar-account-trustline-management.test.js
```

## Implementation Details

### In-Memory Storage (MockStellarService)

The mock service stores trustlines in a Map structure:
```javascript
wallet.trustlines = new Map([
  ['USD:GABC...', {
    asset: { code: 'USD', issuer: 'GABC...' },
    balance: '0.0000000',
    limit: '922337203685.4775807',
    active: true
  }]
]);
```

### Network Integration (StellarService)

The real service uses Stellar SDK operations:
- `changeTrust` operation for adding/removing trustlines
- Account loading to check existing balances
- Transaction submission with retry logic

### Asset Key Generation

Assets are identified using a composite key:
```javascript
const assetKey = `${asset.code}:${asset.issuer}`;
```

This allows multiple assets with the same code but different issuers.

## Dependencies

- `stellar-sdk`: Stellar blockchain integration
- `express`: HTTP API framework
- `jest`: Testing framework
- Mock service for testing without network calls

## Future Enhancements

Potential future improvements:
- Trustline limit updates without recreation
- Batch trustline operations
- Trustline expiration management
- Automated trustline cleanup
- Integration with asset discovery services
