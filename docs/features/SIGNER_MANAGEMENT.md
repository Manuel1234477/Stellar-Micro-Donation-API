# Stellar Account Signer Management

## Overview

The Stellar Account Signer Management feature enables organizations to manage signers on their custodial wallets, supporting multi-signature configurations and secure key rotation without closing accounts.

## Features

- **Add signers**: Add new signers with configurable weights
- **Remove signers**: Remove existing signers with safety checks
- **Update signer weights**: Modify the weight of existing signers
- **List signers**: View all signers for an account
- **Safety checks**: Prevent account locking by ensuring total weight remains above threshold
- **Audit trail**: All signer changes are logged for compliance

## API Endpoints

### GET /wallets/:id/signers

Get all signers for a wallet.

**Response:**
```json
{
  "success": true,
  "data": {
    "walletId": 1,
    "publicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "signers": [
      {
        "publicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "weight": 1,
        "type": "ed25519_public_key"
      },
      {
        "publicKey": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "weight": 1,
        "type": "ed25519_public_key"
      }
    ]
  }
}
```

### POST /wallets/:id/signers

Add a signer to a wallet.

**Request Body:**
```json
{
  "signerPublic": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "weight": 1,
  "masterSecret": "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "walletId": 1,
    "signer": {
      "publicKey": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "weight": 1
    },
    "transaction": {
      "hash": "abc123...",
      "ledger": 12345
    }
  }
}
```

### DELETE /wallets/:id/signers/:key

Remove a signer from a wallet.

**Request Body:**
```json
{
  "masterSecret": "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "walletId": 1,
    "signer": {
      "publicKey": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    },
    "transaction": {
      "hash": "abc123...",
      "ledger": 12345
    }
  }
}
```

### PATCH /wallets/:id/signers/:key

Update the weight of an existing signer.

**Request Body:**
```json
{
  "weight": 2,
  "masterSecret": "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "walletId": 1,
    "signer": {
      "publicKey": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "weight": 2
    },
    "transaction": {
      "hash": "abc123...",
      "ledger": 12345
    }
  }
}
```

## Multi-Signature Configuration

### Understanding Weights and Thresholds

Stellar accounts use weights and thresholds to control signing requirements:

- **Master weight**: Weight of the master key
- **Signer weights**: Weight of each additional signer
- **Low threshold**: Weight required for low-security operations
- **Medium threshold**: Weight required for medium-security operations
- **High threshold**: Weight required for high-security operations

### Example: 2-of-3 Multi-Sig Setup

```
Master key: weight 1
Signer A: weight 1
Signer B: weight 1
Signer C: weight 1

Thresholds:
  low: 2
  medium: 2
  high: 3
```

This configuration requires:
- 2 signatures for low/medium security operations
- 3 signatures for high security operations

### Key Rotation

To rotate keys without closing the account:

1. Add new signer with weight 1
2. Verify new signer is working
3. Remove old signer
4. Update thresholds if needed

## Safety Checks

### Account Locking Prevention

The system prevents operations that would lock the account:

1. **Cannot remove last signer**: Ensures at least one signer remains
2. **Weight threshold check**: Ensures total weight remains above low threshold
3. **Master key protection**: Cannot add/remove master key as a signer

### Error Messages

```
"Cannot remove signer: account would be locked (total weight would be below low threshold)"
"Cannot add master key as a signer"
"Signer not found on account"
"Weight must be a number between 0 and 255"
```

## Security Considerations

1. **Master secret required**: All operations require the master secret key
2. **Audit logging**: All signer changes are logged with user, IP, and transaction details
3. **Weight validation**: Weights must be between 0 and 255
4. **Threshold enforcement**: Operations that would lock the account are rejected

## Audit Trail

All signer operations are logged in the audit trail:

| Action | Severity | Description |
|--------|----------|-------------|
| SIGNERS_LISTED | LOW | Signers list was queried |
| SIGNER_ADDED | HIGH | New signer was added |
| SIGNER_REMOVED | HIGH | Signer was removed |
| SIGNER_WEIGHT_UPDATED | HIGH | Signer weight was changed |

## Testing

Run tests with:

```bash
npm test tests/signer-management.test.js
```

Tests verify:
- Signer added with correct weight
- Signer removed successfully
- Last signer removal prevented
- Audit trail entry created
- Weight validation
- Account locking prevention

## Examples

### Add a Signer

```javascript
const result = await stellarService.addSigner(
  'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  1
);
```

### Remove a Signer

```javascript
const result = await stellarService.removeSigner(
  'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
);
```

### Update Signer Weight

```javascript
const result = await stellarService.updateSignerWeight(
  'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  2
);
```

### List Signers

```javascript
const signers = await stellarService.getSigners(
  'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
);
```

## Error Handling

All operations throw `ValidationError` for:
- Invalid public keys
- Invalid weights
- Attempting to lock the account
- Signer not found

Example error response:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Cannot remove signer: account would be locked (total weight would be below low threshold)"
  }
}
```
