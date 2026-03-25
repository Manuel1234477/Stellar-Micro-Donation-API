/**
 * Client SDK Example: Request Signing
 *
 * Demonstrates how to sign API requests using HMAC-SHA256 before sending them
 * to the Stellar Micro-Donation API.
 *
 * Prerequisites:
 *   - An API key created with signing_required: true
 *   - The key's `keySecret` (returned once at creation time)
 *
 * Usage:
 *   const client = new SignedApiClient({
 *     baseUrl: 'http://localhost:3000',
 *     apiKey: '<your-api-key>',
 *     apiSecret: '<your-key-secret>',
 *   });
 *
 *   const res = await client.post('/donations', { amount: '10', donor: '...', recipient: '...' });
 */

const crypto = require('crypto');

class SignedApiClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl   - API base URL (e.g. 'http://localhost:3000')
   * @param {string} options.apiKey    - The raw API key value (sent in x-api-key header)
   * @param {string} options.apiSecret - The key secret used for HMAC signing
   */
  constructor({ baseUrl, apiKey, apiSecret }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * Build the canonical string and compute the HMAC-SHA256 signature.
   *
   * @param {string} method    - HTTP method (uppercase)
   * @param {string} path      - Path + query string (e.g. '/donations?limit=5')
   * @param {string} timestamp - Unix timestamp in seconds as a string
   * @param {string} body      - Raw JSON body string ('' for GET/DELETE)
   * @returns {string} Hex-encoded signature
   */
  _sign(method, path, timestamp, body) {
    const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
    const canonical = [method.toUpperCase(), path, timestamp, bodyHash].join('\n');
    return crypto.createHmac('sha256', this.apiSecret).update(canonical).digest('hex');
  }

  /**
   * Send a signed HTTP request.
   *
   * @param {string} method  - HTTP method
   * @param {string} path    - Path (e.g. '/donations')
   * @param {object} [body]  - Request body (will be JSON-serialised)
   * @param {object} [query] - Query parameters
   * @returns {Promise<object>} Parsed JSON response
   */
  async request(method, path, body, query) {
    const qs = query && Object.keys(query).length
      ? '?' + new URLSearchParams(query).toString()
      : '';
    const fullPath = path + qs;
    const rawBody = body ? JSON.stringify(body) : '';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this._sign(method, fullPath, timestamp, rawBody);

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'x-timestamp': timestamp,
      'x-signature': signature,
    };

    const url = this.baseUrl + fullPath;

    // Works in Node 18+ (native fetch) or install node-fetch
    const response = await fetch(url, {
      method,
      headers,
      body: rawBody || undefined,
    });

    return response.json();
  }

  get(path, query)       { return this.request('GET',    path, null, query); }
  post(path, body)       { return this.request('POST',   path, body); }
  patch(path, body)      { return this.request('PATCH',  path, body); }
  delete(path)           { return this.request('DELETE', path); }
}

// ---------------------------------------------------------------------------
// Example usage (run with: node examples/signedClient.js)
// ---------------------------------------------------------------------------
async function main() {
  const client = new SignedApiClient({
    baseUrl: 'http://localhost:3000',
    apiKey: process.env.API_KEY || 'your-api-key-here',
    apiSecret: process.env.API_SECRET || 'your-key-secret-here',
  });

  // Create a donation (POST with body)
  const result = await client.post('/donations', {
    donor: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
    recipient: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJKR3BSQNEWVDGE',
    amount: '10',
    memo: 'Test donation',
  });

  console.log('Donation result:', JSON.stringify(result, null, 2));

  // List donations (GET, no body)
  const list = await client.get('/donations', { limit: '5' });
  console.log('Donations:', JSON.stringify(list, null, 2));
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = SignedApiClient;
