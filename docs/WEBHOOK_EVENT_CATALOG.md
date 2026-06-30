# Webhook Event Catalog

This document is the authoritative reference for all webhook events emitted by the Stellar Micro-Donation API.

---

## Table of Contents

- [Overview](#overview)
- [Registration](#registration)
- [Delivery & Retry Semantics](#delivery--retry-semantics)
- [Event Envelope](#event-envelope)
- [Signature Verification](#signature-verification)
- [Event Reference](#event-reference)
  - [transaction.confirmed](#transactionconfirmed)
  - [donation.refunded](#donationrefunded)
  - [donation.disputed](#donationdisputed)
  - [donation.refund\_requested](#donationrefund_requested)
  - [campaign.milestone](#campaignmilestone)
  - [campaign.goal\_reached](#campaigngoal_reached)
  - [payment.received](#paymentreceived)
  - [pledge.fulfilled](#pledgefulfilled)
  - [pledge.expired](#pledgeexpired)
  - [pledge.cancelled](#pledgecancelled)
  - [matching\_program.exhausted](#matching_programexhausted)
  - [quota.exceeded](#quotaexceeded)
  - [quota.reset](#quotareset)
  - [recurring\_donation.persistent\_failure](#recurring_donationpersistent_failure)
- [Idempotency & Deduplication](#idempotency--deduplication)
- [Testing Webhooks Locally](#testing-webhooks-locally)

---

## Overview

The platform delivers webhooks as HTTP POST requests to your registered endpoint when notable events occur. Webhooks let you build real-time integrations without polling the API.

Each delivery:

- Uses `Content-Type: application/json`.
- Includes an HMAC-SHA256 signature so you can verify authenticity (see [Signature Verification](#signature-verification)).
- Is retried automatically on failure (see [Delivery & Retry Semantics](#delivery--retry-semantics)).

---

## Registration

Register a webhook endpoint via the API:

```bash
POST /webhooks
{
  "url": "https://your-server.example.com/webhooks",
  "events": ["transaction.confirmed", "donation.refunded"],
  "secret": "your-signing-secret"   // optional — generated if omitted
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | HTTPS URL to receive events |
| `events` | string[] | Yes | List of event types to subscribe to; use `["*"]` for all |
| `secret` | string | No | Your HMAC secret. If omitted, one is generated and returned once. Store it securely. |
| `ownerEmail` | string | No | Notified when repeated delivery failures occur |
| `tlsSkipVerify` | boolean | No | Skip TLS verification (dev/staging only; never production) |

---

## Delivery & Retry Semantics

| Property | Value |
|----------|-------|
| Delivery guarantee | **At-least-once** |
| Ordering | **Best-effort** — events may arrive out of order |
| Timeout per attempt | 10 seconds |
| Initial retry delay | 30 seconds |
| Retry back-off | Exponential with jitter |
| Maximum attempts | 5 |
| Dead-letter queue (DLQ) | After 5 failures the event moves to the DLQ; recoverable via `POST /admin/webhooks/dead-letters/:id/replay` |

### Implications for consumers

- **Implement idempotency.** The same event may be delivered more than once. Use the `event_id` field to deduplicate.
- **Do not rely on ordering.** A `transaction.confirmed` may arrive before its corresponding `donation.refunded` in edge cases.
- **Respond with `2xx` quickly.** The delivery times out after 10 seconds. Do heavy processing asynchronously after acknowledging with `200 OK`.

---

## Event Envelope

Every webhook POST body has this top-level structure:

```json
{
  "event": "transaction.confirmed",
  "event_id": "evt_01HZ7GXKJ8QCVW9ABCDEF",
  "api_version": "1",
  "created_at": "2026-06-29T12:00:00.000Z",
  "data": { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type (e.g. `transaction.confirmed`) |
| `event_id` | string | Unique, stable ID for this delivery — use for deduplication |
| `api_version` | string | API version that emitted this event |
| `created_at` | string | ISO 8601 timestamp when the event was created |
| `data` | object | Event-specific payload (see [Event Reference](#event-reference)) |

> **Note:** The `event_id` and outer envelope fields are automatically added by the delivery layer. The `data` shapes below document only what is inside the `data` property.

---

## Signature Verification

Every delivery includes HMAC-SHA256 signature headers. **Verify these before processing the payload.**

### Headers

| Header | Description |
|--------|-------------|
| `X-Signature` | `sha256=<hex>` — primary signature header |
| `X-Signature-Timestamp` | ISO 8601 timestamp used in the signed payload |
| `X-Webhook-Signature` | Duplicate of `X-Signature` (legacy compatibility) |
| `X-Webhook-Timestamp` | Duplicate of `X-Signature-Timestamp` (legacy compatibility) |

### Algorithm

The HMAC is computed over:

```
<X-Signature-Timestamp>.<raw-JSON-body>
```

### Verification — Node.js

```js
const crypto = require('crypto');

function verifyWebhook(req) {
  const secret    = process.env.WEBHOOK_SECRET;
  const rawBody   = req.rawBody;          // Buffer or string — must be the exact bytes received
  const signature = req.headers['x-signature'] || '';
  const timestamp = req.headers['x-signature-timestamp'] || '';

  if (!signature || !timestamp) {
    return { valid: false, reason: 'Missing signature or timestamp header' };
  }

  // 1. Compute expected signature
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  // 2. Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  // 3. Replay-protection: reject events older than 5 minutes
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(ageMs) || ageMs > 5 * 60 * 1000 || ageMs < -30 * 1000) {
    return { valid: false, reason: 'Timestamp expired or invalid' };
  }

  return { valid: true };
}
```

### Verification — Python

```python
import hmac, hashlib, time
from datetime import datetime, timezone

def verify_webhook(raw_body: bytes, signature: str, timestamp: str, secret: str) -> bool:
    expected_sig = 'sha256=' + hmac.new(
        secret.encode(),
        f'{timestamp}.'.encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_sig):
        return False

    # Reject events older than 5 minutes
    ts = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    age_s = (datetime.now(timezone.utc) - ts).total_seconds()
    return -30 <= age_s <= 300
```

> ⚠️ **Always use a constant-time comparison** (`crypto.timingSafeEqual` / `hmac.compare_digest`). A naïve string comparison is vulnerable to timing attacks.

---

## Event Reference

---

### `transaction.confirmed`

Fired when a pending transaction is confirmed on-chain by the reconciliation service.

**When it fires:** After `POST /transactions/sync` or the background reconciliation job confirms that a Stellar transaction has been included in a ledger.

**Payload (`data`):**

```json
{
  "id": 42,
  "stellarTxId": "a1b2c3d4e5f6...",
  "previousStatus": "pending",
  "status": "confirmed",
  "ledger": 12345678,
  "confirmedAt": "2026-06-29T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Internal transaction ID |
| `stellarTxId` | string | Stellar transaction hash |
| `previousStatus` | string | Status before confirmation |
| `status` | string | Always `"confirmed"` |
| `ledger` | integer\|null | Stellar ledger sequence number |
| `confirmedAt` | string | ISO 8601 timestamp |

---

### `donation.refunded`

Fired when a donation is successfully refunded.

**When it fires:** After `POST /donations/:id/refund` completes a reverse Stellar transaction.

**Payload (`data`):**

```json
{
  "donationId": 101,
  "refundId": 7,
  "amount": 10.5,
  "reverseTxId": "f6e5d4c3b2a1...",
  "reason": "Donor requested cancellation",
  "refundedAt": "2026-06-29T12:05:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `donationId` | integer | Original donation ID |
| `refundId` | integer | Refund record ID |
| `amount` | number | Refunded amount in XLM |
| `reverseTxId` | string | Stellar transaction hash for the refund |
| `reason` | string\|null | Reason provided by the initiator |
| `refundedAt` | string | ISO 8601 timestamp |

---

### `donation.disputed`

Fired when a dispute is raised against a donation.

**When it fires:** After `POST /donations/:id/dispute`.

**Payload (`data`):**

```json
{
  "donationId": 101,
  "disputeId": 3,
  "reason": "Recipient did not deliver promised service",
  "recipientPublicKey": "GABCDE...",
  "timestamp": "2026-06-29T12:10:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `donationId` | integer | Disputed donation ID |
| `disputeId` | integer | Dispute record ID |
| `reason` | string | Dispute reason provided by the claimant |
| `recipientPublicKey` | string | Recipient's Stellar public key |
| `timestamp` | string | ISO 8601 timestamp |

---

### `donation.refund_requested`

Fired when a dispute is resolved in the donor's favour and a refund has been requested.

**When it fires:** After `PATCH /donations/disputes/:id` with `resolution: "refund"`.

**Payload (`data`):**

```json
{
  "donationId": 101,
  "disputeId": 3,
  "reason": "Dispute resolution - refund approved",
  "amount": 10.5,
  "timestamp": "2026-06-29T12:15:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `donationId` | integer | Original donation ID |
| `disputeId` | integer | Dispute record ID |
| `reason` | string | Reason for the refund request |
| `amount` | number | Amount to be refunded in XLM |
| `timestamp` | string | ISO 8601 timestamp |

---

### `campaign.milestone`

Fired when a campaign passes a percentage milestone (e.g. 25 %, 50 %, 75 %).

**When it fires:** After a donation is processed that pushes a campaign past a configured milestone threshold.

**Payload (`data`):**

```json
{
  "campaign_id": 5,
  "name": "Clean Water Initiative 2026",
  "milestone_percentage": 50,
  "current_amount": 5000.0,
  "goal_amount": 10000.0,
  "progress_percentage": 50,
  "timestamp": "2026-06-29T12:20:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | integer | Campaign ID |
| `name` | string | Campaign name |
| `milestone_percentage` | integer | The milestone that was just crossed (e.g. `50`) |
| `current_amount` | number | Current total raised in XLM |
| `goal_amount` | number | Campaign goal in XLM |
| `progress_percentage` | integer | Rounded percentage of goal reached |
| `timestamp` | string | ISO 8601 timestamp |

---

### `campaign.goal_reached`

Fired when a campaign reaches 100 % of its fundraising goal.

**When it fires:** After a donation is processed that completes a campaign's goal.

**Payload (`data`):**

```json
{
  "campaign_id": 5,
  "name": "Clean Water Initiative 2026",
  "goal_amount": 10000.0,
  "final_amount": 10150.0,
  "reached_at": "2026-06-29T12:25:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | integer | Campaign ID |
| `name` | string | Campaign name |
| `goal_amount` | number | Fundraising goal in XLM |
| `final_amount` | number | Actual amount raised at closure in XLM |
| `reached_at` | string | ISO 8601 timestamp |

---

### `payment.received`

Fired when the payment stream service detects an incoming payment to a monitored wallet.

**When it fires:** While a payment stream is active for a wallet (via `PaymentStreamService`) and a new payment arrives from Stellar Horizon.

**Payload (`data`):**

```json
{
  "publicKey": "GABCDE...",
  "payment": {
    "id": "...",
    "type": "payment",
    "amount": "5.0000000",
    "asset_type": "native",
    "from": "GXYZ...",
    "to": "GABCDE...",
    "created_at": "2026-06-29T12:30:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `publicKey` | string | Monitored wallet's Stellar public key |
| `payment` | object | Raw Stellar Horizon payment record |
| `payment.id` | string | Horizon operation ID |
| `payment.amount` | string | Amount in XLM (7-decimal string) |
| `payment.asset_type` | string | `"native"` for XLM; otherwise the asset code |
| `payment.from` | string | Sender's Stellar public key |
| `payment.to` | string | Receiver's Stellar public key |
| `payment.created_at` | string | Stellar ledger close time |

---

### `pledge.fulfilled`

Fired when a pledge is fulfilled (the donor's committed donation is executed).

**When it fires:** After `PledgeFulfillmentService.checkAndFulfill` or a manual admin action confirms a pledge.

**Payload (`data`):**

```json
{
  "pledge": {
    "id": 12,
    "donorPublicKey": "GABCDE...",
    "campaignId": 5,
    "amount": 500.0,
    "status": "fulfilled",
    "fulfilledAt": "2026-06-29T12:35:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pledge.id` | integer | Pledge record ID |
| `pledge.donorPublicKey` | string | Donor's Stellar public key |
| `pledge.campaignId` | integer | Associated campaign ID |
| `pledge.amount` | number | Pledged amount in XLM |
| `pledge.status` | string | Always `"fulfilled"` |
| `pledge.fulfilledAt` | string | ISO 8601 fulfilment timestamp |

---

### `pledge.expired`

Fired when a pledge expires without being fulfilled.

**When it fires:** When the expiry worker (`expiryWorker.js`) detects a pledge whose `expires_at` has passed.

**Payload (`data`):**

```json
{
  "pledge": {
    "id": 12,
    "donorPublicKey": "GABCDE...",
    "campaignId": 5,
    "amount": 500.0,
    "status": "expired",
    "expiresAt": "2026-06-28T00:00:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pledge.id` | integer | Pledge record ID |
| `pledge.donorPublicKey` | string | Donor's Stellar public key |
| `pledge.campaignId` | integer | Associated campaign ID |
| `pledge.amount` | number | Pledged amount in XLM |
| `pledge.status` | string | Always `"expired"` |
| `pledge.expiresAt` | string | ISO 8601 expiry timestamp |

---

### `pledge.cancelled`

Fired when a pledge is manually cancelled by an admin.

**When it fires:** After `DELETE /admin/pledges/:id`.

**Payload (`data`):**

```json
{
  "pledge": {
    "id": 12,
    "donorPublicKey": "GABCDE...",
    "campaignId": 5,
    "amount": 500.0,
    "status": "cancelled"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pledge.id` | integer | Pledge record ID |
| `pledge.donorPublicKey` | string | Donor's Stellar public key |
| `pledge.campaignId` | integer | Associated campaign ID |
| `pledge.amount` | number | Pledged amount in XLM |
| `pledge.status` | string | Always `"cancelled"` |

---

### `matching_program.exhausted`

Fired when a donation-matching program has used up its full matching budget.

**When it fires:** After the last matching contribution is made that drains the program's `max_match_amount`.

**Payload (`data`):**

```json
{
  "program_id": 2,
  "sponsor_wallet_id": 9,
  "max_match_amount": 50000.0,
  "campaign_id": 5,
  "exhausted_at": "2026-06-29T12:40:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `program_id` | integer | Matching program ID |
| `sponsor_wallet_id` | integer | Sponsoring wallet ID |
| `max_match_amount` | number | Total matching budget in XLM |
| `campaign_id` | integer\|null | Associated campaign (if any) |
| `exhausted_at` | string | ISO 8601 timestamp |

---

### `quota.exceeded`

Fired when an API key exceeds its monthly request quota.

**When it fires:** On the request that pushes the key over its `monthlyQuota` limit.

**Payload (`data`):**

```json
{
  "keyId": 3,
  "keyName": "Production Integration Key",
  "quotaUsed": 10001,
  "monthlyQuota": 10000,
  "quotaResetAt": "2026-07-01T00:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `keyId` | integer | API key ID |
| `keyName` | string | Human-readable key name |
| `quotaUsed` | integer | Requests used this period |
| `monthlyQuota` | integer | Monthly request quota |
| `quotaResetAt` | string\|null | ISO 8601 timestamp when quota resets |

---

### `quota.reset`

Fired when the periodic quota-reset job resets monthly counters for API keys.

**When it fires:** Once per quota period (typically the first day of each month) by the `quotaResetJob`.

**Payload (`data`):**

```json
{
  "keysReset": 12,
  "resetAt": "2026-07-01T00:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `keysReset` | integer | Number of API keys whose quotas were reset |
| `resetAt` | string | ISO 8601 timestamp |

---

### `recurring_donation.persistent_failure`

Fired when a recurring donation fails on every retry attempt and is moved to the dead-letter queue.

**When it fires:** After the recurring donation scheduler exhausts all retry attempts for a scheduled donation execution.

**Payload (`data`):**

```json
{
  "scheduleId": 8,
  "donorPublicKey": "GABCDE...",
  "recipientPublicKey": "GXYZ...",
  "amount": 25.0,
  "frequency": "monthly",
  "failureReason": "INSUFFICIENT_BALANCE",
  "attemptCount": 5,
  "failedAt": "2026-06-29T12:45:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `scheduleId` | integer | Recurring schedule ID |
| `donorPublicKey` | string | Donor's Stellar public key |
| `recipientPublicKey` | string | Recipient's Stellar public key |
| `amount` | number | Scheduled donation amount in XLM |
| `frequency` | string | `"daily"`, `"weekly"`, or `"monthly"` |
| `failureReason` | string | Error code or message from last attempt |
| `attemptCount` | integer | Total number of attempts made |
| `failedAt` | string | ISO 8601 timestamp of final failure |

---

## Idempotency & Deduplication

Because webhooks are delivered **at-least-once**, your endpoint may receive the same event more than once.

**Recommended deduplication strategy:**

1. Extract `event_id` from the request body.
2. Check whether you have already processed an event with this ID.
3. If yes, return `200 OK` immediately (no-op).
4. If no, process the event and persist the `event_id` to your deduplication store.

```js
// Express example
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  const { valid } = verifyWebhook(req);
  if (!valid) return res.status(401).send('Invalid signature');

  const { event_id, event, data } = JSON.parse(req.body);

  // Idempotency check
  if (await db.hasProcessed(event_id)) {
    return res.status(200).send('Already processed');
  }

  await processEvent(event, data);
  await db.markProcessed(event_id);

  res.status(200).send('OK');
});
```

---

## Testing Webhooks Locally

Use a tunneling tool to expose your local server:

```bash
# Using ngrok
ngrok http 3001

# Register the tunnel URL
curl -X POST http://localhost:3000/webhooks \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-ngrok-id>.ngrok.io/webhooks",
    "events": ["*"]
  }'
```

---

*Related documents:*
- [Webhook Verification Guide](WEBHOOK_VERIFICATION.md)
- [API Examples](API_EXAMPLES.md)
- [Incident Runbook — Webhook Delivery Backlog](INCIDENT_RUNBOOK.md#scenario-4--webhook-delivery-backlog)
