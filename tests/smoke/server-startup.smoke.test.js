'use strict';

/**
 * Smoke Test Suite — Server Startup & HTTP Health Endpoints (#706)
 *
 * Starts the real server process and verifies it responds to HTTP requests.
 * Catches critical startup bugs (middleware hangs, port binding issues) that
 * unit/integration tests with mocked HTTP layers cannot detect.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const SMOKE_PORT = process.env.SMOKE_PORT || 3099;
const BASE_URL = `http://localhost:${SMOKE_PORT}`;
const STARTUP_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 200;

let serverProcess = null;

/**
 * Wait for the server to respond to GET /health/live, up to STARTUP_TIMEOUT_MS.
 * Rejects with a clear message if the server never becomes reachable.
 */
function waitForServer(timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function poll() {
      if (Date.now() > deadline) {
        return reject(
          new Error(
            `Server did not become reachable within ${timeoutMs}ms. ` +
            'Check that the server starts correctly and that no other process is using the port.'
          )
        );
      }

      const req = http.get(`${BASE_URL}/health/live`, (res) => {
        if (res.statusCode === 200) return resolve();
        // Non-200 means server is up but not yet healthy — keep polling
        setTimeout(poll, POLL_INTERVAL_MS);
      });

      req.on('error', () => setTimeout(poll, POLL_INTERVAL_MS));
      req.setTimeout(500, () => { req.destroy(); setTimeout(poll, POLL_INTERVAL_MS); });
    }

    poll();
  });
}

/**
 * Simple HTTP GET helper — returns { status, body } without any test framework deps.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch (_) { body = raw; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

beforeAll(async () => {
  serverProcess = spawn(
    process.execPath, // node binary
    [path.join(__dirname, '../../src/routes/app.js')],
    {
      env: {
        ...process.env,
        PORT: String(SMOKE_PORT),
        NODE_ENV: 'test',
        MOCK_STELLAR: 'true',
        API_KEYS: 'smoke-test-key',
        ENCRYPTION_KEY: 'test_encryption_key_fixed_32bytes_hex_value_here_00',
      },
      stdio: 'pipe',
    }
  );

  // Surface server stderr in test output only on failure
  const stderrChunks = [];
  serverProcess.stderr.on('data', (d) => stderrChunks.push(d));
  serverProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      // Print captured stderr so CI logs show the root cause
      process.stderr.write(Buffer.concat(stderrChunks));
    }
  });

  await waitForServer(STARTUP_TIMEOUT_MS);
}, STARTUP_TIMEOUT_MS + 2000);

afterAll(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test('GET /health/live returns 200 within 5 seconds of startup', async () => {
  const { status, body } = await httpGet(`${BASE_URL}/health/live`);
  expect(status).toBe(200);
  expect(body).toBeDefined();
}, 5000);

test('GET /health returns a valid JSON health object', async () => {
  const { status, body } = await httpGet(`${BASE_URL}/health`);
  // Accept 200 (healthy) or 503 (unhealthy but responding) — both prove the server is up
  expect([200, 503]).toContain(status);
  expect(typeof body).toBe('object');
  expect(body).toHaveProperty('status');
}, 10000);

test('GET /health/ready returns a readiness status', async () => {
  const { status, body } = await httpGet(`${BASE_URL}/health/ready`);
  expect([200, 503]).toContain(status);
  expect(typeof body).toBe('object');
  expect(body).toHaveProperty('ready');
}, 10000);
