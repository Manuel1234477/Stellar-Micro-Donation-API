# Secrets Lifecycle: ENCRYPTION_KEY and API_KEYS

This document covers provisioning, rotation, emergency rotation, and revocation for the two
classes of secrets that protect data at rest and authenticate API requests.

---

## ENCRYPTION_KEY

`ENCRYPTION_KEY` is the Key Encryption Key (KEK) that wraps per-wallet Data Encryption Keys
(DEKs). Every wallet secret is encrypted under its own DEK; the DEK is encrypted by the KEK.
This is the envelope-encryption model implemented in `src/utils/kms.js`.

### Provisioning

```bash
# Generate a cryptographically random 64-hex-char (32-byte) key
npm run generate-key
# Output: a hex string. Paste it as ENCRYPTION_KEY in your secrets manager.

# Or, if using AWS KMS envelope encryption, wrap a fresh data key and store the ciphertext only.
KMS_KEY_ID=arn:aws:kms:us-east-1:123456789012:key/your-key AWS_REGION=us-east-1 npm run generate-key -- --kms
# Output: a base64 KMS ciphertext value, stored as ENCRYPTED_ENCRYPTION_KEY.
```

**Never store the key in:**
- `.env` files committed to source control
- Application logs or audit exports (the masker in `src/utils/dataMasker.js` covers field names,
  but supply-chain attacks can bypass this if the raw key is passed as a log field)
- Database backups (BackupService strips it, but verify your backup pipeline)

**Recommended source:** AWS Secrets Manager / HashiCorp Vault. Set `KMS_PROVIDER=aws` and
`KMS_KEY_ID=<your-kms-key-arn>` to use AWS KMS directly for DEK encryption (see `src/utils/kms.js`). When KMS mode is enabled, the plaintext `ENCRYPTION_KEY` is not kept in the runtime environment; only `ENCRYPTED_ENCRYPTION_KEY` is loaded and unwrapped at startup.

### Scheduled Rotation

Rotate the KEK quarterly or whenever a team member with access leaves.

```bash
# 1. Generate the new key
npm run generate-key   # copy output → NEW_KEY

# 2. Re-wrap all DEKs under the new KEK (resumable, idempotent)
ENCRYPTION_KEY=<old-key> NEW_ENCRYPTION_KEY=<new-key> npm run rotate-kek

# 3. Update ENCRYPTION_KEY in your secrets manager to <new-key>

# 4. Restart the service

# 5. Verify no record is still decryptable with the old key
ENCRYPTION_KEY=<old-key> npm run rotate-kek -- --verify
```

The rotation script (`src/scripts/rotateKEK.js`) is:

- **Resumable** — progress is checkpointed to `data/kek-rotation-checkpoint.json`; a crash
  mid-run can be recovered by re-running the same command.
- **Idempotent** — rows already wrapped under the new key are detected and skipped.
- **Crash-safe** — each row is updated atomically; no record is left unreadable if the process
  is killed between rows.

### Emergency Rotation (Suspected Compromise)

```bash
# 1. Generate a new key immediately
npm run generate-key   # → NEW_KEY

# 2. Rotate all DEKs NOW (does not require downtime)
ENCRYPTION_KEY=<compromised-key> NEW_ENCRYPTION_KEY=<new-key> npm run rotate-kek

# 3. Replace ENCRYPTION_KEY in the secrets manager with <new-key> and restart

# 4. Prove the old key cannot decrypt any record
ENCRYPTION_KEY=<compromised-key> npm run rotate-kek -- --verify
# Expected: "Verify complete: all N row(s) are correctly rotated."
```

If the verify step reports failures, re-run the rotation for the failed rows before
invalidating the old key in the secrets manager.

### What Is Never Logged

`dataMasker.js` masks any object key matching `encryption_key`, `secret`, `token`, or similar
patterns. The KMS layer (`src/utils/kms.js`) logs only the provider name, never the raw key.
BackupService excludes the `ENCRYPTION_KEY` env var from any exported state.

---

## API_KEYS

Legacy API keys are comma-separated values in the `API_KEYS` environment variable.
Database-backed keys (created via `npm run keys:create`) are the preferred approach for
production — they support per-key quotas, revocation without restarts, and audit trails.

### Provisioning

```bash
# Create a database-backed key (preferred)
npm run keys:create -- --name "partner-a" --role user
# Output: the full API key (shown once) and its id/prefix for reference
```

### Rotation

```bash
# Deprecate the old key (new requests receive a grace-period warning)
npm run keys -- deprecate --id <id>

# After the grace period, revoke it permanently
npm run keys -- revoke --id <id>
```

For legacy `API_KEYS` env-var keys, update the value in your secrets manager and restart the
service. There is no grace period for env-var keys — this is one of the reasons database-backed
keys are recommended.

### Revocation

Database-backed keys can be revoked instantly without a service restart:

```bash
npm run keys -- revoke --id <id>
```

The key is marked `revoked` in the database; the auth middleware rejects it on the next request.

### Production Safety

The startup check (`src/utils/startupChecks.js`) rejects example or placeholder keys in
`NODE_ENV=production`:
- Keys matching `dev_key_*`, `test_*`, or the `.env.example` values fail the check.
- Rotate or remove them before deploying.

---

## Migration Path: env-var → Secrets Manager

1. Store `ENCRYPTION_KEY` in AWS Secrets Manager (or equivalent).
2. At boot, load it: `ENCRYPTION_KEY=$(aws secretsmanager get-secret-value --secret-id my/enc-key --query SecretString --output text)`.
3. Set `KMS_PROVIDER=aws` and `KMS_KEY_ID=<arn>` to use AWS KMS for DEK wrapping.
4. Remove `ENCRYPTION_KEY` from `.env` / environment once the KMS path is verified.
