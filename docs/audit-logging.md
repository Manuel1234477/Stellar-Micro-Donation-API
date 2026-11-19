# Audit Log Integrity
The audit log now utilizes a SHA-256 hash chain to ensure tamper-evidence. Each log entry includes a hash derived from its own contents and the hash of the preceding entry.

## Verification
Use the internal verification routine to validate the chain. It will report the first `id` where the hash link is broken.

## Authentication Event Severity and Sampling

Unauthenticated traffic is high-volume and should not become high-volume audit writes
(SQLite has a single writer). Every rejected request is counted in metrics, and
the audit log only receives a bounded sample.

| Event | Audit action | Severity | Audit frequency | Metric |
|-------|--------------|----------|-----------------|--------|
| Request without `x-api-key` | `API_KEY_VALIDATION_FAILED` | LOW | At most one row per IP per minute | `auth_failures_total{reason="missing_key"}` |
| Unknown, revoked or expired key | `API_KEY_VALIDATION_FAILED` | MEDIUM | At most one row per IP per minute | `auth_failures_total{reason="invalid_key"}` |
| Legacy environment key used | `LEGACY_KEY_USED` | LOW | At most one row per key per hour | `legacy_api_key_usage_total{key_id_hash}` |
| Successful database key validation | `API_KEY_VALIDATED` | LOW | Every request | — |

Sampling is in-process (`src/utils/authAuditThrottle.js`) and resets on restart.
Use the metrics for exact counts and the audit log for evidence of an attack or
misuse. HIGH severity is reserved for key management operations and confirmed
security incidents.
