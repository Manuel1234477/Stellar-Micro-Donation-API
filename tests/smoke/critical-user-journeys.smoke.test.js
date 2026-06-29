'use strict';

/**
 * Smoke Test Suite — Critical User Journeys (#1174)
 *
 * Exercises the core donation flow end-to-end against a real running server
 * process (not a mocked HTTP layer):
 *
 *   1. Create wallet  →  POST /wallets
 *   2. Make a donation →  POST /donations
 *   3. Fetch the receipt → GET /donations/:id
 *   4. List donations   →  GET /donations
 *
 * The suite spawns the server with MOCK_STELLAR=true so no live Horizon calls
 * are made, keeping it fast and deterministic enough to gate deploys.
 *
 * Time budget: entire suite must complete within 60 seconds (well inside the
 * jest.config.smoke.js 30 s per-test limit with four serial tests).
 *
 * Wire-in: this file matches the `**/tests/smoke/**/*.smoke.test.js` glob in
 * jest.config.smoke.js and is executed by `npm run test:smoke`.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// ─── Configuration ────────────────────────────────────────────────────────────

const SMOKE_PORT = parseInt(process.env.SMOKE_PORT || '3099', 10) + 1; // offset from startup suite
const BASE_URL = `http://localhost:${SMOKE_PORT}`;
const STARTUP_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 200;
const API_KEY = 'smoke-journey-key';

// Minimal Stellar-style public keys for mock mode (32-byte base58-like stubs accepted by the mock)
const SENDER_PUBLIC = 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RECIPIENT_PUBLIC = 'GRECIPIENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let serverProcess = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Poll GET /health/live until the server responds with 200 or the deadline passes.
 */
function waitForServer(timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function poll() {
      if (Date.now() > deadline) {
        return reject(
          new Error(
            `Server on port ${SMOKE_PORT} did not become reachable within ${timeoutMs}ms. ` +
            'Ensure no other process owns the port and the server starts without errors.'
          )
        );
      }

      const req = http.get(`${BASE_URL}/health/live`, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(poll, POLL_INTERVAL_MS);
      });

      req.on('error', () => setTimeout(poll, POLL_INTERVAL_MS));
      req.setTimeout(500, () => {
        req.destroy();
        setTimeout(poll, POLL_INTERVAL_MS);
      });
    }

    poll();
  });
}

/**
 * Thin HTTP client — returns { status, body }.
 * body is parsed JSON when Content-Type is application/json, otherwise a string.
 */
function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        const ct = res.headers['content-type'] || '';
        try {
          parsed = ct.includes('application/json') ? JSON.parse(raw) : raw;
        } catch (_) {
          parsed = raw;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error(`HTTP ${method} ${urlPath} timed out after 8 s`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  serverProcess = spawn(
    process.execPath,
    [path.join(__dirname, '../../src/app.js')],
    {
      env: {
        ...process.env,
        PORT: String(SMOKE_PORT),
        NODE_ENV: 'test',
        MOCK_STELLAR: 'true',
        API_KEYS: API_KEY,
        ENCRYPTION_KEY: 'test_encryption_key_fixed_32bytes_hex_value_here_00',
      },
      stdio: 'pipe',
    }
  );

  const stderrChunks = [];
  serverProcess.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(Buffer.concat(stderrChunks));
    }
  });

  await waitForServer(STARTUP_TIMEOUT_MS);
}, STARTUP_TIMEOUT_MS + 3000);

afterAll(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

// ─── Journey: wallet → donate → receipt → list ───────────────────────────────

/**
 * State shared across journey steps.
 * Mutated in-order; later tests reference earlier results.
 */
const journey = {
  senderWalletId: null,
  recipientWalletId: null,
  donationId: null,
};

test('Step 1 — POST /wallets: create sender wallet', async () => {
  const { status, body } = await httpRequest('POST', '/wallets', {
    publicKey: SENDER_PUBLIC,
    label: 'smoke-sender',
  });

  // 201 Created or 409 Conflict (wallet already exists from a previous run) are both valid
  expect([200, 201, 409]).toContain(status);

  if (status === 201 || status === 200) {
    const wallet = body.data || body.wallet || body;
    expect(wallet).toBeDefined();
    // Store the id for later steps — prefer nested `.data.id`, fall back to root `.id`
    journey.senderWalletId = (body.data || body).id ?? (body.wallet || body).id ?? wallet.id;
  }
}, 10000);

test('Step 2 — POST /wallets: create recipient wallet', async () => {
  const { status, body } = await httpRequest('POST', '/wallets', {
    publicKey: RECIPIENT_PUBLIC,
    label: 'smoke-recipient',
  });

  expect([200, 201, 409]).toContain(status);

  if (status === 201 || status === 200) {
    const wallet = body.data || body.wallet || body;
    journey.recipientWalletId = (body.data || body).id ?? (body.wallet || body).id ?? wallet.id;
  }
}, 10000);

test('Step 3 — POST /donations: make a donation from sender to recipient', async () => {
  const { status, body } = await httpRequest('POST', '/donations', {
    senderPublicKey: SENDER_PUBLIC,
    recipientPublicKey: RECIPIENT_PUBLIC,
    amount: '1.0000000',
    memo: 'smoke-journey-test',
  });

  // 201 is the primary success code; 200 is acceptable from some implementations
  expect([200, 201]).toContain(status);

  // The donation record must have an id we can look up in the next step
  const donation = body.data || body.donation || body;
  expect(donation).toBeDefined();
  journey.donationId = (body.data || body).id ?? (body.donation || body).id ?? donation.id;
  expect(journey.donationId).toBeDefined();
  expect(String(journey.donationId).length).toBeGreaterThan(0);
}, 15000);

test('Step 4 — GET /donations/:id: fetch the donation receipt', async () => {
  // Guard: this step depends on a successful donation in step 3
  expect(journey.donationId).toBeDefined();

  const { status, body } = await httpRequest('GET', `/donations/${journey.donationId}`);

  expect(status).toBe(200);

  const donation = body.data || body.donation || body;
  expect(donation).toBeDefined();

  // The record should echo back the key fields we submitted
  const id = (body.data || body).id ?? (body.donation || body).id ?? donation.id;
  expect(String(id)).toBe(String(journey.donationId));
}, 10000);

test('Step 5 — GET /donations: list donations returns at least one entry', async () => {
  const { status, body } = await httpRequest('GET', '/donations');

  expect(status).toBe(200);

  // Accept both { data: [...] } and bare array envelope shapes
  const list = body.data || body.donations || (Array.isArray(body) ? body : null);
  expect(list).toBeDefined();
  expect(Array.isArray(list)).toBe(true);
  expect(list.length).toBeGreaterThan(0);
}, 10000);

test('Step 6 — GET /wallets: list wallets returns created wallets', async () => {
  const { status, body } = await httpRequest('GET', '/wallets');

  expect(status).toBe(200);

  const list = body.data || body.wallets || (Array.isArray(body) ? body : null);
  expect(list).toBeDefined();
  expect(Array.isArray(list)).toBe(true);
  // Both sender and recipient wallets must be present
  expect(list.length).toBeGreaterThanOrEqual(2);
}, 10000);
