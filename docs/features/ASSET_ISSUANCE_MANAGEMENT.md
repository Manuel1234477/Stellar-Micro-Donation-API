# Asset Issuance and Distribution Management

Full lifecycle management for custom Stellar assets: issuance, distribution, and holder queries.

## Overview

Organizations can issue custom Stellar assets (donation tokens, impact certificates) and distribute them to donors. The API supports:

1. **Issuing** — create new asset supply from an issuer account to a distributor
2. **Distributing** — send asset from distributor to individual recipients
3. **Querying holders** — list all current holders with balances

All issuance and distribution endpoints are **admin-only**.

## Endpoints

### Issue an Asset

```
POST /assets/issue
X-API-Key: <admin-key>

{
  "issuerSecret": "SXXX...",
  "assetCode": "DONATE",
  "distributorPublicKey": "GXXX...",
  "amount": "1000000"
}
```

- `issuerSecret` — secret key of the issuer account (controls total supply)
- `assetCode` — 1–12 alphanumeric characters
- `distributorPublicKey` — public key of the account receiving the issued supply
- `amount` — amount to issue (string, up to 7 decimal places)

Response `201`:
```json
{
  "success": true,
  "data": {
    "assetCode": "DONATE",
    "issuerPublic": "GISSUER...",
    "distributorPublicKey": "GDIST...",
    "amount": "1000000.0000000",
    "transactionHash": "abc123...",
    "ledger": 1234567
  }
}
```

### Distribute an Asset

```
POST /assets/:code/distribute
X-API-Key: <admin-key>

{
  "distributorSecret": "SDIST...",
  "issuerPublicKey": "GISSUER...",
  "recipientPublicKey": "GRECIP...",
  "amount": "100"
}
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "assetCode": "DONATE",
    "issuerPublicKey": "GISSUER...",
    "recipientPublicKey": "GRECIP...",
    "amount": "100.0000000",
    "transactionHash": "def456...",
    "ledger": 1234568
  }
}
```

### Get Asset Holders

```
GET /assets/:code/holders?issuer=GISSUER...
X-API-Key: <any-key>
```

Returns all accounts holding a non-zero balance of the asset, ordered by balance descending.

Response `200`:
```json
{
  "success": true,
  "data": {
    "assetCode": "DONATE",
    "issuerPublic": "GISSUER...",
    "holders": [
      { "holderPublicKey": "GHOLDER1...", "balance": "500.0000000", "updatedAt": "..." },
      { "holderPublicKey": "GHOLDER2...", "balance": "100.0000000", "updatedAt": "..." }
    ],
    "count": 2
  }
}
```

## StellarService Methods

### `issueAsset(issuerSecret, assetCode, amount, recipientPublic)`

Issues `amount` of `assetCode` from the issuer to `recipientPublic`. The recipient must have an existing trustline for the asset.

### `distributeAsset(distributorSecret, assetCode, issuerPublicKey, recipientPublicKey, amount)`

Sends `amount` of `assetCode` from the distributor to `recipientPublicKey`. The distributor must hold sufficient balance.

## MockStellarService

Both methods are fully simulated in `MockStellarService`:

- `issueAsset` — credits the recipient's in-memory balance
- `distributeAsset` — deducts from distributor, credits recipient; throws if insufficient balance

## Asset Lifecycle

```
Issuer ──issueAsset──► Distributor ──distributeAsset──► Recipient 1
                                   └──distributeAsset──► Recipient 2
```

## Permissions

| Endpoint | Required |
|----------|----------|
| `POST /assets/issue` | admin |
| `POST /assets/:code/distribute` | admin |
| `GET /assets/:code/holders` | any authenticated key |
