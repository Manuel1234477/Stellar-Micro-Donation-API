# Content Security Policy Headers with Per-Request Nonce

Strict CSP headers with a cryptographically random nonce generated for every request. Implemented in `src/middleware/csp.js` and mounted in `src/routes/app.js`.

## How It Works

1. For each incoming request, `createCspMiddleware` generates a 16-byte random nonce encoded as base64url.
2. The nonce is stored on `res.locals.cspNonce` for use in any server-rendered HTML.
3. A `Content-Security-Policy` (or `Content-Security-Policy-Report-Only`) header is set with strict directives.

## CSP Directives

```
default-src 'none'; script-src 'nonce-{nonce}'; report-uri /csp-report
```

| Directive | Value | Purpose |
|---|---|---|
| `default-src` | `'none'` | Block all resource loading by default |
| `script-src` | `'nonce-{nonce}'` | Allow only scripts with the matching per-request nonce |
| `report-uri` | `/csp-report` (configurable) | Endpoint for violation reports |

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CSP_REPORT_ONLY` | `false` | Set to `true` to use `Content-Security-Policy-Report-Only` (observe without blocking) |
| `CSP_REPORT_URI` | `/csp-report` | URI where browsers send violation reports |

## Usage in app.js

```js
const { createCspMiddleware, cspReportRouter } = require('../middleware/csp');

// After helmet and CORS, before routes
app.use(createCspMiddleware());
app.use(cspReportRouter);
```

## Using the Nonce in Server-Rendered HTML

```js
app.get('/page', (req, res) => {
  const nonce = res.locals.cspNonce;
  res.send(`<script nonce="${nonce}">/* safe inline script */</script>`);
});
```

## Report-Only Mode

Set `CSP_REPORT_ONLY=true` in your `.env` to switch to report-only mode. Violations are reported to `CSP_REPORT_URI` but not blocked — useful for rolling out a new policy without breaking existing behaviour.

```env
CSP_REPORT_ONLY=true
CSP_REPORT_URI=/csp-report
```

## POST /csp-report

Browsers send violation reports here automatically when the `report-uri` directive is present.

- **Method**: `POST`
- **Content-Type**: `application/json` or `application/csp-report`
- **Response**: `204 No Content`
- **Effect**: Logs the report via the application logger at `WARN` level

Example violation payload:

```json
{
  "csp-report": {
    "document-uri": "https://example.com/page",
    "blocked-uri": "https://evil.com/script.js",
    "violated-directive": "script-src",
    "original-policy": "default-src 'none'; script-src 'nonce-abc123'"
  }
}
```

## Security Notes

- Nonces are generated with `crypto.randomBytes(16)` — cryptographically secure.
- A new nonce is generated per request, so nonces cannot be reused across requests.
- `default-src 'none'` is appropriate for a pure JSON API; no external resources are loaded.
- The nonce-based `script-src` is a defence-in-depth measure for any future server-rendered responses.
