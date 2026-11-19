# Stellar Ecosystem Proposal (SEP) Compliance

This document describes which Stellar Ecosystem Proposals this platform implements, the extent of support for each, and any deviations from or limitations of the official specifications.

**Last reviewed:** 2026-06-30  
**Stellar SDK version:** `stellar-sdk` ^11.0.0  

---

## Summary

| SEP | Title | Status | Notes |
|-----|-------|--------|-------|
| [SEP-0010](#sep-0010-stellar-web-authentication) | Stellar Web Authentication | ✅ Implemented | Challenge/response with server-signed transactions; JWT issued on success |
| [SEP-0002](#sep-0002-federation-protocol) | Federation Protocol | ✅ Implemented | `type=name` lookup; `type=id` and `type=txid` not supported |
| [SEP-0001](#sep-0001-stellartoml) | stellar.toml | ✅ Implemented | Dynamically served; federation server URL advertised |

---

## SEP-0010 — Stellar Web Authentication

**Spec reference:** https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md

### What is implemented

SEP-0010 defines a challenge-response authentication protocol. A client proves ownership of a Stellar keypair by signing a transaction constructed by the server. This platform implements the full challenge/verify flow:

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/challenge` | Generate a SEP-0010 challenge transaction |
| `POST` | `/auth/verify` | Verify a signed challenge and receive a JWT |

#### Challenge generation (`POST /auth/challenge`)

**Request body:**

```json
{
  "account": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
}
```

**Response (200 OK):**

```json
{
  "transaction": "<base64-XDR-encoded challenge transaction>"
}
```

The challenge transaction:
- Is a **Stellar transaction** built by the server's signing keypair.
- Contains a single `manageData` operation where:
  - `name` = `web_auth_<challengeId>` (hex random 32-char identifier)
  - `value` = the client's Stellar public key
- Carries a **text memo** in the format: `<homeDomain> auth <challengeId> <expiresAtUnixSeconds>`
- Is **server-signed** using `SERVICE_SECRET_KEY`.
- Expires after **15 minutes** by default (configurable via `challengeExpiresIn`).

Challenges are stored in the `sep10_challenges` database table and are single-use.

**Error responses:**

| HTTP status | Condition |
|-------------|-----------|
| 400 | Invalid or missing Stellar public key |
| 500 | Server signing key not configured |

#### Challenge verification (`POST /auth/verify`)

**Request body:**

```json
{
  "transaction": "<base64-XDR-encoded signed transaction>"
}
```

The client must:
1. Decode the challenge transaction from XDR.
2. Verify the server signature.
3. Sign the transaction with the private key matching the public key in the `manageData` value.
4. Re-encode to XDR and POST to this endpoint.

**Response (200 OK):**

```json
{
  "token": "<JWT access token>"
}
```

The JWT:
- Subject (`sub`): authenticated Stellar public key
- Claim `auth_method`: `"sep10"`
- Claim `role`: `"user"` (default)
- Signed with the server's JWT secret (HS256)

**Verification checks performed:**

1. Transaction can be decoded from XDR using the configured network passphrase.
2. Memo matches format `<homeDomain> auth <challengeId> <expiresAt>`.
3. Challenge ID in memo matches the `manageData` operation name.
4. Memo timestamp has not expired (server clock used).
5. Server signature is valid on the transaction.
6. Client account signature is valid on the transaction.
7. Challenge exists in the database (`sep10_challenges` table) and has not been used.
8. Challenge `account` field matches the key in the `manageData` value.

**Error responses:**

| HTTP status | Condition |
|-------------|-----------|
| 400 | Missing, malformed, or expired transaction |
| 400 | Invalid server or client signatures |
| 400 | Challenge not found, already used, or account mismatch |

### Deviations and caveats

| Spec requirement | This implementation |
|------------------|---------------------|
| `timebounds` set on the transaction | Not set — expiry is enforced via memo timestamp and DB TTL instead of Stellar ledger timebounds. |
| Multi-signature accounts | Not supported. Only single-key accounts are authenticated. |
| `web_auth_domain` manageData operation | Not included. The spec allows an optional second operation to declare the web auth domain; this server omits it. |
| Challenge delivered over TOML-advertised `WEB_AUTH_ENDPOINT` | `WEB_AUTH_ENDPOINT` is not added to `stellar.toml`. Integrators must use the `/auth/challenge` path directly. |

### Configuration

| Environment variable | Default | Description |
|----------------------|---------|-------------|
| `SERVICE_SECRET_KEY` | — (required) | Stellar secret key used to sign challenge transactions |
| `FEDERATION_DOMAIN` | `localhost` | `homeDomain` embedded in challenge memos |

---

## SEP-0002 — Federation Protocol

**Spec reference:** https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md

### What is implemented

SEP-0002 defines how Stellar wallets resolve human-readable addresses (`alice*example.com`) to Stellar account IDs via an HTTP-based federation server.

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/stellar.toml` | Advertises the federation server URL |
| `GET` | `/federation?q=<address>&type=name` | Resolves a federation address to an account ID |

#### `/.well-known/stellar.toml` response

```toml
# Stellar TOML for <domain>
FEDERATION_SERVER="https://<domain>/federation"
NETWORK_PASSPHRASE="<configured network passphrase>"
```

- Served with `Content-Type: text/plain; charset=utf-8`
- CORS header `Access-Control-Allow-Origin: *` included (required by protocol)

#### `/federation` endpoint

**Supported query parameter:**

| Parameter | Value | Description |
|-----------|-------|-------------|
| `q` | `alice*example.com` | Federation address to resolve |
| `type` | `name` | Lookup type |

**Response (200 OK):**

```json
{
  "stellar_address": "alice*example.com",
  "account_id": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "memo_type": "text",
  "memo": "payment-ref-123"
}
```

`memo_type` and `memo` are included only if the registered entry contains them.

**Error responses:**

| HTTP status | Condition |
|-------------|-----------|
| 400 | Missing `q` or `type` parameters, or invalid address format |
| 404 | Address not found in registry |
| 501 | `type` other than `name` (e.g. `id`, `txid`) |

### Federation registry

The federation registry is **in-memory**, populated at startup from the `FEDERATION_RECORDS` environment variable (JSON object mapping names to account IDs or full record objects):

```env
FEDERATION_RECORDS={"alice":{"account_id":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"},"bob":"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"}
```

The registry can also be populated programmatically via the exported `federationRegistry` Map from `src/routes/federation.js`.

### Deviations and caveats

| Spec requirement | This implementation |
|------------------|---------------------|
| `type=id` reverse lookup | ❌ Not implemented (returns HTTP 501) |
| `type=txid` transaction lookup | ❌ Not implemented (returns HTTP 501) |
| Persistent federation registry | ❌ In-memory only. Records are lost on server restart unless `FEDERATION_RECORDS` is set in the environment. |
| Forward-records protocol | Not applicable (this is not a forwarding server). |

---

## SEP-0001 — stellar.toml

**Spec reference:** https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md

### What is implemented

The `GET /.well-known/stellar.toml` endpoint is served dynamically. It currently advertises:

- `FEDERATION_SERVER` — pointing to `/federation` on this host
- `NETWORK_PASSPHRASE` — the configured Stellar network passphrase

### What is not implemented

The following commonly-used TOML fields are not populated by this server:

- `ACCOUNTS` — list of Stellar public keys associated with the organisation
- `SIGNING_KEY` — the server's signing public key
- `DOCUMENTATION` — org metadata (legal name, URL, logo, etc.)
- `PRINCIPALS` — contact information
- `CURRENCIES` — custom asset definitions
- `VALIDATORS` — Stellar network validator information

Operators deploying to production should supplement the dynamically-generated TOML with a static file or middleware that adds the fields relevant to their deployment.

---

## Integration guide

### Authenticate a user with SEP-0010

```bash
# Step 1: Request a challenge
CHALLENGE=$(curl -s -X POST https://your-domain/auth/challenge \
  -H "Content-Type: application/json" \
  -d '{"account":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"}' \
  | jq -r '.transaction')

# Step 2: Sign the challenge with the Stellar keypair (use your wallet or SDK)
# ... (sign $CHALLENGE and produce $SIGNED_TRANSACTION)

# Step 3: Submit the signed transaction
JWT=$(curl -s -X POST https://your-domain/auth/verify \
  -H "Content-Type: application/json" \
  -d "{\"transaction\":\"$SIGNED_TRANSACTION\"}" \
  | jq -r '.token')

# Step 4: Use the JWT in subsequent requests
curl -H "Authorization: Bearer $JWT" https://your-domain/donations
```

### Resolve a federation address (client-side)

```javascript
import { Federation } from 'stellar-sdk';

const result = await Federation.Server.resolve('alice*your-domain.com');
// result.account_id → Stellar public key
// result.memo_type, result.memo → optional payment memo
```

Or call the endpoint directly:

```bash
curl "https://your-domain/federation?q=alice*your-domain.com&type=name"
```
