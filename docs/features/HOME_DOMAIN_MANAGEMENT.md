# Home Domain Management

Stellar accounts can set a `home_domain` field that links the account to a domain via a `stellar.toml` file. These endpoints let you set, retrieve, and verify the home domain for managed wallets.

## Endpoints

### PUT /wallets/:id/home-domain

Sets the `home_domain` field on the wallet's Stellar account via a `setOptions` transaction.

**Permission required:** `wallets:write`

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `domain` | string | ✅ | Hostname only — no protocol, no path, max 32 chars (e.g. `example.com`) |
| `sourceSecret` | string | ✅ | Secret key of the Stellar account to update |

**Success response (200)**

```json
{
  "success": true,
  "data": {
    "homeDomain": "example.com",
    "hash": "abc123...",
    "ledger": 12345
  }
}
```

**Error responses**

| Status | Reason |
|---|---|
| 400 | Missing `domain` or `sourceSecret`, or invalid domain format |
| 404 | Wallet not found |
| 502 | Stellar network error |

---

### GET /wallets/:id/home-domain

Returns the current `home_domain` value from the wallet's Stellar account.

**Permission required:** `wallets:read`

**Success response (200)**

```json
{
  "success": true,
  "data": {
    "homeDomain": "example.com"
  }
}
```

`homeDomain` is `null` when no home domain has been set.

---

### POST /wallets/:id/home-domain/verify

Fetches `https://{domain}/.well-known/stellar.toml` and confirms the wallet's public key is listed in the file.

**Permission required:** `wallets:read`

**Success response (200) — account is listed**

```json
{
  "success": true,
  "data": {
    "homeDomain": "example.com",
    "publicKey": "GABC...",
    "verified": true
  }
}
```

**Error responses**

| Status | Reason |
|---|---|
| 400 | No home domain is set on the wallet |
| 404 | Wallet not found |
| 422 | `stellar.toml` was fetched but the public key is not listed |
| 502 | `stellar.toml` could not be fetched (unreachable, timeout, non-2xx) |

---

## Domain format rules

Stellar enforces the following constraints on `home_domain`:

- Hostname only — no `https://` prefix, no path, no port
- Maximum **32 characters**
- Valid hostname characters: letters, digits, hyphens, dots

Examples:

| Value | Valid? |
|---|---|
| `example.com` | ✅ |
| `sub.example.com` | ✅ |
| `https://example.com` | ❌ protocol not allowed |
| `example.com/path` | ❌ path not allowed |
| `a`.repeat(33) | ❌ exceeds 32 chars |

---

## stellar.toml verification

The verify endpoint performs a simple text search for the wallet's public key in the raw `stellar.toml` content. The standard way to list accounts is:

```toml
ACCOUNTS=["GABC...", "GDEF..."]
```

The check is intentionally lenient — it passes as long as the public key string appears anywhere in the file, which covers all common TOML formats.

---

## Mock mode

In `MOCK_STELLAR=true` mode (`MockStellarService`):

- `setHomeDomain` validates the domain format but **skips** the live `stellar.toml` network fetch.
- `getHomeDomain` reads from in-memory wallet state.
- The verify endpoint still makes a real HTTPS request (mock it in tests with `jest.spyOn(https, 'get')`).
