# Incident Response Runbook

> **Purpose:** Give on-call engineers a step-by-step reference for the most common production incidents.  
> Keep this document open during a live incident; it is written to be skimmed under pressure.

---

## Table of Contents

- [Severity Levels](#severity-levels)
- [General Response Flow](#general-response-flow)
- [Scenario 1 — Horizon Outage](#scenario-1--horizon-outage)
- [Scenario 2 — Database Lock Storm ("database is locked")](#scenario-2--database-lock-storm-database-is-locked)
- [Scenario 3 — Stuck / Pending Transactions](#scenario-3--stuckpending-transactions)
- [Scenario 4 — Webhook Delivery Backlog](#scenario-4--webhook-delivery-backlog)
- [Scenario 5 — API Key / Secret Compromise](#scenario-5--api-key--secret-compromise)
- [Post-Incident Checklist](#post-incident-checklist)
- [Useful Endpoints & Config Knobs](#useful-endpoints--config-knobs)

---

## Severity Levels

| Severity | Criteria | Target TTR |
|----------|----------|-----------|
| **SEV-1** | Donations cannot be created or processed; funds stuck; total outage | 30 min |
| **SEV-2** | Degraded throughput, elevated errors (>5 %), or partial feature loss | 2 hr |
| **SEV-3** | Non-critical feature broken (exports, webhooks, analytics) | 24 hr |
| **SEV-4** | Cosmetic, docs, or minor edge case | Next sprint |

---

## General Response Flow

```
1. Acknowledge — claim the incident, notify the team channel.
2. Detect scope — check GET /health and recent logs.
3. Mitigate — follow the relevant scenario below.
4. Communicate — post updates every 15 min (SEV-1) or 30 min (SEV-2).
5. Resolve — confirm normal operation.
6. Document — fill in the post-incident checklist.
```

---

## Scenario 1 — Horizon Outage

### Detection signals

- `GET /health` returns `"horizon": { "status": "unreachable" }` or `"degraded"`.
- Log pattern: `STELLAR_NETWORK_ERROR`, `HORIZON_UNAVAILABLE`, or `ECONNREFUSED` targeting the Horizon URL.
- Donations return `503 SERVICE_UNAVAILABLE` or `STELLAR_NETWORK_ERROR`.
- Circuit breaker (if enabled) logs `circuit opened for horizon`.

### Mitigation steps

1. **Confirm the outage scope.**

   ```bash
   # Check the configured Horizon endpoint
   curl "$HORIZON_URL/fee_stats"
   # Stellar status page: https://status.stellar.org
   ```

2. **Enable mock mode** to stop new donation attempts from failing with network errors (no real transactions will be submitted):

   ```bash
   # In .env (or via your config management tool)
   MOCK_STELLAR=true
   # Then restart the server (or send SIGHUP if you have hot-reload)
   ```

   > ⚠️ Mock mode means no transactions reach the blockchain. Inform stakeholders.

3. **If the outage is on a specific Horizon node**, override the URL:

   ```bash
   HORIZON_URL=https://horizon.stellar.org   # public mainnet fallback
   # or for testnet:
   HORIZON_URL=https://horizon-testnet.stellar.org
   ```

4. **Check the circuit breaker state** via admin endpoint (if available):

   ```bash
   GET /admin/circuit-breaker/state
   ```

5. **Monitor the retry queue.** Stellar operations with retry logic will automatically retry once Horizon recovers. Confirm via logs: look for `STELLAR_RETRY` at `INFO` level.

### Rollback / recovery

- Once Horizon is healthy again: set `MOCK_STELLAR=false` and restart.
- Run `POST /transactions/sync` for any wallets that may have missed confirmations during the outage.
- Review pending donations (`GET /donations?status=pending`) and reconcile manually if needed.

---

## Scenario 2 — Database Lock Storm ("database is locked")

### Detection signals

- Log pattern: `SQLITE_BUSY`, `database is locked`, or `DB_ACQUIRE_TIMEOUT`.
- `GET /health` returns `"database": { "status": "degraded" }`.
- API requests time out or return `503`.
- Multiple processes writing to the same SQLite file simultaneously (check if multiple server instances share the same `DB_PATH`).

### Mitigation steps

1. **Identify the source of contention.**

   ```bash
   # List open file handles on the DB
   lsof "$DB_PATH"
   ```

2. **Increase the acquire timeout** and WAL-mode busy timeout (if not already set):

   ```bash
   DB_ACQUIRE_TIMEOUT=30000   # 30 s (default: 10 000 ms)
   ```

   Restart the server — SQLite should drain the queue on its own.

3. **Check the pool size.** If `DB_POOL_SIZE` is too high and tasks are serialised on a single file, reduce it:

   ```bash
   DB_POOL_SIZE=3   # default is 5; reduce to 1 for a quick test
   ```

4. **Kill runaway long-running queries.** Identify via logs (`SLOW_QUERY` warnings) and redeploy / restart the problematic worker.

5. **If WAL journal is corrupt:** stop the server, run:

   ```bash
   sqlite3 "$DB_PATH" "PRAGMA integrity_check;"
   sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);"
   ```

6. **As a last resort** (SEV-1 only), restore from the most recent clean backup:

   ```bash
   POST /admin/backup/restore   # or manually copy the .db file
   ```

   See [Backup & Restore docs](../RUNTIME_ASSUMPTIONS.md) for details.

### Rollback / recovery

- Confirm `SQLITE_BUSY` errors stop appearing in logs.
- Verify `GET /health` returns `"database": "ok"`.
- Re-run any idempotent operations that failed during the lock window.

---

## Scenario 3 — Stuck / Pending Transactions

### Detection signals

- `GET /donations?status=pending` returns a large or growing list of old donations.
- Log pattern: `TRANSACTION_STUCK`, `sequence_number_mismatch`, `tx_bad_seq`, or `PENDING_TIMEOUT`.
- Recurring scheduler logs show skipped executions.
- Users report donations not clearing.

### Mitigation steps

1. **Identify stuck donations.**

   ```bash
   GET /donations?status=pending&limit=50
   ```

2. **Check if the issue is a sequence number mismatch.**

   ```bash
   # Stellar sequence is managed in SequenceCacheService / SequenceManager
   # Logs will show: "tx_bad_seq" from Horizon
   ```

   Fix: clear the sequence cache (restart the server — the cache is in-memory) and allow the next transaction to fetch a fresh sequence from Horizon.

3. **Manually trigger a transaction sync** to pull confirmed on-chain state:

   ```bash
   POST /transactions/sync
   {
     "publicKey": "<affected wallet public key>"
   }
   ```

4. **For recurring donations** that were skipped during an outage, the scheduler will auto-catch up on its next tick (every 60 s). Confirm via logs: `SCHEDULER_TICK` with `executionsAttempted > 0`.

5. **If a transaction is genuinely stuck** (submitted to Stellar but not confirmed for > 5 minutes), check Stellar directly:

   ```bash
   # Look up by transaction hash in Stellar Expert or Horizon
   curl "$HORIZON_URL/transactions/$TX_HASH"
   ```

   If the tx is not on-chain, it timed out and is safe to re-submit via idempotency key.

6. **Mark a donation as failed** (admin action) if it cannot be recovered:

   ```bash
   PATCH /donations/:id/status
   { "status": "failed" }
   ```

### Rollback / recovery

- Confirm `GET /donations?status=pending` count returns to baseline.
- Confirm the recurring scheduler resumes normal execution (logs show `SCHEDULER_TICK status=ok`).
- Notify affected users / recipients if any donations were ultimately failed.

---

## Scenario 4 — Webhook Delivery Backlog

### Detection signals

- Log pattern: `WEBHOOK_RETRY_QUEUED`, `WEBHOOK_DLQ`, or `WEBHOOK_DELIVERY_FAILED`.
- `GET /admin/webhooks/stats` shows a high `failed` or `queued` count.
- `GET /admin/webhooks/dead-letters` returns entries.
- Consumers report missing webhook events.

### Mitigation steps

1. **Check the delivery stats.**

   ```bash
   GET /admin/webhooks/stats
   ```

2. **Identify failing webhooks.** Look at the dead-letter queue:

   ```bash
   GET /admin/webhooks/dead-letters?limit=20
   ```

3. **Common root causes:**

   | Symptom | Likely cause | Fix |
   |---------|-------------|-----|
   | `ECONNREFUSED` / `ETIMEDOUT` | Consumer endpoint is down | Wait for consumer to recover; retries are automatic |
   | `4xx` from consumer | Consumer rejecting payload (bad signature or schema change) | Check `WEBHOOK_SECRET` config on both sides |
   | `TLS_SKIP_VERIFY` warnings | Consumer's TLS cert is invalid | Fix consumer cert, or temporarily set `tls_skip_verify=true` during cert renewal |

4. **Manually replay dead-letter entries** (once the consumer is healthy):

   ```bash
   POST /admin/webhooks/dead-letters/:id/replay
   ```

5. **If the backlog is too large**, temporarily disable non-critical webhooks to reduce noise:

   ```bash
   PATCH /admin/webhooks/:id
   { "isActive": false }
   ```

   Re-enable once the consumer is healthy and manually replay the DLQ.

6. **Check `WEBHOOK_SECRET`** is set and matches what the consumer expects:

   ```bash
   grep WEBHOOK_SECRET .env
   ```

   If missing, outbound webhooks fire without a signature — consumers using signature verification will reject them.

### Rollback / recovery

- Confirm `GET /admin/webhooks/stats` shows `failed` count dropping.
- Confirm DLQ is draining (`dead_letters` count decreasing).
- Confirm consumers are acknowledging deliveries with `2xx`.

---

## Scenario 5 — API Key / Secret Compromise

### Detection signals

- Unusual request patterns from an API key (volume spike, unexpected permissions used).
- Consumer reports their key was leaked in source code, logs, or a third-party service.
- Log pattern: `SUSPICIOUS_PATTERN_DETECTED`, `ABUSE_DETECTED`, or anomaly alerts.
- `ENCRYPTION_KEY` or `SERVICE_SECRET_KEY` suspected to be exposed.

### Mitigation steps

1. **Immediately revoke the compromised API key.**

   ```bash
   npm run keys -- revoke --id <key-id>
   # or via admin endpoint:
   DELETE /admin/api-keys/:id
   ```

2. **Issue replacement key(s) before revoking** if zero-downtime is required:

   ```bash
   # Create new key
   npm run keys:create -- --name "Replacement Key" --role user --expires 365
   # Share with consumer, then revoke old key
   npm run keys -- revoke --id <old-key-id>
   ```

3. **If `ENCRYPTION_KEY` is compromised:**

   > ⚠️ **This is a SEV-1 incident.** All encrypted data (memo fields, sensitive wallet metadata) is at risk.

   a. Generate a new encryption key immediately:
   ```bash
   npm run generate-key
   ```
   b. Run the re-encryption script to rotate all encrypted data:
   ```bash
   node src/scripts/reencrypt-memos.js
   node src/scripts/rotateKEK.js
   ```
   c. Update `.env` / secrets manager with the new key.
   d. Restart all server instances.

4. **If `SERVICE_SECRET_KEY` (Stellar signing key) is compromised:**

   a. Generate a new Stellar keypair immediately.
   b. Remove the old key as a signer from the Stellar account:
   ```bash
   # Via Stellar Laboratory or SDK — remove old public key from account signers
   ```
   c. Add the new key as signer with appropriate threshold.
   d. Update `SERVICE_SECRET_KEY` in `.env`.
   e. Restart all server instances.

5. **Audit recent activity** for the compromised key:

   ```bash
   GET /admin/api-keys/:id/usage?limit=100
   ```

   Check for unexpected endpoints, unusual volumes, or suspicious IPs.

6. **Review audit logs** for the timeframe:

   ```bash
   GET /admin/audit-logs?apiKeyId=<id>&startDate=<iso>&endDate=<iso>
   ```

### Rollback / recovery

- Confirm old key returns `401` on all endpoints.
- Confirm new key is working for legitimate consumers.
- Notify affected parties if data exposure is confirmed.
- File a security report if the compromise was caused by a vulnerability (see [SECURITY.md](../SECURITY.md)).

---

## Post-Incident Checklist

Fill this in after every SEV-1 or SEV-2 incident:

```
[ ] Incident start time (UTC):
[ ] Incident end time (UTC):
[ ] Severity:
[ ] Affected services/endpoints:
[ ] Root cause (one sentence):
[ ] Detection method (alert / user report / engineer noticed):
[ ] Time to detect (from start to acknowledgement):
[ ] Time to mitigate (from acknowledgement to mitigation):
[ ] Customer impact (number of failed requests / duration):
[ ] Actions taken during incident:
[ ] Follow-up tickets created:
[ ] Runbook updated? (Yes / No — link PR if yes):
```

---

## Useful Endpoints & Config Knobs

| Purpose | Endpoint / Variable |
|---------|-------------------|
| Health & dependency status | `GET /health` |
| Transaction reconciliation / sync | `POST /transactions/sync` |
| Webhook delivery stats | `GET /admin/webhooks/stats` |
| Webhook dead-letter queue | `GET /admin/webhooks/dead-letters` |
| Replay dead-letter entry | `POST /admin/webhooks/dead-letters/:id/replay` |
| Revoke API key | `DELETE /admin/api-keys/:id` |
| List pending donations | `GET /donations?status=pending` |
| Update donation status | `PATCH /donations/:id/status` |
| Database pool size | `DB_POOL_SIZE` (default `5`) |
| DB acquire timeout | `DB_ACQUIRE_TIMEOUT` (default `10000` ms) |
| Mock Stellar mode | `MOCK_STELLAR=true` |
| Override Horizon URL | `HORIZON_URL=<url>` |
| Webhook HMAC secret | `WEBHOOK_SECRET` |
| Encryption key | `ENCRYPTION_KEY` (64-char hex) |

---

*Related documents:*
- [Architecture Overview](ARCHITECTURE.md)
- [Runtime Assumptions & Configuration](../RUNTIME_ASSUMPTIONS.md)
- [Versioning & Deprecation Policy](VERSIONING_STRATEGY.md)
- [Security Policy](../SECURITY.md)
- [CI Pipeline](CI_PIPELINE.md)
