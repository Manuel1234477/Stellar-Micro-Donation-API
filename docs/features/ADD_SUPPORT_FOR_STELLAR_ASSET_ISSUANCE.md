# Stellar Asset Issuance Support

## Overview

Organizations can issue custom Stellar assets (donation tokens, impact certificates) to recipients. Assets can be distributed, queried, and burned (sent back to the issuer). Metadata (name, description, icon) is stored in the database.

---

## API Endpoints

### Issue an asset

```
POST /assets/issue
```

| Field | Type | Required | Description |
|---|---|---|---|
| `issuerSecret` | string | ✅ | Secret key of the issuer account |
| `assetCode` | string | ✅ | 1-12 alphanumeric characters |
| `amount` | number | ✅ | Amount to issue |
| `recipientPublic` | string | ✅ | Recipient Stellar public key |

**Response 201**
```json
{
  "success": true,
  "data": {
    "assetCode": "DONATE",
    "issuerPublic": "GISSUER...",
    "recipientPublic": "GRECIP...",
    "amount": "100.0000000",
    "transactionHash": "abc123...",
    "ledger": 1234567
  }
}
```

---

### Burn an asset

```
POST /assets/burn
```

| Field | Type | Required | Description |
|---|---|---|---|
| `holderSecret` | string | ✅ | Secret key of the holder |
| `assetCode` | string | ✅ | Asset code to burn |
| `issuerPublic` | string | ✅ | Issuer public key |
| `amount` | number | ✅ | Amount to burn |

---

### List asset holders

```
GET /assets/:code/holders?issuer=GISSUER...
```

Returns all accounts holding a non-zero balance of the asset.

---

### Get asset metadata

```
GET /assets/:code/metadata?issuer=GISSUER...
```

Returns stored metadata including `name`, `description`, `iconUrl`, `totalIssued`, `totalBurned`.

---

### Create / update asset metadata

```
PUT /assets/:code/metadata
```

| Field | Type | Required | Description |
|---|---|---|---|
| `issuerPublic` | string | ✅ | Issuer public key |
| `name` | string | ❌ | Human-readable name |
| `description` | string | ❌ | Asset description |
| `iconUrl` | string | ❌ | URL to icon image |

---

## Asset Code Rules

- 1-12 alphanumeric characters (`A-Z`, `a-z`, `0-9`)
- Case-sensitive on the Stellar network
- Examples: `DONATE`, `CERT`, `IMPACT2026`

---

## Database Tables

### `issued_assets`

| Column | Type | Description |
|---|---|---|
| `assetCode` | TEXT | Asset code |
| `issuerPublicKey` | TEXT | Issuer public key |
| `name` | TEXT | Optional display name |
| `description` | TEXT | Optional description |
| `iconUrl` | TEXT | Optional icon URL |
| `totalIssued` | TEXT | Cumulative amount issued |
| `totalBurned` | TEXT | Cumulative amount burned |

### `asset_holdings`

| Column | Type | Description |
|---|---|---|
| `assetCode` | TEXT | Asset code |
| `issuerPublicKey` | TEXT | Issuer public key |
| `holderPublicKey` | TEXT | Holder public key |
| `balance` | TEXT | Current balance |
| `updatedAt` | DATETIME | Last update time |

---

## Running Tests

```bash
npm test tests/add-support-for-stellar-asset-issuance.test.js
```

No live Stellar network required — all tests use `MockStellarService`.
