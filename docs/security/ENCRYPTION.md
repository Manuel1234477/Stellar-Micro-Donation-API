# Encryption

All symmetric encryption in the API goes through one module:
**`src/utils/crypto.js`** (#1776). Other modules are thin wrappers that map their
storage or wire format onto it and contain no cipher code.

## Core guarantees

| Property | Value |
|---|---|
| Algorithm | AES-256-GCM |
| Key | 32 bytes |
| IV | 12 random bytes (96-bit), generated inside `seal()`; callers cannot supply one |
| Auth tag | 16 bytes, length checked before decrypting (`authTagLength` pinned) |
| Decrypt failure | `CryptoError` with `code: "DECRYPTION_FAILED"`, no detail on which check failed |
| Key lookup | `keyProvider` in `src/utils/crypto.js` only |

`CryptoError.code` values: `INVALID_INPUT`, `INVALID_KEY`, `INVALID_ENVELOPE`,
`DECRYPTION_FAILED`, `KEY_NOT_CONFIGURED`.

## Who uses it

| Module | Purpose | Format |
|---|---|---|
| `src/services/EncryptionService.js` `encryptField` / `decryptField` | Wallet labels/notes, webhook secrets, TOTP secrets | Versioned envelope |
| `src/services/EncryptionService.js` `decrypt` | RSA-OAEP + AES-GCM hybrid request bodies | JSON, base64 fields |
| `src/utils/encryption.js` `encrypt` / `decrypt` | Wallet secret keys (legacy) | v0 envelope |
| `src/utils/encryption.js` `encryptWithDEK` / `decryptWithDEK` | Wallet secrets with per-wallet DEK | DEK envelope |
| `src/utils/kms.js` (local provider) | Wrapping DEKs with the KEK | v0 envelope |
| `src/utils/memoEncryption.js` | ECDH-X25519 + HKDF memo encryption | Memo envelope |
| `src/services/MemoEncryptionService.js` | Memo lifecycle and rotation (calls `memoEncryption`) | `v<n>:<base64 memo envelope>` |
| `src/services/BackupService.js` | Database backup files | Binary |
| `src/scripts/rotateKEK.js` | KEK rotation | v0 envelope |
| `src/middleware/requestDecryption.js` | Calls `EncryptionService.decrypt` | — |

Asymmetric steps (RSA-OAEP key transport, X25519 key agreement, HKDF) stay in
their wrappers because they are specific to those protocols; the AES-GCM step
they feed is always the core.

## Envelope formats

All formats below are what is already stored; the consolidation did not change
any of them, so existing data keeps decrypting.

### Versioned envelope (current default for new field data)

```
v<version>:<iv hex>:<ciphertext hex>:<tag hex>
```

- `version` selects the key: `ENCRYPTION_KEY_<version>`, falling back to
  `ENCRYPTION_KEY` for version 1.
- New values use `ENCRYPTION_KEY_VERSION` (default `1`).
- Key = SHA-256 of the configured secret.
- Values that do not start with `v` are treated as plaintext written before
  encryption was enabled (`decryptField` returns them unchanged).

Rotation: set `ENCRYPTION_KEY_<new>`, set `ENCRYPTION_KEY_VERSION=<new>`, keep the
old key configured until `POST /admin/encryption/rotate` (or
`src/scripts/reencrypt-wallet-fields.js`) has re-encrypted every row.

### v0 envelope (unversioned)

```
<iv hex>:<ciphertext hex>:<tag hex>
```

Used for legacy wallet secrets (key = SHA-256 of `securityConfig.ENCRYPTION_KEY`)
and local KMS DEK wrapping (key = SHA-256 of `ENCRYPTION_KEY`, or of
`ENCRYPTED_ENCRYPTION_KEY` when KMS is configured).

### DEK envelope

```json
{ "v": 2, "encryptedDEK": "<kms blob>", "iv": "<hex>", "ct": "<hex>", "tag": "<hex>" }
```

A random 32-byte DEK encrypts the secret; the DEK is wrapped by `kms.encryptDEK`
(local v0 envelope or AWS KMS ciphertext).

### Memo envelope

```json
{ "v": 1, "alg": "ECDH-X25519-AES256GCM", "ephemeralPublicKey": "<b64>",
  "salt": "<b64>", "iv": "<b64>", "ciphertext": "<b64>", "authTag": "<b64>" }
```

AES key = HKDF-SHA256(X25519 shared secret, salt, `"stellar-memo-encryption-v1"`).
`MemoEncryptionService` stores it as `v<memo key version>:<base64(JSON)>`.

### Request body envelope

```json
{ "encryptedKey": "<b64 RSA-OAEP(SHA-256) AES key>", "iv": "<b64>",
  "ciphertext": "<b64>", "authTag": "<b64>" }
```

### Backup files

```
iv (12 bytes) || tag (16 bytes) || ciphertext
```

## Key provider

`keyProvider` in `src/utils/crypto.js` is the only code that reads key material
from configuration:

| Method | Source |
|---|---|
| `getActiveVersion()` | `ENCRYPTION_KEY_VERSION` (default 1) |
| `getVersionedKey(n)` | `ENCRYPTION_KEY_<n>` (v1 falls back to `ENCRYPTION_KEY`) |
| `getLegacyKey()` | `securityConfig.ENCRYPTION_KEY` (unwrapped from KMS at startup when `KMS_KEY_ID` is set) |
| `resolveMasterSecret()` / `getLocalKEK()` | `ENCRYPTION_KEY`, or `ENCRYPTED_ENCRYPTION_KEY` with KMS |

`src/utils/kms.js` remains the KMS backend switch (`KMS_PROVIDER=local|aws`) for
wrapping and unwrapping DEKs.

## Tests

`tests/utils/crypto-core.test.js` holds:

- AES-256-GCM known-answer test (GCM spec vector, 256-bit key)
- Known-answer test for a stored versioned envelope
- Tamper tests (IV, ciphertext, tag, version prefix, truncated tag, AAD)
- A check that no other file in `src/` calls `createCipheriv`/`createDecipheriv`

## Adding new encrypted data

Use `encryptVersioned` / `decryptVersioned` (or `EncryptionService.encryptField`)
for anything stored at rest. Never call `crypto.createCipheriv` directly and never
generate or pass your own IV.
