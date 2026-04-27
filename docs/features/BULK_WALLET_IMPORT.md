# Bulk Wallet Import

Import multiple Stellar wallets in a single request from a CSV or JSON file. All rows are validated before any database writes, and the entire batch is inserted atomically — if any row fails, zero records are written.

## Endpoint

```
POST /wallets/bulk-import
Content-Type: multipart/form-data
```

Upload a file using the field name `file`.

### Authentication

Requires an API key with the `wallets:create` permission (`user` or `admin` role).

### Supported File Types

| MIME Type | Extension |
|-----------|-----------|
| `text/csv` | `.csv` |
| `application/json` | `.json` |

---

## CSV Format

The first row must be a header. `public_key` is required; `label` and `owner_name` are optional.

```csv
public_key,label,owner_name
GABC...XYZ,Donor Wallet,Alice
GDEF...UVW,Recipient Fund,Bob
```

---

## JSON Format

A top-level JSON array of objects. `public_key` is required.

```json
[
  { "public_key": "GABC...XYZ", "label": "Donor Wallet", "owner_name": "Alice" },
  { "public_key": "GDEF...UVW", "label": "Recipient Fund", "owner_name": "Bob" }
]
```

---

## Row Limit

The maximum number of rows per request is controlled by the `BULK_IMPORT_MAX_ROWS` environment variable (default: `1000`).

---

## Validation Rules (per row)

| Rule | Error Code |
|------|-----------|
| `public_key` must be present | `missing_public_key` |
| `public_key` must be a valid Stellar Ed25519 key | `invalid_address` |
| `secret_key` / `private_key` fields are rejected | `private_key_not_accepted` |
| Duplicate `public_key` within the same file | `duplicate_in_file` |

All rows are validated **before** any database writes. If any row fails, the entire request is rejected with `400 VALIDATION_FAILED` and a `details` array listing each failing row.

---

## Atomic Rollback

All inserts are wrapped in a snapshot-based transaction. If any insert fails after validation, all previously inserted records from this batch are rolled back. The database is left unchanged.

---

## Response

### 201 Created (success)

```json
{
  "success": true,
  "data": {
    "totalSubmitted": 10,
    "totalCreated": 10,
    "details": [
      { "row": 1, "public_key": "GABC...XYZ", "status": "created", "id": "1234567890" }
    ]
  }
}
```

### 400 Validation Failed

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed: one or more rows are invalid",
    "details": [
      { "row": 3, "public_key": "INVALID", "reason": "invalid_address" }
    ]
  }
}
```

### Error Codes

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `MISSING_FILE` | No file uploaded |
| 400 | `ROW_LIMIT_EXCEEDED` | File exceeds `BULK_IMPORT_MAX_ROWS` |
| 400 | `VALIDATION_FAILED` | One or more rows failed validation |
| 400 | `PARSE_ERROR` | File could not be parsed (malformed CSV/JSON or unsupported type) |
| 400 | `INSERT_FAILED` | Insert error after validation — batch rolled back |
| 401/403 | — | Missing or insufficient API key permissions |

---

## Example

```bash
# CSV
curl -X POST http://localhost:3000/wallets/bulk-import \
  -H "X-API-Key: your-api-key" \
  -F "file=@wallets.csv;type=text/csv"

# JSON
curl -X POST http://localhost:3000/wallets/bulk-import \
  -H "X-API-Key: your-api-key" \
  -F "file=@wallets.json;type=application/json"
```
