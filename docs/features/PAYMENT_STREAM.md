# Stellar Payment Stream Monitoring

`PaymentStreamService` subscribes to Horizon's real-time payment stream for one or more wallet addresses. Incoming payments are detected immediately, triggering webhook delivery and transaction record creation — no reconciliation cycle required.

## How It Works

```
Horizon stream  →  PaymentStreamService._handlePayment()
                        ├── Transaction.create()   (immediate record)
                        └── WebhookService.deliver('payment.received', ...)
```

## Usage

```js
const PaymentStreamService = require('./src/services/PaymentStreamService');
const stellarService = require('./src/config/serviceContainer').getStellarService();

const streamService = new PaymentStreamService(stellarService);

streamService.subscribe('GABC...', {
  webhookUrl: 'https://your-server.com/webhooks/payments',
});

// Later:
streamService.unsubscribe('GABC...');
```

## Reconnection

Streams reconnect automatically on network interruption using exponential backoff:

| Attempt | Delay |
|---------|-------|
| 0 | 1 s |
| 1 | 2 s |
| 2 | 4 s |
| … | … |
| max | 30 s |

After 10 failed attempts the subscription is abandoned and an error is logged.

## Webhook Payload

```json
{
  "event": "payment.received",
  "publicKey": "GABC...",
  "payment": {
    "id": "tx-hash",
    "from": "GSENDER...",
    "amount": "10.0000000",
    "memo": "donation"
  }
}
```

## Security

- Stream subscriptions are **server-initiated** — no user-supplied stream URLs.
- **Replay prevention**: `Transaction.create` uses `idempotencyKey = payment.id` so duplicate stream events produce no duplicate records.
- Webhook payloads contain only **public payment data** — no secrets or private keys.
- Stream authentication is handled by the underlying `StellarService` / Horizon SDK.
