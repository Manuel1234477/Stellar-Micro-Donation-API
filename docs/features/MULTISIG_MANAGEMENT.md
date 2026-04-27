# Multi-Signature Transaction Management

## Overview

High-value donations and organizational treasury operations can require multiple signers. This feature adds signer management, threshold configuration, and signature collection for Stellar multi-sig accounts.

## Endpoints

### Signer Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/wallets/:id/signers` | List signers on a wallet |
| `POST` | `/wallets/:id/signers` | Add a signer with configurable weight |
| `DELETE` | `/wallets/:id/signers/:key` | Remove a signer |
| `PATCH` | `/wallets/:id/signers/:key` | Update signer weight |

### Threshold Management

| Method | Path | Description |
|---|---|---|
| `POST` | `/wallets/:id/thresholds` | Set low/medium/high signing thresholds |

**Request body**
```json
{
  "masterSecret": "S...",
  "low": 1,
  "medium": 2,
  "high": 3
}
```

### Multi-Sig Transactions

| Method | Path | Description |
|---|---|---|
| `POST` | `/transactions/multisig` | Create a pending multi-sig transaction |
| `POST` | `/transactions/multisig/collect` | Collect a signature; auto-submits at threshold |
| `POST` | `/transactions/:id/sign` | Add a signature by transaction ID |
| `GET` | `/transactions/:id/signatures` | Get signature collection status |

#### `POST /transactions/multisig/collect`

**Request body**
```json
{
  "id": 42,
  "signer": "GABC...",
  "signed_xdr": "AAAA..."
}
```

**Response — threshold not yet met (400)**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_SIGNATURES",
    "message": "Threshold not yet met",
    "required": 3,
    "collected": 1,
    "remaining": 2
  }
}
```

**Response — threshold met (200)**
```json
{ "success": true, "data": { "id": 42, "status": "submitted", ... } }
```

## MockStellarService

`MockStellarService` simulates multi-sig state in memory:

```js
const svc = new MockStellarService();
await svc.addSigner(secret, signerPublicKey, weight);
await svc.removeSigner(secret, signerPublicKey);
await svc.setThresholds(secret, low, medium, high);
svc.getSigners(secret);    // → [{key, weight}, ...]
svc.getThresholds(secret); // → {low, medium, high}
```
