/**
 * Tests for NetworkStatusService and /network/status endpoints
 */

const NetworkStatusService = require('../src/services/NetworkStatusService');
const express = require('express');
const { router: networkRoutes, setService } = require('../src/routes/network');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(service) {
  setService(service);
  const app = express();
  app.use(express.json());
  app.use('/network', networkRoutes);
  return app;
}

/** Build a minimal fee_stats-like Horizon response */
function feeStatsResponse({ lastLedger = 1000, feeMode = '100' } = {}) {
  return JSON.stringify({
    last_ledger: String(lastLedger),
    fee_charged: { mode: feeMode },
    min_accepted_fee: feeMode,
  });
}

/** Stub _fetchHorizon to return controlled data */
function stubFetch(service, response) {
  service._fetchHorizon = jest.fn().mockResolvedValue(JSON.parse(response));
}

/** Stub _fetchHorizon to reject */
function stubFetchError(service, message = 'Network error') {
  service._fetchHorizon = jest.fn().mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// Unit: NetworkStatusService
// ---------------------------------------------------------------------------

describe('NetworkStatusService', () => {
  let svc;

  beforeEach(() => {
    svc = new NetworkStatusService({ horizonUrl: 'https://horizon-testnet.stellar.org', pollIntervalMs: 60_000 });
  });

  afterEach(() => svc.stop());

  // --- getStatus before any poll ---
  test('getStatus returns disconnected status before first poll', () => {
    const s = svc.getStatus();
    expect(s.connected).toBe(false);
    expect(s.error).toBe('No data yet');
  });

  // --- getHistory ---
  test('getHistory returns empty array initially', () => {
    expect(svc.getHistory()).toEqual([]);
  });

  // --- healthy poll ---
  test('records healthy status after successful poll', async () => {
    stubFetch(svc, feeStatsResponse({ lastLedger: 1000, feeMode: '100' }));
    await svc._poll();
    // second poll to get a ledger delta
    stubFetch(svc, feeStatsResponse({ lastLedger: 1005, feeMode: '100' }));
    await svc._poll();

    const s = svc.getStatus();
    expect(s.connected).toBe(true);
    expect(s.degraded).toBe(false);
    expect(s.feeLevel).toBe('normal');
    expect(s.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // --- degradation: fee surge ---
  test('detects fee surge degradation', async () => {
    stubFetch(svc, feeStatsResponse({ lastLedger: 1000, feeMode: '600' })); // 6x baseline
    await svc._poll();

    const s = svc.getStatus();
    expect(s.degraded).toBe(true);
    expect(s.feeLevel).toBe('surge');
    expect(s.feeSurgeMultiplier).toBeGreaterThan(5);
  });

  // --- degradation: ledger close time ---
  test('detects slow ledger close time degradation', async () => {
    // First poll sets baseline ledger
    stubFetch(svc, feeStatsResponse({ lastLedger: 1000 }));
    await svc._poll();

    // Simulate 15 seconds passing with only 1 new ledger → close time > 10s
    const now = Date.now();
    svc._lastLedgerTime = now - 15_000;
    svc._lastLedgerSeq = 1000;

    stubFetch(svc, feeStatsResponse({ lastLedger: 1001 }));
    await svc._poll();

    const s = svc.getStatus();
    expect(s.ledgerCloseTimeS).toBeGreaterThan(10);
    expect(s.degraded).toBe(true);
  });

  // --- degradation: error rate ---
  test('detects high error rate degradation', async () => {
    stubFetchError(svc);
    // 6 errors out of 6 polls = 100% error rate
    for (let i = 0; i < 6; i++) await svc._poll();

    const s = svc.getStatus();
    expect(s.errorRatePercent).toBeGreaterThan(5);
    expect(s.degraded).toBe(true);
  });

  // --- error poll ---
  test('records error status on Horizon failure', async () => {
    stubFetchError(svc, 'Connection refused');
    await svc._poll();

    const s = svc.getStatus();
    expect(s.connected).toBe(false);
    expect(s.error).toBe('Connection refused');
  });

  // --- webhook emission ---
  test('emits network.degraded event on first degradation', async () => {
    const handler = jest.fn();
    svc.on('network.degraded', handler);

    stubFetch(svc, feeStatsResponse({ feeMode: '600' })); // surge
    await svc._poll();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].degraded).toBe(true);
  });

  test('does not re-emit network.degraded while already degraded', async () => {
    const handler = jest.fn();
    svc.on('network.degraded', handler);

    stubFetch(svc, feeStatsResponse({ feeMode: '600' }));
    await svc._poll();
    await svc._poll();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('re-emits network.degraded after recovery then new degradation', async () => {
    const handler = jest.fn();
    svc.on('network.degraded', handler);

    // Degrade
    stubFetch(svc, feeStatsResponse({ feeMode: '600' }));
    await svc._poll();

    // Recover
    stubFetch(svc, feeStatsResponse({ feeMode: '100' }));
    await svc._poll();

    // Degrade again
    stubFetch(svc, feeStatsResponse({ feeMode: '600' }));
    await svc._poll();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  // --- history ---
  test('getHistory returns all snapshots within 24 hours', async () => {
    stubFetch(svc, feeStatsResponse());
    await svc._poll();
    await svc._poll();

    expect(svc.getHistory().length).toBe(2);
  });

  test('getHistory prunes snapshots older than 24 hours', async () => {
    stubFetch(svc, feeStatsResponse());
    await svc._poll();

    // Backdate the snapshot
    svc._history[0].timestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    expect(svc.getHistory().length).toBe(0);
  });

  // --- start / stop ---
  test('start begins polling and stop clears the timer', () => {
    jest.useFakeTimers();
    stubFetch(svc, feeStatsResponse());
    svc._poll = jest.fn();

    svc.start();
    expect(svc._timer).not.toBeNull();

    jest.advanceTimersByTime(60_000);
    expect(svc._poll).toHaveBeenCalled();

    svc.stop();
    expect(svc._timer).toBeNull();
    jest.useRealTimers();
  });

  test('calling start twice does not create duplicate timers', () => {
    jest.useFakeTimers();
    svc._poll = jest.fn();
    svc.start();
    const firstTimer = svc._timer;
    svc.start();
    expect(svc._timer).toBe(firstTimer);
    svc.stop();
    jest.useRealTimers();
  });

  // --- fee level labels ---
  test.each([
    ['100', 'normal'],
    ['250', 'elevated'],
    ['600', 'surge'],
  ])('fee %s stroops → feeLevel %s', async (feeMode, expectedLevel) => {
    stubFetch(svc, feeStatsResponse({ feeMode }));
    await svc._poll();
    expect(svc.getStatus().feeLevel).toBe(expectedLevel);
  });
});

// ---------------------------------------------------------------------------
// HTTP: /network/status and /network/status/history
// ---------------------------------------------------------------------------

describe('GET /network/status', () => {
  let svc, app, request;

  beforeAll(() => {
    request = require('supertest');
  });

  beforeEach(() => {
    svc = new NetworkStatusService({ pollIntervalMs: 60_000 });
    app = makeApp(svc);
  });

  afterEach(() => svc.stop());

  test('returns 200 with status object', async () => {
    const res = await request(app).get('/network/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('connected');
    expect(res.body).toHaveProperty('degraded');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('returns connected:true and degraded:false for healthy state', async () => {
    stubFetch(svc, feeStatsResponse({ lastLedger: 2000, feeMode: '100' }));
    await svc._poll();
    stubFetch(svc, feeStatsResponse({ lastLedger: 2005, feeMode: '100' }));
    await svc._poll();

    const res = await request(app).get('/network/status');
    expect(res.body.connected).toBe(true);
    expect(res.body.degraded).toBe(false);
    expect(res.body.feeLevel).toBe('normal');
  });

  test('returns degraded:true on fee surge', async () => {
    stubFetch(svc, feeStatsResponse({ feeMode: '600' }));
    await svc._poll();

    const res = await request(app).get('/network/status');
    expect(res.body.degraded).toBe(true);
  });

  test('returns latencyMs as a number', async () => {
    stubFetch(svc, feeStatsResponse());
    await svc._poll();

    const res = await request(app).get('/network/status');
    expect(typeof res.body.latencyMs).toBe('number');
  });
});

describe('GET /network/status/history', () => {
  let svc, app, request;

  beforeAll(() => {
    request = require('supertest');
  });

  beforeEach(() => {
    svc = new NetworkStatusService({ pollIntervalMs: 60_000 });
    app = makeApp(svc);
  });

  afterEach(() => svc.stop());

  test('returns 200 with history array', async () => {
    const res = await request(app).get('/network/status/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  test('history grows with each poll', async () => {
    stubFetch(svc, feeStatsResponse());
    await svc._poll();
    await svc._poll();

    const res = await request(app).get('/network/status/history');
    expect(res.body.history.length).toBe(2);
  });

  test('history entries contain required fields', async () => {
    stubFetch(svc, feeStatsResponse());
    await svc._poll();

    const res = await request(app).get('/network/status/history');
    const entry = res.body.history[0];
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('connected');
    expect(entry).toHaveProperty('degraded');
    expect(entry).toHaveProperty('feeLevel');
  });
});

// ---------------------------------------------------------------------------
// Unit: _fetchHorizon (real HTTP, using http module with a local server)
// ---------------------------------------------------------------------------

describe('NetworkStatusService._fetchHorizon', () => {
  const http = require('http');

  test('resolves with parsed JSON on HTTP 200', (done) => {
    const payload = feeStatsResponse({ lastLedger: 999, feeMode: '150' });
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
    });
    server.listen(0, async () => {
      const port = server.address().port;
      const svc2 = new NetworkStatusService({ horizonUrl: `http://localhost:${port}` });
      const data = await svc2._fetchHorizon();
      expect(data.last_ledger).toBe('999');
      server.close(done);
    });
  });

  test('rejects on non-200 HTTP status', (done) => {
    const server = http.createServer((req, res) => {
      res.writeHead(503);
      res.end('Service Unavailable');
    });
    server.listen(0, async () => {
      const port = server.address().port;
      const svc2 = new NetworkStatusService({ horizonUrl: `http://localhost:${port}` });
      await expect(svc2._fetchHorizon()).rejects.toThrow('Horizon returned HTTP 503');
      server.close(done);
    });
  });

  test('rejects on invalid JSON response', (done) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not-json');
    });
    server.listen(0, async () => {
      const port = server.address().port;
      const svc2 = new NetworkStatusService({ horizonUrl: `http://localhost:${port}` });
      await expect(svc2._fetchHorizon()).rejects.toThrow('Invalid JSON from Horizon');
      server.close(done);
    });
  });

  test('rejects on connection error', async () => {
    // Port 1 is reserved and will refuse connections
    const svc2 = new NetworkStatusService({ horizonUrl: 'http://localhost:1' });
    await expect(svc2._fetchHorizon()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Route: 503 when service not set
// ---------------------------------------------------------------------------

describe('GET /network/status without service', () => {
  test('returns 503 when service not initialised', async () => {
    const request = require('supertest');
    // Temporarily remove the service
    setService(null);
    const app2 = express();
    app2.use('/network', networkRoutes);

    const res = await request(app2).get('/network/status');
    expect(res.status).toBe(503);

    // Restore for other tests
    setService(null);
  });

  test('history returns 503 when service not initialised', async () => {
    const request = require('supertest');
    setService(null);
    const app2 = express();
    app2.use('/network', networkRoutes);

    const res = await request(app2).get('/network/status/history');
    expect(res.status).toBe(503);
  });
});
