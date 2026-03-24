# Request Signing for Enhanced API Security

Implements HMAC-SHA256 request signing (similar to AWS Signature V4) to prevent replay attacks and man-in-the-middle interception. Each request is cryptographically tied to a specific timestamp and payload.

## Signing Scheme

```
HMAC-SHA256(secret, METHOD + "\n" + path + "\n" + timestamp + "\n" + SHA256(body))
```

| Component   | Description |
|-------------|-------------|
| `METHOD`    | HTTP method in uppercase (`GET`, `POST`, etc.) |
| `path`      | Full request path including query string (e.g. `/donations?limit=5`) |
| `timestamp` | Unix timestamp in **seconds** as a string |
| `SHA256(body)` | Lowercase hex SHA-256 hash of the raw request body (`""` for no body) |

## Headers

| Header        | Required | Description |
|---------------|----------|-------------|
| `X-Timestamp` | Yes (when signing required) | Unix timestamp in seconds |
| `X-Signature` | Yes (when signing required) | Hex-encoded HMAC-SHA256 signature |

## Enabling Signing on an API Key

Create a key with `signingRequired: true`:

```bash
npm run keys:create -- --name "Secure Key" --role user --signing-required
```

Or via the API (admin only):

```http
POST /api-keys
x-api-key: <admin-key>

{
  "name": "Secure Key",
  "role": "user",
  "signingRequired": true
}
```

The response includes `keySecret` — **store it securely, it is only returned once**.

## Security Properties

- **Replay protection**: Signatures older than 5 minutes are rejected. Timestamps more than 30 seconds in the future are also rejected.
- **Payload integrity**: The body hash is included in the signed string, so any modification to the body invalidates the signature.
- **Constant-time comparison**: Signature verification uses `crypto.timingSafeEqual` semantics to prevent timing oracle attacks.
- **Backward compatible**: Keys without `signing_required` continue to work without any signature headers.

## Client Example

See [`examples/signedClient.js`](../../examples/signedClient.js) for a complete Node.js client SDK.

Quick example:

```js
const { sign } = require('./src/utils/requestSigner');

const timestamp = String(Math.floor(Date.now() / 1000));
const body = JSON.stringify({ amount: '10', donor: '...', recipient: '...' });

const { signature } = sign({
  secret: process.env.API_SECRET,
  method: 'POST',
  path: '/donations',
  timestamp,
  body,
});

// Attach to request:
// x-api-key: <your-api-key>
// x-timestamp: <timestamp>
// x-signature: <signature>
```

## Error Responses

| Scenario | Status | Code |
|----------|--------|------|
| Missing `X-Timestamp` or `X-Signature` | 401 | `INVALID_SIGNATURE` |
| Timestamp expired (> 5 min old) | 401 | `INVALID_SIGNATURE` |
| Timestamp too far in future (> 30s) | 401 | `INVALID_SIGNATURE` |
| Signature mismatch (tampered payload/path/method) | 401 | `INVALID_SIGNATURE` |

## Database Schema

Two columns are added to the `api_keys` table:

```sql
signing_required INTEGER NOT NULL DEFAULT 0,  -- 1 = signing enforced
key_secret       TEXT                          -- HMAC signing secret (hashed storage not needed; it is not the auth credential)
```

Run the migration on existing databases:

```bash
node src/scripts/migrations/addSigningRequired.js
```

## Files Changed

| File | Change |
|------|--------|
| `src/utils/requestSigner.js` | New — `sign()`, `verify()`, `hashBody()`, `buildCanonicalString()` |
| `src/middleware/apiKey.js` | Added signature verification when `signingRequired=true` |
| `src/models/apiKeys.js` | Added `signingRequired` + `keySecret` to schema and CRUD |
| `src/routes/app.js` | Added `verify` callback to `express.json()` to capture `req.rawBody` |
| `src/scripts/migrations/addSigningRequired.js` | New — DB migration |
| `examples/signedClient.js` | New — client SDK example |
| `tests/implement-request-signing-for-enhanced-api-securit.test.js` | New — 39 tests |
