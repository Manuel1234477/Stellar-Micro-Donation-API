# Configuration Guide

## Unsafe Development Flags

The following environment variables are provided for local development and **must never be enabled in production**. The startup checks (`src/utils/startupChecks.js`) will **abort the process** if any of these flags are `true` when `NODE_ENV=production`.

| Variable | Purpose | Production behaviour |
|---|---|---|
| `DISABLE_RATE_LIMIT` | Bypass all rate-limiting middleware | **Startup fails** |
| `CORS_ALLOW_ALL` | Allow every origin in CORS responses | **Startup fails** |
| `DEBUG_MODE` | Enable verbose debug logging | **Startup fails** |
| `DRY_RUN` | Skip real Stellar transactions | **Startup fails** |

In non-production environments the server starts but logs a prominent `⚠ WARN` for each active flag.

### Example — safe `.env` for production

```env
NODE_ENV=production
DISABLE_RATE_LIMIT=false
CORS_ALLOW_ALL=false
DEBUG_MODE=false
DRY_RUN=false
CORS_ALLOWED_ORIGINS=https://app.example.com
```

---

## Secret Strength Requirements

All signing and encryption secrets are validated at startup. The server **will refuse to start** if any secret fails the following rules:

1. **Minimum length** — at least 32 bytes (64 hex chars for hex secrets, 32 chars for others).
2. **No known placeholders** — values containing `changeme`, `secret`, `password`, `placeholder`, `example`, `todo`, `fixme`, or the patterns from `.env.example` are rejected.
3. **Unique across roles** — `ENCRYPTION_KEY`, `EXPORT_SIGNING_SECRET`, `ANONYMOUS_DONATION_SECRET`, and `JWT_SECRET` must all be distinct values.

| Variable | Role |
|---|---|
| `ENCRYPTION_KEY` | AES-256 data encryption (64 hex chars) |
| `EXPORT_SIGNING_SECRET` | HMAC signature for CSV/JSON exports |
| `ANONYMOUS_DONATION_SECRET` | Token derivation for anonymous donations |
| `JWT_SECRET` | JWT signing |

Generate strong secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## SSRF Protection

All outbound HTTP requests (webhooks, IPFS pinning, federation lookups) are validated by `src/utils/ssrf.js` before the connection is made. The validator:

- Enforces **HTTPS only** (rejects `http:`, `file:`, etc.).
- Blocks requests to private/loopback/link-local/cloud-metadata IP ranges:
  - `127.0.0.0/8` (loopback)
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (private)
  - `169.254.0.0/16` (link-local / AWS Instance Metadata Service)
  - `fc00::/7`, `fe80::/10` (IPv6 ULA / link-local)
- Performs **DNS resolution** and validates every returned IP to prevent DNS-rebinding attacks.

Affected callers: `WebhookService`, `src/utils/ipfs.js`, `src/utils/federation.js`.
