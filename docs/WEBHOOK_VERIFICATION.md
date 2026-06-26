# Webhook Verification

Outbound webhooks from this API are signed so consumers can verify authenticity.

## Headers

Each webhook delivery includes the following HTTP headers:

- `X-Signature`: `sha256=<hex>` HMAC-SHA256 signature.
- `X-Signature-Timestamp`: ISO 8601 timestamp used in the HMAC payload.
- `X-Webhook-Signature`: legacy-compatible duplicate of `X-Signature`.
- `X-Webhook-Timestamp`: legacy-compatible duplicate of `X-Signature-Timestamp`.

## Signature computation

The signature is computed using the webhook endpoint's secret and the raw JSON body exactly as sent.

The signed input is:

```text
<timestamp>.<body>
```

Where:

- `<timestamp>` is the value of `X-Signature-Timestamp`.
- `<body>` is the raw JSON string sent in the request body.

## Verification example (Node.js)

```js
const crypto = require('crypto');

function verifyWebhook({ secret, rawBody, signatureHeader, timestampHeader }) {
  const signature = signatureHeader || '';
  const timestamp = timestampHeader || '';

  if (!signature || !timestamp) {
    return { valid: false, reason: 'Missing signature or timestamp header' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const expectedHeader = `sha256=${expected}`;
  if (signature !== expectedHeader) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(ageMs) || ageMs > 5 * 60 * 1000 || ageMs < -30 * 1000) {
    return { valid: false, reason: 'Timestamp expired or invalid' };
  }

  return { valid: true };
}

module.exports = { verifyWebhook };
```

## Replay protection

Consumers should enforce a timestamp window in addition to verifying the HMAC signature.

A recommended policy is:

- accept timestamps no older than 5 minutes
- reject timestamps more than 30 seconds in the future

This ensures that replayed webhook deliveries cannot be reused indefinitely.
