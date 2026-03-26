# Stellar Federation Protocol Support

## Overview

Stellar federation lets users send donations to human-readable addresses like `alice*example.com` instead of raw 56-character public keys. This API both **resolves** federation addresses and **serves as a federation server** for its own domain.

---

## New Files

| File | Purpose |
|------|---------|
| `src/utils/federation.js` | Resolve federation addresses with 1-hour cache |
| `src/routes/federation.js` | Federation server endpoints (`stellar.toml` + `/federation`) |

---

## Federation Address Resolution

Any donation endpoint that accepts a `recipient` field now transparently resolves federation addresses:

```json
POST /donations
{ "amount": "10", "recipient": "alice*example.com" }
```

The API resolves `alice*example.com` → Stellar public key before creating the record. Raw public keys pass through unchanged.

### `src/utils/federation.js` API

**`isFederationAddress(value)`** — returns `true` if the value matches `name*domain` format.

**`resolveAddress(address, opts?)`** — resolves a federation address to `{ account_id, memo_type?, memo? }`. Results are cached for 1 hour. Failures are not cached.

**`resolveRecipient(value, opts?)`** — convenience wrapper: returns the value unchanged if it's a raw key, otherwise resolves it and returns the `account_id`.

**`clearCache()` / `getCacheSize()`** — cache management (useful for testing).

---

## Federation Server Endpoints

### `GET /.well-known/stellar.toml`

Advertises this server as a federation server. Required by the Stellar protocol for domain discovery.

```
FEDERATION_SERVER="https://yourdomain.com/federation"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

- `Content-Type: text/plain`
- `Access-Control-Allow-Origin: *` (required by Stellar spec)

### `GET /federation?q=alice*yourdomain.com&type=name`

Resolves a federation address to a Stellar account.

**Success `200`**
```json
{
  "stellar_address": "alice*yourdomain.com",
  "account_id": "GABC...",
  "memo_type": "text",
  "memo": "123"
}
```

**Error responses**

| Condition | HTTP |
|-----------|------|
| Missing `q` or `type` | 400 |
| Invalid address format | 400 |
| Address not found | 404 |
| Unsupported `type` (not `name`) | 501 |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEDERATION_DOMAIN` | request hostname | Domain this server acts as federation server for |
| `FEDERATION_RECORDS` | `{}` | JSON map of pre-registered federation records |

**`FEDERATION_RECORDS` format:**
```
# Simple (name → public key)
FEDERATION_RECORDS={"alice":"GABC..."}

# With memo
FEDERATION_RECORDS={"bob":{"account_id":"GXYZ...","memo_type":"text","memo":"123"}}
```

---

## Running Tests

```bash
npm test tests/add-stellar-federation-protocol-support.test.js
```

No live Stellar network required. The SDK's `Federation.Server.resolve` is injectable via `_resolverFn` for unit tests.

---

## Security Assumptions

- Federation lookups are made over HTTPS (enforced by the Stellar SDK).
- The 1-hour cache prevents repeated lookups but means address changes take up to 1 hour to propagate.
- The `/federation` endpoint is public (no auth) per the Stellar protocol spec.
- `FEDERATION_RECORDS` is seeded at startup; runtime changes require a restart.
