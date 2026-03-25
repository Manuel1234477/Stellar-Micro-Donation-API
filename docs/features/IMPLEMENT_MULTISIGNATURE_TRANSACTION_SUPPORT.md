# Multi-Signature Transaction Support

High-value donations can require approval from multiple authorised signers before a transaction is submitted to the Stellar network.

## Overview

Stellar natively supports multi-signature accounts where a transaction must be signed by N-of-M keys before it is valid. This feature exposes that capability through the API:

1. A caller creates a **pending** multi-sig transaction record, supplying the unsigned XDR envelope, the list of authorised signer public keys, and the required threshold.
2. Each authorised signer calls the **sign** endpoint with their signed XDR envelope.
3. When the threshold is reached the API **automatically merges all signatures and submits** the transaction to Stellar.

## Database

A single new table is added by the migration `src/scripts/migrations/addMultiSigTables.js`:

```sql
CREATE TABLE multisig_transactions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_xdr      TEXT    NOT NULL,          -- unsigned XDR envelope (base-64)
  network_passphrase   TEXT    NOT NULL,
  required_signers     INTEGER NOT NULL,           -- threshold (≥ 2)
  signer_keys          TEXT    NOT NULL,           -- JSON array of authorised public keys
  collected_signatures TEXT    NOT NULL DEFAULT '[]', -- JSON array of {signer, signed_xdr}
  status               TEXT    NOT NULL DEFAULT 'pending', -- pending|complete|submitted|failed
  stellar_tx_hash      TEXT,
  stellar_ledger       INTEGER,
  metadata             TEXT,                       -- optional JSON caller metadata
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Run the migration once before starting the server:

```bash
node src/scripts/migrations/addMultiSigTables.js
```

## API Endpoints

### POST /transactions/multisig

Create a pending multi-sig transaction.

**Request body**

| Field                | Type     | Required | Description                                      |
|----------------------|----------|----------|--------------------------------------------------|
| `transaction_xdr`    | string   | ✓        | Base-64 XDR of the **unsigned** transaction      |
| `network_passphrase` | string   | ✓        | Stellar network passphrase                       |
| `required_signers`   | integer  | ✓        | Minimum signatures needed (≥ 2)                  |
| `signer_keys`        | string[] | ✓        | Authorised signer public keys (≥ required_signers)|
| `metadata`           | object   | –        | Arbitrary caller metadata stored with the record |

**Response 201**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "pending",
    "required_signers": 2,
    "signer_keys": ["GABC...", "GDEF..."],
    "collected_signatures": [],
    "stellar_tx_hash": null,
    "stellar_ledger": null,
    "metadata": null,
    "created_at": "2026-03-23T19:00:00.000Z",
    "updated_at": "2026-03-23T19:00:00.000Z"
  }
}
```

---

### POST /transactions/:id/sign

Add a signature. Auto-submits when the threshold is met.

**Request body**

| Field       | Type   | Required | Description                                          |
|-------------|--------|----------|------------------------------------------------------|
| `signer`    | string | ✓        | Public key of the signer                             |
| `signed_xdr`| string | ✓        | Base-64 XDR of the transaction signed by this signer |

**Response 200** — returns the updated transaction record. When the threshold is met `status` will be `submitted` (or `failed` if Stellar rejected it).

**Error cases**

| Status | Reason                                      |
|--------|---------------------------------------------|
| 400    | `signer` not in `signer_keys`               |
| 400    | `signer` already signed                     |
| 400    | Missing `signer` or `signed_xdr`            |
| 404    | Transaction id not found                    |
| 422    | Transaction is not in `pending` status      |

---

### GET /transactions/:id/signatures

Retrieve signature collection status.

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "pending",
    "collected": [{ "signer": "GABC...", "signed_xdr": "AAAA..." }],
    "required": 2,
    "remaining": 1
  }
}
```

## Service Layer

`src/services/MultiSigService.js` contains all business logic:

| Method                    | Description                                                  |
|---------------------------|--------------------------------------------------------------|
| `createMultiSigTransaction` | Validates input and inserts a pending record               |
| `addSignature`            | Appends a signature; triggers `_submitTransaction` at threshold |
| `_submitTransaction`      | Delegates to `stellarService.submitMultiSigTransaction`; marks `submitted` or `failed` |
| `getTransaction`          | Fetch by id                                                  |
| `getSignatures`           | Returns collected/required/remaining counts                  |

Both `StellarService` and `MockStellarService` implement `submitMultiSigTransaction({ transaction_xdr, network_passphrase, signatures })`.

## Security Assumptions

- The API does **not** hold private keys. Signers sign the XDR client-side and submit only the signed envelope.
- `signer_keys` is validated at creation time; only listed keys may add signatures.
- Duplicate signatures from the same key are rejected.
- Once a transaction leaves `pending` status no further signatures are accepted.
- The `transaction_xdr` and `signed_xdr` fields are stored as opaque strings; the API does not parse or validate XDR structure (that is Stellar's responsibility at submission time).

## Testing

```bash
npm test tests/implement-multisignature-transaction-support.test.js
```

37 tests covering:
- Creation validation (all error paths)
- Signature collection (partial, threshold, 3-of-3)
- Auto-submission on threshold
- Failure handling (Stellar network error → `failed` status)
- HTTP endpoint contracts (201, 200, 400, 404, 422)
- Isolation between independent transactions
