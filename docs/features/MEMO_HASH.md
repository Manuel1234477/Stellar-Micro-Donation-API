# Stellar Transaction Memo Hash Verification

Stellar hash memos allow attaching a 32-byte hash to a transaction — typically a SHA-256 hash of an external document (invoice, contract, receipt). This feature adds support for creating donations with hash memos and verifying that a document matches a transaction's stored hash.

## Creating a Donation with a Hash Memo

Pass `memoHash` in the `POST /donations` body. The value must be exactly 32 bytes encoded as:
- **Hex**: 64 lowercase hexadecimal characters (e.g. `a3f1...`)
- **Base64**: 44 characters with `=` padding (e.g. `o/E...==`)

```json
POST /donations
{
  "amount": "10",
  "recipient": "GABC...",
  "memoHash": "a3f1c2d4e5b6a7f8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
}
```

When `memoHash` is provided, `memoType` is automatically set to `hash` and the hash is stored on the transaction record. The `memo` field is ignored.

**Validation:** Returns `400` if the hash is not exactly 32 bytes in a recognised encoding.

## Verifying a Document Hash

```
POST /donations/:id/verify-memo
```

Confirms that a document's SHA-256 hash matches the hash memo stored on a donation.

### Option A — Provide the raw document

The API computes the SHA-256 hash and compares it to the stored memo hash.

```json
{
  "document": "<hex or base64 encoded raw bytes>"
}
```

### Option B — Provide the hash directly

```json
{
  "hash": "<hex or base64 encoded 32-byte hash>"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "verified": true,
    "donationId": "1234-abcd",
    "memoHash": "a3f1c2d4...",
    "providedHash": "a3f1c2d4..."
  }
}
```

`verified: false` is returned (not an error) when the hashes do not match.

### Error responses

| Status | Code | Reason |
|---|---|---|
| 400 | `MISSING_INPUT` | Neither `document` nor `hash` provided |
| 400 | `INVALID_HASH` | `hash` is not 32 bytes in a valid encoding |
| 400 | `INVALID_DOCUMENT` | `document` is not valid hex or base64 |
| 404 | `NOT_FOUND` | Donation not found |
| 422 | `NO_HASH_MEMO` | Donation has no hash memo |

## Filtering Donations by Memo Hash

```
GET /donations?memoHash=<hex or base64>
```

Returns only donations whose stored `memoHash` matches the provided value. Both hex and base64 encodings are accepted and normalised before comparison.

## Security Assumptions

- **Hash collision resistance.** SHA-256 is used for document hashing. The 32-byte output provides 128-bit collision resistance — sufficient for document integrity verification.
- **Encoding validation is strict.** The API rejects any value that is not exactly 64 hex chars or 44 base64 chars (with `=` padding). Partial or malformed hashes always return 400.
- **No document storage.** Raw document bytes are never stored. Only the 32-byte hash is persisted on the transaction record.
- **Verification is read-only.** `POST /donations/:id/verify-memo` requires `DONATIONS_READ` permission and makes no state changes.
