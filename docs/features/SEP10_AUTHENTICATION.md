# SEP-0010 Authentication

SEP-0010 (Stellar Web Authentication) provides a wallet-based, signature-driven alternative to traditional API keys for read-only access. This feature adds a full challenge-response flow, JWT issuance, and TTL/replay protections so Stellar wallets can authenticate without storing secrets on our side.

## Behavior

- `GET /auth/challenge?account=<STELLAR_PUBLIC_KEY>`
  - Issues a SEP-0010 challenge transaction signed by the service account.
  - Stores an in-memory record of the challenge ID → account mapping.
  - Responds with `{ success: true, data: { transaction: '<base64 XDR>' } }`.

- `POST /auth/token`
  - Accepts `{ transaction: '<signed_challenge_xdr>' }`.
  - Parses the memo, validates the manageData operation + signatures, and enforces the configured TTL + replay window.
  - Returns a JWT via `SEP10Service.issueAuthToken()` when the challenge is valid and unused.

- `POST /auth/token/apikey`
  - Legacy API key route that issues access + refresh token pairs for API key holders.
  - Remains protected by `requireApiKey`.

- `POST /auth/refresh`
  - Rotates refresh tokens as usual; unchanged by this feature.

## Security & Reliability

- Challenges expire after `SEP10_CHALLENGE_TTL` seconds (default 300).
- Each challenge ID is recorded in `SEP10Service.challengeStore` and is marked as used when `verifyChallenge()` succeeds.
- Replay attempts or expired challenges return `401` with an `INVALID_CHALLENGE` error and a descriptive message.
- JWTs emitted from this flow are accepted by `apiKey` middleware via the existing bearer-token handling path.
- Requests that require richer RBAC still consult roles/scopes attached to the JWT claims (`role: 'user'`, `auth_method: 'sep10'`).

## Configuration

- `SERVICE_SECRET_KEY` / `STELLAR_SECRET` — Stellar secret key for signing challenges. Required.
- `HOME_DOMAIN` — Optional domain placed in the memo; defaults to the request host if unset.
- `SEP10_CHALLENGE_TTL` — TTL (seconds) for challenges; default is `300` (5 minutes). Controls both memo expiration and the in-memory replay window via `SEP10Service`.

## Testing

- `tests/add-support-for-stellar-sep0010-authentication.test.js` covers the basic flow and TOML discovery.
- `tests/sep10-authentication-extended.test.js` exercises JWT issuance, expired challenges, and replay rejection.
