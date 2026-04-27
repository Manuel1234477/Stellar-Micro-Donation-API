# Webhook Signature Verification SDK

Verify `X-Webhook-Signature` headers on incoming webhook requests using HMAC-SHA256.

## How It Works

When the API dispatches a webhook it computes:

```
HMAC-SHA256(raw_request_body, shared_secret)  →  hex string
```

and sends the result in the `X-Webhook-Signature` header. Your server must recompute the same digest from the **raw body** and compare it in constant time.

> **Security assumption**: Secrets must be stored in environment variables, never hardcoded in source code.

---

## Quick Start — Express.js (Node)

```js
const express = require('express');
const { verifySignature } = require('./sdk/js/webhookVerifier');

const app = express();

// Capture the raw body BEFORE express.json() parses it.
app.use(
  express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  })
);

app.post('/webhooks', (req, res) => {
  const sig = req.headers['x-webhook-signature'];
  const secret = process.env.WEBHOOK_SECRET; // never hardcode

  if (!verifySignature(req.rawBody, sig, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Safe to process req.body here
  res.sendStatus(200);
});
```

---

## Quick Start — Flask (Python)

```python
import os
from flask import Flask, request, abort
from sdk.python.webhook_verifier import verify_signature

app = Flask(__name__)

@app.post('/webhooks')
def webhook():
    sig = request.headers.get('X-Webhook-Signature', '')
    secret = os.environ['WEBHOOK_SECRET']  # never hardcode

    # request.get_data() returns the raw bytes before Flask parses JSON.
    if not verify_signature(request.get_data(), sig, secret):
        abort(401)

    payload = request.get_json()
    # Safe to process payload here
    return '', 200
```

---

## Why Raw Body Matters

JSON parsers may reorder keys, strip whitespace, or normalise values. If you verify the signature against `request.body` (the parsed object) instead of the raw bytes, the digest will not match what the server computed — even for a legitimate request.

Always capture the raw body **before** any middleware touches it.

---

## API Reference

### JavaScript — `verifySignature(payload, signature, secret)`

| Parameter   | Type              | Description                                      |
|-------------|-------------------|--------------------------------------------------|
| `payload`   | `string\|Buffer`  | Raw request body                                 |
| `signature` | `string`          | Hex-encoded value of `X-Webhook-Signature`       |
| `secret`    | `string`          | Shared secret (from environment variable)        |

Returns `boolean`.

### Python — `verify_signature(payload, signature, secret)`

| Parameter   | Type          | Description                                      |
|-------------|---------------|--------------------------------------------------|
| `payload`   | `str\|bytes`  | Raw request body                                 |
| `signature` | `str`         | Hex-encoded value of `X-Webhook-Signature`       |
| `secret`    | `str`         | Shared secret (from environment variable)        |

Returns `bool`.

---

## Test Vectors

Shared vectors live in `sdk/test-vectors/vectors.json` and are consumed by both SDK test suites to guarantee cross-language parity.

```bash
# JavaScript
npx jest tests/webhook-sdk.test.js

# Python
python -m pytest sdk/python/test_webhook_verifier.py -v
```
