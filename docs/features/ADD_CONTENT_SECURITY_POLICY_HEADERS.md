# Content Security Policy Headers

Security headers added via the [helmet](https://helmetjs.github.io/) middleware in `src/routes/app.js`. Applied early in the middleware pipeline so every response — including errors and 404s — carries the headers.

## Headers Set

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | Blocks all resource loading and framing (API-only, no browser assets) |
| `X-Frame-Options` | `DENY` | Legacy framing protection for older browsers |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `Referrer-Policy` | `no-referrer` | Suppresses the Referer header on all requests |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Enforces HTTPS for 1 year across all subdomains |
| `X-Powered-By` | *(removed)* | Hides Express fingerprint |

## Configuration

```js
// src/routes/app.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  xssFilter: false,   // X-XSS-Protection is deprecated — omitted intentionally
  hidePoweredBy: true,
}));
```

## Security Notes

- **CSP `default-src 'none'`** — appropriate for a pure JSON API; no scripts, styles, or media are served.
- **HSTS preload** — only effective once the domain is submitted to browser preload lists. Safe to include now; it signals intent.
- **`xssFilter: false`** — `X-XSS-Protection` is deprecated and can introduce vulnerabilities in older IE; helmet omits it by default and we follow that guidance.
