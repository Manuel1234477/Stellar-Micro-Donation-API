# Stellar Payment Channels

Payment channels enable high-frequency micro-donations between two parties with minimal on-chain transactions. Off-chain state updates are signed by both parties and only the final balance is settled on-chain, dramatically reducing fees and latency.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/channels` | Open a new channel |
| `GET` | `/channels` | List channels (`?status=open\|settled\|disputed\|closed`) |
| `GET` | `/channels/:id` | Get a single channel |
| `POST` | `/channels/:id/update` | Apply an off-chain state update |
| `POST` | `/channels/:id/settle` | Settle channel on-chain |
| `POST` | `/channels/:id/dispute` | Raise a dispute with a higher-sequence state |
| `DELETE` | `/channels/:id` | Force-close a timed-out channel |

All endpoints require a valid `x-api-key` header.

## Protocol

### 1. Open

```http
POST /channels
x-api-key: your-key

{
  "senderKey": "GSENDER...",
  "receiverKey": "GRECEIVER...",
  "capacity": 100,
  "fundingTxId": "optional-on-chain-escrow-tx-id"
}
```

Creates a channel with `balance=0`, `sequence=0`, `status=open`.

### 2. Update (off-chain)

Both parties sign the new state before submitting. No Stellar network call is made.

**Canonical state message:** `channel:<id>:seq:<sequence>:balance:<balance>`

```js
const crypto = require('crypto');
const message = `channel:${channelId}:seq:${newSeq}:balance:${newBalance}`;
const senderSig = crypto.createHmac('sha256', senderSecret).update(message).digest('hex');
const receiverSig = crypto.createHmac('sha256', receiverSecret).update(message).digest('hex');
```

```http
POST /channels/:id/update

{
  "amount": 10,
  "senderSecret": "...",
  "receiverSecret": "...",
  "senderSig": "<hex>",
  "receiverSig": "<hex>"
}
```

Each update increments `sequence` and adds `amount` to `balance`. Both signatures are verified server-side before the state is accepted.

### 3. Settle (on-chain)

Submits the accumulated balance as a single Stellar payment, then marks the channel `settled`.

```http
POST /channels/:id/settle

{ "senderSecret": "..." }
```

### 4. Dispute

If one party attempts to settle with an outdated state, the other can dispute within **24 hours** by presenting a higher-sequence mutually-signed state.

```http
POST /channels/:id/dispute

{
  "sequence": 5,
  "balance": 75,
  "senderSig": "<hex>",
  "receiverSig": "<hex>",
  "senderSecret": "...",
  "receiverSecret": "..."
}
```

The channel moves to `disputed` status with the corrected balance. Call `/settle` afterwards to close it on-chain.

### 5. Force-close (timeout)

Channels inactive for more than **7 days** can be force-closed. Any remaining balance is settled on-chain automatically.

```http
DELETE /channels/:id

{ "senderSecret": "..." }
```

## Channel States

```
open → (update)* → settled
open → disputed  → settled
open → (timeout) → closed
```

## Security

- Off-chain signatures use HMAC-SHA256 with constant-time comparison to prevent timing attacks.
- Both parties must sign every state update — neither can unilaterally advance the channel.
- Disputes must be raised within the 24-hour window and must present a strictly higher sequence number.
- Introspection of secret keys never leaves the service layer.

## Architecture

```
src/services/PaymentChannelService.js  — Full channel lifecycle logic
src/routes/channels.js                 — REST endpoint handlers
```

## Running Tests

```bash
npm test tests/add-support-for-stellar-payment-channels.test.js
```
