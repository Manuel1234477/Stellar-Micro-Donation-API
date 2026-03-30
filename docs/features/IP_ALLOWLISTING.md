# IP Allowlisting for API Keys

API keys can optionally be restricted to a set of IP addresses or CIDR ranges.
When an allowlist is configured, requests from any IP not on the list are rejected
with `403 Forbidden`. Keys without an allowlist accept requests from any IP.

## Supported Formats

| Format | Example | Description |
|--------|---------|-------------|
| IPv4 exact | `203.0.113.5` | Single IPv4 address |
| IPv6 exact | `2001:db8::1` | Single IPv6 address |
| IPv4 CIDR | `10.0.0.0/8` | IPv4 range |
| IPv6 CIDR | `2001:db8::/32` | IPv6 range |

## Configuration

### Create a key with an IP allowlist

```http
POST /api/v1/api-keys
x-api-key: <admin-key>
Content-Type: application/json

{
  "name": "Server-to-server key",
  "role": "user",
  "allowedIps": ["203.0.113.5", "10.0.0.0/8"]
}
```

### Update the allowlist on an existing key

```http
PATCH /api/v1/api-keys/:id
x-api-key: <admin-key>
Content-Type: application/json

{
  "allowedIps": ["203.0.113.5", "2001:db8::/32"]
}
```

Pass `"allowedIps": null` (or an empty array) to remove the restriction and allow all IPs.

## Behaviour

- **No allowlist configured** (`allowed_ips` is `NULL`): all IPs are accepted.
- **Allowlist configured**: only IPs matching at least one entry are accepted.
- **Rejected requests** receive `403 Forbidden`:
  ```json
  {
    "success": false,
    "error": {
      "code": "FORBIDDEN",
      "message": "IP address not permitted for this API key"
    }
  }
  ```
- Every rejection is logged at `WARN` level with `keyId` and `clientIp`, and written to the audit log.

## Security Assumptions

### Proxy trust and X-Forwarded-For

`req.ip` in Express reflects the real client IP **only when `trust proxy` is configured
correctly** for your deployment. If your API sits behind a load balancer or reverse proxy,
set `app.set('trust proxy', N)` where `N` is the number of trusted proxy hops.

**Do not** rely on the raw `X-Forwarded-For` header without proxy trust configuration —
it can be trivially spoofed by clients.

### IPv4-mapped IPv6 addresses

When Express receives an IPv4 connection on a dual-stack socket it may present the
address as `::ffff:127.0.0.1`. Include both forms in your allowlist if needed, or use
a CIDR that covers both (e.g. `::ffff:127.0.0.0/104` covers the entire IPv4-mapped
loopback range).

### CIDR precision

Use the most specific CIDR range that covers your known client IPs. Overly broad ranges
(e.g. `0.0.0.0/0`) defeat the purpose of allowlisting.

## Implementation Details

- **Column**: `allowed_ips TEXT` (JSON array) on the `api_keys` table.
- **Utility**: `src/utils/ipAllowlist.js` — `isIpAllowed(clientIp, allowedIps)` and `isInCidr(clientIp, cidr)`.
- **Enforcement**: `src/middleware/apiKey.js` — checked immediately after key validation, before request-signing verification.
- **Migration**: `src/scripts/migrations/addApiKeyAllowedIps.js` — adds the column to existing databases.

## Running the migration on an existing database

```bash
node src/scripts/migrations/addApiKeyAllowedIps.js
```
