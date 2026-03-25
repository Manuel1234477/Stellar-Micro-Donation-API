# End-to-End Encryption for Sensitive Wallet Data

## Overview

Wallet secret keys are protected with **envelope encryption**: each wallet gets its own
Data Encryption Key (DEK), which is itself encrypted by a master Key Encryption Key (KEK)
managed by a pluggable KMS provider.

```
Wallet Secret  ──[AES-256-GCM with DEK]──►  Ciphertext
DEK            ──[KEK via KMS provider]──►  Encrypted DEK
                                              │
                                              └─ stored alongside ciphertext
```

Only the encrypted DEK and ciphertext are persisted. The plaintext DEK exists only in
memory during an encrypt/decrypt operation.

---

## Stored Envelope Format (v2)

```json
{
  "v": 2,
  "encryptedDEK": "<kms-provider-specific blob>",
  "iv": "<12-byte hex>",
  "ct": "<hex ciphertext>",
  "tag": "<16-byte GCM auth tag hex>"
}
```

Legacy v1 records (`iv:ct:tag` hex strings) are read transparently and can be
upgraded in-place with the migration script or `rotateDEK()`.

---

## New Files

| File | Purpose |
|------|---------|
| `src/utils/kms.js` | KMS abstraction — local and AWS KMS backends |
| `src/scripts/migrations/migrateToEnvelopeEncryption.js` | One-shot DB migration |
| `tests/implement-endtoend-encryption-for-sensitive-wallet.test.js` | Full test suite |

---

## New API (`src/utils/encryption.js`)

### `encryptWithDEK(plaintext) → Promise<string>`

Generates a fresh DEK, encrypts `plaintext` with it, wraps the DEK with the KEK,
and returns a JSON envelope string.

```js
const { encryptWithDEK } = require('./src/utils/encryption');
const envelope = await encryptWithDEK(walletSecret);
// store `envelope` in the database
```

### `decryptWithDEK(envelope) → Promise<string>`

Decrypts a v2 JSON envelope. Also accepts legacy v1 strings for backward compatibility.

```js
const { decryptWithDEK } = require('./src/utils/encryption');
const secret = await decryptWithDEK(row.encryptedSecret);
```

### `rotateDEK(currentEnvelope) → Promise<string>`

Decrypts the current envelope and re-encrypts with a brand-new DEK. The plaintext
is unchanged; only the per-wallet key material is rotated.

```js
const { rotateDEK } = require('./src/utils/encryption');
const newEnvelope = await rotateDEK(row.encryptedSecret);
// UPDATE users SET encryptedSecret = newEnvelope WHERE id = row.id
```

---

## KMS Providers (`src/utils/kms.js`)

### Local (default)

Derives the KEK from `ENCRYPTION_KEY` using SHA-256. Suitable for development and
single-server deployments where the env var is managed securely (e.g. via a secrets
manager that injects it at runtime).

```env
KMS_PROVIDER=local
ENCRYPTION_KEY=<strong-random-value>
```

### AWS KMS

Uses `@aws-sdk/client-kms` to wrap/unwrap DEKs with a CMK. The plaintext DEK never
leaves the application process; AWS KMS only sees the DEK during the wrap/unwrap call.

```env
KMS_PROVIDER=aws
KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/your-key-id
AWS_REGION=us-east-1
# Standard AWS credential chain (IAM role, env vars, ~/.aws/credentials)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KMS_PROVIDER` | `local` | KMS backend: `local` or `aws` |
| `ENCRYPTION_KEY` | *(required for local)* | Master key for local KEK derivation |
| `KMS_KEY_ID` | *(required for aws)* | AWS KMS key ARN or alias |
| `AWS_REGION` | `us-east-1` | AWS region for KMS API calls |

---

## Migration

Run once to upgrade all legacy v1 records to v2 envelope format:

```bash
node src/scripts/migrations/migrateToEnvelopeEncryption.js
```

The script is idempotent — already-migrated rows are skipped.

---

## Running Tests

```bash
npm test tests/implement-endtoend-encryption-for-sensitive-wallet.test.js
```

No live Stellar network or AWS account required. AWS KMS calls are mocked with Jest.

---

## Security Assumptions

- `ENCRYPTION_KEY` (local) or the AWS CMK (aws) is the single trust anchor. Compromise
  of this key exposes all DEKs and therefore all wallet secrets.
- Rotating the KEK requires re-encrypting all DEKs (run `rotateDEK` on every row).
  Rotating a DEK (per-wallet) does **not** require changing the KEK.
- GCM authentication tags provide integrity protection; any tampering causes decryption
  to throw before returning data.
- DEKs are never logged or serialized in plaintext.
