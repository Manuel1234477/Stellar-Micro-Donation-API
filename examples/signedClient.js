'use strict';

/**
 * SignedApiClient
 * ----------------
 * Minimal, runnable example client for the Stellar Micro-Donation API's
 * HMAC-SHA256 request-signing feature (see src/utils/requestSigner.js and
 * src/middleware/apiKey.js).
 *
 * Usage:
 *
 *   const SignedApiClient = require('./examples/signedClient');
 *   const client = new SignedApiClient({
 *     baseUrl:   'http://localhost:3000/api/v1',
 *     apiKey:    process.env.API_KEY,
 *     apiSecret: process.env.API_KEY_SECRET,
 *   });
 *   const res       = await client.get('/api/v1/donations/recent?limit=10');
 *   const created   = await client.post('/api/v1/wallets', { address: 'G…', name: 'My wallet' });
 *
 * Note:
 *   All example paths are versioned (`/api/v1/...`). Unversioned legacy
 *   paths are deprecated and only return 308 redirects to `/api/v1/*`;
 *   they will be removed on the sunset date announced in
 *   docs/VERSIONING_STRATEGY.md.
 *
 * Behavior:
 *   - Generates a fresh Unix-seconds timestamp per request
 *   - Generates a fresh X-Nonce (UUID v4) per request to defeat replay attacks
 *   - Builds the canonical signing string from METHOD + path+query + ts + sha256(body)
 *     where `path+query` matches what the server sees as `req.originalUrl`
 *     (e.g. '/api/v1/donations?limit=10')
 *   - Attaches X-API-Key, X-Timestamp, X-Signature, X-Nonce headers
 *   - Sends via the global `fetch` (Node >= 18). A custom fetch can be
 *     injected via the `fetch` constructor option (useful for tests).
 *
 * Compatibility:
 *   - The `_sign(method, path, timestamp, body)` method is preserved for
 *     existing tests and consumers that want to compute a signature manually.
 */

const crypto = require('crypto');
const { sign: signerSign } = require('../src/utils/requestSigner');

const SUPPORTED_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

function generateNonce() {
  // 16 random bytes hex-encoded gives us a 32-char nonce. The server only
  // requires uniqueness, so any random string of sufficient entropy works.
  return crypto.randomBytes(16).toString('hex');
}

class SignedApiClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl     e.g. 'http://localhost:3000/api/v1'
   * @param {string} options.apiKey      The X-API-Key value
   * @param {string} options.apiSecret   The HMAC secret for signing
   * @param {function} [options.fetch]   Optional fetch implementation (for testing)
   * @param {object}   [options.defaultHeaders] Extra headers applied to every request
   * @param {function} [options.generateNonce] Optional override for nonce generation
   */
  constructor({
    baseUrl,
    apiKey,
    apiSecret,
    fetch: fetchImpl,
    defaultHeaders,
    generateNonce: generateNonceImpl,
  } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.defaultHeaders = defaultHeaders || {};
    this.generateNonce = typeof generateNonceImpl === 'function' ? generateNonceImpl : generateNonce;
    this._fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  }

  /**
   * Produce a hex HMAC-SHA256 signature for a request.
   *
   * Method is upper-cased to match the server's canonical-string format.
   * `body` is treated as the *raw* request body — JSON-stringify any object
   * before passing.
   *
   * @param {string} method              HTTP method ('GET', 'POST', …)
   * @param {string} path                Request path including query string
   * @param {number|string} timestamp    Unix timestamp in seconds
   * @param {string} [body='']           Raw request body string ('' for empty)
   * @returns {string} lowercase hex signature
   */
  _sign(method, path, timestamp, body = '') {
    const { signature } = signerSign({
      secret: this.apiSecret,
      method,
      path,
      timestamp: String(timestamp),
      body: typeof body === 'string' ? body : '',
    });
    return signature;
  }

  /**
   * Build the signed header set for a request.
   * @private
   */
  _signedHeaders(method, pathWithQuery, rawBody, extraHeaders) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = this.generateNonce();
    const { signature } = signerSign({
      secret: this.apiSecret,
      method,
      path: pathWithQuery,
      timestamp,
      body: rawBody,
    });

    const baseHeaders = { ...this.defaultHeaders, ...(extraHeaders || {}) };
    return {
      ...baseHeaders,
      'X-API-Key': this.apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Nonce': nonce,
    };
  }

  /**
   * Resolve a relative path into a fully-qualified URL.
   * The baseUrl's mount prefix (path component) is preserved verbatim —
   * standard URL resolution would replace it, which is wrong for our use
   * case (the server signs `req.originalUrl`, which always includes the
   * mount prefix like `/api/v1`).
   * @private
   */
  _buildUrl(path, query) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
      // Already absolute
      const url = new URL(path);
      this._applyQuery(url, query);
      return url;
    }
    if (!this.baseUrl) {
      throw new Error('SignedApiClient: baseUrl is required when path is relative');
    }

    const baseUrlObj = new URL(this.baseUrl);
    const baseMount = baseUrlObj.pathname.replace(/\/+$/, '');
    const relative = path.startsWith('/') ? path : `/${path}`;

    // Protocol + host + baseMount + relative, with any redundant slashes removed.
    const origin = `${baseUrlObj.protocol}//${baseUrlObj.host}`;
    const pathComponent = `${baseMount}${relative}`.replace(/\/{2,}/g, '/');
    const url = new URL(`${origin}${pathComponent}`);
    this._applyQuery(url, query);
    return url;
  }

  /**
   * Apply a query object to a URL's searchParams.
   * @private
   */
  _applyQuery(url, query) {
    if (!query || typeof query !== 'object') return;
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  /**
   * Serialize the request body and pick the Content-Type.
   * @private
   */
  _serializeBody(opts) {
    const { body, bodyRaw, headers } = opts;
    const headersHasCT = headers && Object.keys(headers).some(
      (k) => k.toLowerCase() === 'content-type'
    );

    if (bodyRaw !== undefined && bodyRaw !== null) {
      if (typeof bodyRaw !== 'string') {
        throw new TypeError('SignedApiClient: opts.bodyRaw must be a string');
      }
      return { rawBody: bodyRaw, contentType: headersHasCT ? null : 'application/json' };
    }
    if (body === undefined || body === null) {
      return { rawBody: '', contentType: null };
    }
    if (typeof body === 'string') {
      return { rawBody: body, contentType: headersHasCT ? null : 'text/plain' };
    }
    return { rawBody: JSON.stringify(body), contentType: headersHasCT ? null : 'application/json' };
  }

  /**
   * Send a signed HTTP request and return the parsed response.
   *
   * @param {string} method   'GET' | 'POST' | …
   * @param {string} path     relative path (e.g. '/api/v1/donations') — may
   *                          include a query string. If `opts.query` is
   *                          provided it is merged on top. Always use the
   *                          versioned `/api/v1/...` form; unversioned paths
   *                          are deprecated and will be removed.
   * @param {object} [opts]
   * @param {object} [opts.body]      Plain-object body to JSON-encode
   * @param {string} [opts.bodyRaw]   Pre-serialized raw body string
   * @param {object} [opts.query]     Query parameters
   * @param {object} [opts.headers]   Extra request headers (X-* signing
   *                                  headers cannot be overridden)
   * @returns {Promise<{status:number, ok:boolean, headers:object, url:string, data:any}>}
   */
  async request(method, path, opts = {}) {
    const upper = String(method || 'GET').toUpperCase();
    if (!SUPPORTED_METHODS.has(upper)) {
      throw new Error(`SignedApiClient: unsupported HTTP method "${method}"`);
    }
    if (!this._fetch) {
      throw new Error(
        'SignedApiClient: no fetch implementation available. ' +
        'Use Node >= 18 or pass `fetch` in the constructor options.'
      );
    }

    const { query, headers: extraHeaders } = opts;

    // Build the URL up front so we can derive the signing path+query.
    // The signing path is exactly `url.pathname + url.search`, which
    // mirrors what the server reads from `req.originalUrl`.
    const url = this._buildUrl(path, query);
    const pathWithQuery = url.pathname + url.search;

    const { rawBody, contentType } = this._serializeBody(opts);
    const mergedHeaders = { ...(extraHeaders || {}) };
    if (contentType && !Object.keys(mergedHeaders).some((k) => k.toLowerCase() === 'content-type')) {
      mergedHeaders['Content-Type'] = contentType;
    }

    const headers = this._signedHeaders(upper, pathWithQuery, rawBody, mergedHeaders);

    const fetchOpts = { method: upper, headers };
    if (rawBody && upper !== 'GET' && upper !== 'HEAD') {
      fetchOpts.body = rawBody;
    }

    const response = await this._fetch(url.toString(), fetchOpts);

    // Parse the response body according to Content-Type
    let data = null;
    const headerStore = response.headers || new Headers();
    const contentTypeHeader = (headerStore.get && headerStore.get('content-type')) || '';
    if (contentTypeHeader.includes('application/json')) {
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }
    } else {
      try {
        data = await response.text();
      } catch (_) {
        data = null;
      }
    }

    // Convert Headers to a plain object so consumers get JSON-serializable output
    const plainHeaders = {};
    if (typeof headerStore.forEach === 'function') {
      headerStore.forEach((value, key) => { plainHeaders[key] = value; });
    }

    return {
      status: response.status,
      ok: !!response.ok,
      headers: plainHeaders,
      url: response.url || url.toString(),
      data,
    };
  }

  // Convenience helpers. Paths should always be versioned, e.g.
  // client.get('/api/v1/donations/recent') or client.post('/api/v1/wallets', {...}).
  get(path, opts)              { return this.request('GET',    path, opts); }
  delete(path, opts)           { return this.request('DELETE', path, opts); }
  post(path, body, opts)       { return this.request('POST',   path, { ...(opts || {}), body }); }
  put(path, body, opts)        { return this.request('PUT',    path, { ...(opts || {}), body }); }
  patch(path, body, opts)      { return this.request('PATCH',  path, { ...(opts || {}), body }); }
  head(path, opts)             { return this.request('HEAD',   path, opts); }
}

module.exports = SignedApiClient;
