# Add Support for Stellar SEP-0010 Authentication

This feature adds support for Stellar Web Authentication (SEP-0010) as an alternative auth flow to API keys.

## Behavior

- GET `/auth/challenge?account=<STELLAR_PUBLIC_KEY>`
  - Returns a signed SEP-0010 challenge transaction (XDR) from the server account.
  - Uses `SEP10Service.generateChallenge()`.

- POST `/auth/token` with `{ transaction: '<SIGNED_CHALLENGE_XDR>' }`
  - Verifies challenge expiration and signatures.
  - Issues a JWT access token `Bearer` token via `SEP10Service.issueAuthToken()`.

- `/.well-known/stellar.toml`
  - Exposes `AUTH_SERVER` and `SIGNING_KEY` as per SEP-0010 discovery.

## Security

- Server signing key is set in env var `SERVICE_SECRET_KEY` (or `STELLAR_SECRET`).
- JWT is HMAC-SHA256 signed via existing `JwtService.issueAccessToken`.
- JWT can be used in `Authorization: Bearer <token>` and is integrated in RBAC attachUserRole.

## Implementation

- `src/services/SEP10Service.js`:
  - `generateChallenge(clientAccount)`
  - `verifyChallenge(signedTransactionXDR)`
  - `issueAuthToken(stellarAccount)`

- `src/routes/auth.js`:
  - Added GET `/auth` and POST `/auth` routes.

- `src/middleware/rbac.js`:
  - Added bearer JWT path support in `attachUserRole()`.

- `src/routes/app.js`:
  - Mounted `/auth` and added TOML route for `/.well-known/stellar.toml`.

- tests:
  - `tests/add-support-for-stellar-sep0010-authentication.test.js`.
