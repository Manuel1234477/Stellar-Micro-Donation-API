# Migrating from Legacy API Keys

Legacy API keys are the comma-separated values in the `API_KEYS` environment
variable. They are static, cannot be revoked without a restart, and bypass
per-key quotas. They are deprecated in favour of database-backed keys, which
support rotation, roles, scopes, expiry and quotas.

## Timeline

| Date | Behaviour |
|------|-----------|
| Now | Legacy keys work. Responses carry `Warning: 299` naming the sunset date. |
| `LEGACY_API_KEYS_DISABLED_AFTER` (default `2026-12-31`) | Legacy keys are rejected with `401 LEGACY_API_KEY_DISABLED`. |

The sunset date is UTC and inclusive: keys stop working at the start of the
day after the configured date.

## Step 1 — Create database-backed keys

```bash
npm run keys:create -- --name "Partner A" --role user --expires 365
npm run keys:list
```

Store the printed key in your secret manager. It is shown once.

## Step 2 — Map roles and scopes

Legacy keys are treated as role `user` (or `admin` when the key starts with
`admin-`). Choose the role that matches what each integration needs. See
[PERMISSIONS.md](PERMISSIONS.md) for the role matrix.

## Step 3 — Roll over without downtime

1. Create a new database-backed key for the integration.
2. Deploy the integration with the new key in its configuration.
3. Confirm the integration is sending the new key (see Step 4).
4. Remove the old value from the integration's configuration.

Both keys are accepted until the sunset, so there is no required cut-over window.

## Step 4 — Verify no legacy usage remains

Each request authenticated with a legacy key:

- increments the Prometheus counter `legacy_api_key_usage_total{key_id_hash}`, where
  `key_id_hash` is a non-reversible hash of the key; and
- writes an audit row with action `LEGACY_KEY_USED`.

Query the audit log for recent usage:

```bash
curl -s -H "x-api-key: <admin key>" \
  "$BASE_URL/admin/audit-logs?action=LEGACY_KEY_USED&limit=50"
```

In Prometheus, a rate of zero over the last 7 days means no integration is
still depending on legacy keys:

```promql
sum by (key_id_hash) (increase(legacy_api_key_usage_total[7d]))
```

## Step 5 — Remove `API_KEYS`

Once usage is zero, remove `API_KEYS` from your environment. The server starts
without it; startup checks only report it as informational.

## Testing the cut-over early

Set the sunset date in a staging environment to simulate enforcement:

```bash
LEGACY_API_KEYS_DISABLED_AFTER=2026-01-01
```

An invalid value (for example `2026-13-45`) is ignored and the default date is used,
so a typo cannot silently extend legacy access.
