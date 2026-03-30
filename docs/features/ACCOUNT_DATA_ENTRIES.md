# Account Data Entries

Stellar accounts support up to 64 key-value data entries stored on-chain via the `manageData` operation. This API exposes full CRUD for account data entries.

## Limits (Stellar Protocol)

- Key: max **64 bytes** (UTF-8)
- Value: max **64 bytes** (UTF-8)

Violations return `400 Bad Request`.

## Endpoints

### Create / Update
```
POST /wallets/:id/data
Authorization: X-API-Key

{
  "secretKey": "S...",
  "key": "kyc_status",
  "value": "verified"
}
```
Response `201`:
```json
{ "success": true, "data": { "hash": "abc...", "ledger": 123456 } }
```

### Read All
```
GET /wallets/:id/data
Authorization: X-API-Key
```
Response `200`:
```json
{
  "success": true,
  "data": { "kyc_status": "verified", "tier": "gold" },
  "count": 2
}
```

### Delete
```
DELETE /wallets/:id/data/:key
Authorization: X-API-Key

{ "secretKey": "S..." }
```
Returns `404` if the key does not exist.

## Implementation

- `StellarService.setDataEntry(sourceSecret, key, value)` — submits a `manageData` operation
- `StellarService.deleteDataEntry(sourceSecret, key)` — sets value to `null` (Stellar deletion)
- `StellarService.getDataEntries(publicKey)` — loads account from Horizon and decodes `data_attr` from base64
- `MockStellarService` tracks data entries in an in-memory map per wallet for testing
