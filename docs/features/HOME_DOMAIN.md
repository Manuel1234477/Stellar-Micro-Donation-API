# Home Domain Feature

Allows setting and reading the `home_domain` field on a Stellar account via the `setOptions` operation.

## Endpoints

### PATCH /wallets/:id/home-domain

Set the home domain on a wallet's Stellar account.

**Permissions:** `WALLETS_UPDATE`

**Request body:**
```json
{
  "domain": "example.com",
  "sourceSecret": "S..."
}
```

**Success response (200):**
```json
{
  "success": true,
  "data": {
    "homeDomain": "example.com"
  }
}
```

**Error responses:**
- `400` — Missing `domain` or `sourceSecret`, or domain fails validation / stellar.toml check
- `404` — Wallet not found
- `502` — Stellar network error

---

### GET /wallets/:id

The standard wallet fetch now includes `homeDomain` in the response data.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "address": "G...",
    "homeDomain": "example.com"
  }
}
```

`homeDomain` defaults to `null` if not set or if the Stellar query fails.

---

## Domain Validation

- Must be a valid hostname (no `https://` prefix, no path)
- Maximum 32 characters (Stellar protocol limit)
- Regex: `^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$`

## stellar.toml Verification

Before submitting the `setOptions` transaction, the service fetches:

```
https://<domain>/.well-known/stellar.toml
```

- Timeout: **5 seconds**
- Must return a **2xx HTTP status**
- If the request times out or returns non-2xx, a `ValidationError` is thrown and the transaction is never submitted

This ensures the domain is properly configured for Stellar federation before being recorded on-chain.

## Security Assumptions

- `sourceSecret` is never logged (only `txHash` and `homeDomain` appear in audit entries)
- The stellar.toml check is a best-effort ownership signal, not a cryptographic proof
- Callers are responsible for ensuring `sourceSecret` matches the wallet's Stellar account
