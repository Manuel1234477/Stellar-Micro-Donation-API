# Wallet Field Encryption at Rest

Wallet `label` and `notes` fields are encrypted with AES-256-GCM before being written to the database. Decryption is transparent — API responses always return plaintext values.

## Configuration

| Env Var | Description |
|---|---|
| `ENCRYPTION_KEY` | Master key (used as version 1 when `ENCRYPTION_KEY_1` is not set) |
| `ENCRYPTION_KEY_1` | Key for version 1 (takes precedence over `ENCRYPTION_KEY`) |
| `ENCRYPTION_KEY_N` | Key for version N (e.g. `ENCRYPTION_KEY_2`) |
| `ENCRYPTION_KEY_VERSION` | Active key version for new writes (default: `1`) |

When neither `ENCRYPTION_KEY` nor `ENCRYPTION_KEY_1` is set, fields are stored as plaintext (development mode).

## Ciphertext Format

```
v<version>:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>
```

Example: `v1:a3f2...:<ct>:<tag>`

The version prefix allows the decryption path to select the correct key automatically, enabling zero-downtime key rotation.

## Key Rotation

### 1. Add the new key

```env
ENCRYPTION_KEY_1=old-secret
ENCRYPTION_KEY_2=new-secret
ENCRYPTION_KEY_VERSION=2
```

### 2. Re-encrypt all records

```http
POST /admin/encryption/rotate
Authorization: <admin API key>
```

Response:
```json
{
  "success": true,
  "data": {
    "rotated": 42,
    "skipped": 3,
    "errors": 0,
    "targetVersion": 2
  }
}
```

- `rotated` — records re-encrypted with the new key version
- `skipped` — records already at the target version or soft-deleted
- `errors` — records that failed (original ciphertext preserved)

### 3. Remove the old key

Once rotation is complete and verified, remove `ENCRYPTION_KEY_1` from your environment.

## Backward Compatibility

Records encrypted with any previous key version remain readable as long as the corresponding `ENCRYPTION_KEY_<N>` env var is present. Plaintext records (stored before encryption was enabled) are also transparently readable and will be re-encrypted on the next rotation.

## EncryptionService API

### `encryptField(value, [keyVersion])`

Encrypts a string field. Uses `ENCRYPTION_KEY_VERSION` if `keyVersion` is not specified. Returns `null`/`undefined` unchanged.

### `decryptField(ciphertext)`

Decrypts a field-level ciphertext. Automatically selects the key version from the `v<N>:` prefix. Passes through plaintext values (no prefix) unchanged.

## Encrypted Fields

| Model | Fields |
|---|---|
| Wallet | `label`, `notes` |
