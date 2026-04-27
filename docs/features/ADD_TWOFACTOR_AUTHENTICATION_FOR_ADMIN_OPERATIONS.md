# Two-Factor Authentication (TOTP) for Admin Operations

Time-based One-Time Password (TOTP, RFC 6238) second-factor enforcement for
admin API keys. Compatible with any TOTP authenticator app (Google Authenticator,
Authy, 1Password, etc.).

---

## Architecture

```
Admin Request
    │
    ▼
requireApiKey()          ← validates API key, populates req.apiKey
    │
    ▼
attachUserRole()         ← sets req.user.role = 'admin'
    │
    ▼
requireAdmin()           ← checks role, then checks TOTP if enabled
    │                       reads X-TOTP-Code header (or body.totpCode)
    ├── TOTP disabled → next()
    ├── TOTP enabled + valid code → next()
    └── TOTP enabled + missing/invalid code → 401 X-TOTP-Required: true
```

TOTP state is stored in the `api_keys` table alongside the key record.

---

## Module: `src/services/TOTPService.js`

### Setup flow

```
1. POST /api-keys/:id/totp/setup   → returns { secret, qrCodeDataUrl, backupCodes }
2. Scan QR code with authenticator app
3. POST /api-keys/:id/totp/verify  → { code: "123456" }  (activates TOTP)
```

### Lifecycle methods

| Method | Description |
|---|---|
| `generateSecret(keyId, keyName)` | Generate secret + QR code. TOTP not yet active. |
| `enable(keyId, code)` | Activate TOTP after verifying first code. |
| `disable(keyId, code)` | Deactivate TOTP. Requires valid TOTP or backup code. |
| `verify(keyId, code)` | Verify a 6-digit TOTP code (±1 window tolerance). |
| `verifyBackupCode(keyId, rawCode)` | Verify and consume a single-use backup code. |
| `isTotpEnabled(keyId)` | Check whether TOTP is active for a key. |
| `remainingBackupCodes(keyId)` | Count remaining backup codes. |

---

## HTTP Endpoints

All endpoints require an admin API key (`x-api-key` header with `role=admin`).

### POST /api-keys/:id/totp/setup

Generates a new TOTP secret and QR code. TOTP is **not** active until `/verify`
is called with a valid code.

**Response 200**
```json
{
  "success": true,
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "qrCodeDataUrl": "data:image/png;base64,...",
    "otpauthUrl": "otpauth://totp/StellarDonationAPI:my-key?secret=...&issuer=StellarDonationAPI",
    "backupCodes": ["a1b2c3d4e5", "..."],
    "warning": "Store backup codes securely. They will not be shown again.",
    "instructions": "Scan the QR code with your authenticator app, then call POST /totp/verify with a valid code to activate TOTP."
  }
}
```

### POST /api-keys/:id/totp/verify

Activates TOTP (first call) or verifies a code (subsequent calls).

**Request body**
```json
{ "code": "123456" }
```

**Response 200 — activation**
```json
{ "success": true, "data": { "enabled": true } }
```

**Response 401 — invalid code**
```json
{ "success": false, "error": { "code": "INVALID_TOTP", "message": "Invalid or expired TOTP code" } }
```
Header: `X-TOTP-Required: true`

### DELETE /api-keys/:id/totp

Disables TOTP. Requires a valid TOTP code or backup code in the request body.

**Request body**
```json
{ "code": "123456" }
```

---

## Using TOTP-protected admin endpoints

Once TOTP is enabled on an admin key, every admin request must include the
current 6-digit code:

```http
POST /api-keys HTTP/1.1
x-api-key: <admin-key>
X-TOTP-Code: 123456
Content-Type: application/json
```

Alternatively, pass it in the request body as `totpCode`:

```json
{ "name": "new-key", "role": "user", "totpCode": "123456" }
```

---

## Backup Codes

- 10 single-use codes are generated during setup.
- Each code is a 10-character hex string (e.g. `a1b2c3d4e5`).
- Codes are stored as SHA-256 hashes — the plain-text is shown **once** at setup.
- A backup code can be used anywhere a TOTP code is accepted (including to disable TOTP).
- After use, the code is permanently invalidated.

---

## Database Schema

Three columns are added to `api_keys` via `ALTER TABLE` (idempotent):

| Column | Type | Description |
|---|---|---|
| `totp_secret` | TEXT | Base32-encoded TOTP secret (NULL when disabled) |
| `totp_enabled` | INTEGER | 1 = active, 0 = inactive |
| `totp_backup_codes` | TEXT | JSON array of SHA-256 hashed backup codes |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TOTP_ISSUER` | `StellarDonationAPI` | Issuer name shown in authenticator apps |
| `TOTP_WINDOW` | `1` | Number of 30-second windows to accept on each side |

---

## Security Considerations

- TOTP secrets are stored in the database; ensure the database is encrypted at rest in production.
- Backup codes are stored as SHA-256 hashes — the plain-text is never persisted.
- Code comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- TOTP is optional per-key — legacy environment-variable keys are unaffected.
- The `X-TOTP-Code` header is not logged (treat it like a password).
- Disabling TOTP requires a valid code, preventing unauthorised lockout removal.

---

## Testing

```bash
npx jest tests/add-twofactor-authentication-for-admin-operations.test.js
```

Coverage areas: base32 encode/decode, RFC 6238 code generation, generateSecret,
verify (window tolerance), enable, disable, verifyBackupCode (single-use),
isTotpEnabled, requireAdmin middleware enforcement, edge cases.
