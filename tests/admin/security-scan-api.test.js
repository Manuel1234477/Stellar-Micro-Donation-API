'use strict';

/**
 * Tests for POST /admin/security/scan and GET /admin/security/scan/:jobId
 *
 * Covers:
 *  - Scan is triggered and returns a jobId immediately (202)
 *  - Results are retrievable via GET /:jobId
 *  - Concurrent scan prevention returns 409
 *  - 404 for unknown jobId
 *  - Admin-only access (403 for non-admin)
 *  - Findings structure and summary counts
 *  - Failed scan handling
 */

// ─── Mock the security-scan script before requiring the route ─────────────────
jest.mock('../../src/scripts/security-scan', () => ({
  runAllScans: jest.fn(),
}));

// ─── Mock RBAC so we can control auth in tests ────────────────────────────────
jest.mock('../../src/middleware/rbac', () => {
  const actual = jest.requireActual('../../src/middleware/rbac');
  return {
    ...actual,
    checkPermission: () => (req, res, next) => {
      // Honour the test-injected role
      if (req.headers['x-test-role'] === 'admin') return next();
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'Forbidden' },
      });
    },
    requireAdmin: () => (req, res, next) => {
      if (req.headers['x-test-role'] === 'admin') return next();
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'Forbidden' },
      });
    },
  };
});

const express = require('express');
const request = require('supertest');
const { runAllScans } = require('../../src/scripts/security-scan');
const securityScanRouter = require('../../src/routes/admin/securityScan');

// ─── Build a minimal Express app for testing ─────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mount at the same path as in production
  app.use('/admin/security/scan', securityScanRouter);
  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Admin auth header shorthand */
const adminHeaders = { 'x-test-role': 'admin' };

/** A resolved runAllScans result where everything passes */
const allPassResult = {
  allPassed: true,
  results: {
    npmAudit: { success: true, output: 'found 0 vulnerabilities' },
    sast: { success: true, output: '' },
    secrets: { success: true, output: '' },
  },
};

/** A resolved runAllScans result with failures */
const failResult = {
  allPassed: false,
  results: {
    npmAudit: { success: false, output: '2 high severity vulnerabilities found' },
    sast: { success: true, output: '' },
    secrets: { success: false, output: 'Secret detected in src/config.js' },
  },
};

/**
 * Trigger a scan and wait for it to complete by polling.
 * Returns the final GET response body.
 */
async function triggerAndWait(app, maxAttempts = 20) {
  const postRes = await request(app)
    .post('/admin/security/scan')
    .set(adminHeaders)
    .expect(202);

  const { jobId } = postRes.body.data;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 10));
    const getRes = await request(app)
      .get(`/admin/security/scan/${jobId}`)
      .set(adminHeaders);
    if (getRes.body.data && getRes.body.data.status !== 'running') {
      return getRes.body;
    }
  }
  throw new Error('Scan did not complete within the polling window');
}

// ─── Reset module state between tests ────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Clear the in-memory job store and reset the in-progress flag
  securityScanRouter._jobs.clear();
  securityScanRouter._setScanInProgress(false);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /admin/security/scan', () => {
  test('returns 202 with a jobId immediately', async () => {
    // Make runAllScans hang so we can inspect the immediate response
    runAllScans.mockReturnValue(new Promise(() => {}));

    const app = buildApp();
    const res = await request(app)
      .post('/admin/security/scan')
      .set(adminHeaders)
      .expect(202);

    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toMatch(/^scan-/);
  });

  test('returns 403 for non-admin callers', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/admin/security/scan')
      // no x-test-role header → treated as non-admin
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  test('returns 409 when a scan is already running', async () => {
    // Keep the first scan running indefinitely
    runAllScans.mockReturnValue(new Promise(() => {}));

    const app = buildApp();

    // First request — should succeed
    await request(app).post('/admin/security/scan').set(adminHeaders).expect(202);

    // Second request — should conflict
    const res = await request(app)
      .post('/admin/security/scan')
      .set(adminHeaders)
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SCAN_ALREADY_RUNNING');
  });

  test('allows a new scan after the previous one completes', async () => {
    runAllScans.mockResolvedValue(allPassResult);

    const app = buildApp();

    // First scan — wait for completion
    await triggerAndWait(app);

    // Second scan — should be allowed
    const res = await request(app)
      .post('/admin/security/scan')
      .set(adminHeaders)
      .expect(202);

    expect(res.body.data.jobId).toMatch(/^scan-/);
  });
});

describe('GET /admin/security/scan/:jobId', () => {
  test('returns 404 for an unknown jobId', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/admin/security/scan/scan-nonexistent-id')
      .set(adminHeaders)
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SCAN_JOB_NOT_FOUND');
  });

  test('returns 403 for non-admin callers', async () => {
    const app = buildApp();
    await request(app)
      .get('/admin/security/scan/scan-some-id')
      .expect(403);
  });

  test('returns running status while scan is in progress', async () => {
    // Keep the scan running indefinitely
    runAllScans.mockReturnValue(new Promise(() => {}));

    const app = buildApp();
    const postRes = await request(app).post('/admin/security/scan').set(adminHeaders).expect(202);
    const { jobId } = postRes.body.data;

    const getRes = await request(app)
      .get(`/admin/security/scan/${jobId}`)
      .set(adminHeaders)
      .expect(200);

    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data.status).toBe('running');
    expect(getRes.body.data.jobId).toBe(jobId);
  });

  test('returns completed status with empty findings when all scans pass', async () => {
    runAllScans.mockResolvedValue(allPassResult);

    const app = buildApp();
    const body = await triggerAndWait(app);

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('completed');
    expect(body.data.findings).toEqual([]);
    expect(body.data.summary).toEqual({ high: 0, medium: 0, low: 0 });
    expect(body.data.scannedAt).toBeTruthy();
    expect(body.data.startedAt).toBeTruthy();
  });

  test('returns completed status with findings when scans fail', async () => {
    runAllScans.mockResolvedValue(failResult);

    const app = buildApp();
    const body = await triggerAndWait(app);

    expect(body.data.status).toBe('completed');
    expect(body.data.findings.length).toBeGreaterThan(0);

    // Every finding must have the required shape
    body.data.findings.forEach((f) => {
      expect(f).toHaveProperty('severity');
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(f.severity);
      expect(f).toHaveProperty('file');
      expect(typeof f.line).toBe('number');
      expect(f).toHaveProperty('description');
    });

    // Summary counts must match findings
    const { summary, findings } = body.data;
    const expectedHigh = findings.filter((f) => f.severity === 'HIGH').length;
    const expectedMedium = findings.filter((f) => f.severity === 'MEDIUM').length;
    const expectedLow = findings.filter((f) => f.severity === 'LOW').length;
    expect(summary.high).toBe(expectedHigh);
    expect(summary.medium).toBe(expectedMedium);
    expect(summary.low).toBe(expectedLow);
  });

  test('returns failed status when runAllScans throws', async () => {
    runAllScans.mockRejectedValue(new Error('Unexpected scan crash'));

    const app = buildApp();
    const body = await triggerAndWait(app);

    expect(body.data.status).toBe('failed');
    expect(body.data.findings.length).toBeGreaterThan(0);
    expect(body.data.findings[0].severity).toBe('HIGH');
    expect(body.data.findings[0].description).toContain('Unexpected scan crash');
    expect(body.data.summary.high).toBeGreaterThan(0);
  });

  test('response includes all required fields', async () => {
    runAllScans.mockResolvedValue(allPassResult);

    const app = buildApp();
    const body = await triggerAndWait(app);

    const { data } = body;
    expect(data).toHaveProperty('jobId');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('findings');
    expect(data).toHaveProperty('summary');
    expect(data.summary).toHaveProperty('high');
    expect(data.summary).toHaveProperty('medium');
    expect(data.summary).toHaveProperty('low');
    expect(data).toHaveProperty('scannedAt');
    expect(data).toHaveProperty('startedAt');
  });
});

describe('Concurrent scan prevention (integration)', () => {
  test('second POST while first is running returns 409', async () => {
    let resolveFirst;
    runAllScans.mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const app = buildApp();

    const first = await request(app).post('/admin/security/scan').set(adminHeaders).expect(202);
    expect(first.body.data.jobId).toMatch(/^scan-/);

    const second = await request(app).post('/admin/security/scan').set(adminHeaders).expect(409);
    expect(second.body.error.code).toBe('SCAN_ALREADY_RUNNING');

    // Let the first scan finish
    resolveFirst(allPassResult);
  });

  test('only one job is stored while scan is running', async () => {
    runAllScans.mockReturnValue(new Promise(() => {}));

    const app = buildApp();
    await request(app).post('/admin/security/scan').set(adminHeaders).expect(202);
    // Attempt a second — should be rejected
    await request(app).post('/admin/security/scan').set(adminHeaders).expect(409);

    expect(securityScanRouter._jobs.size).toBe(1);
  });
});

describe('_buildFindings helper', () => {
  const { _buildFindings } = require('../../src/routes/admin/securityScan');

  test('returns empty findings and zero summary when all scans pass', () => {
    const { findings, summary } = _buildFindings(allPassResult);
    expect(findings).toEqual([]);
    expect(summary).toEqual({ high: 0, medium: 0, low: 0 });
  });

  test('classifies "high" keyword as HIGH severity', () => {
    const result = {
      allPassed: false,
      results: {
        npmAudit: { success: false, output: '3 high severity issues' },
        sast: { success: true, output: '' },
        secrets: { success: true, output: '' },
      },
    };
    const { findings } = _buildFindings(result);
    expect(findings.some((f) => f.severity === 'HIGH')).toBe(true);
  });

  test('classifies "moderate" keyword as MEDIUM severity', () => {
    const result = {
      allPassed: false,
      results: {
        npmAudit: { success: false, output: '1 moderate vulnerability' },
        sast: { success: true, output: '' },
        secrets: { success: true, output: '' },
      },
    };
    const { findings } = _buildFindings(result);
    expect(findings.some((f) => f.severity === 'MEDIUM')).toBe(true);
  });

  test('summary counts match findings array', () => {
    const { findings, summary } = _buildFindings(failResult);
    const high = findings.filter((f) => f.severity === 'HIGH').length;
    const medium = findings.filter((f) => f.severity === 'MEDIUM').length;
    const low = findings.filter((f) => f.severity === 'LOW').length;
    expect(summary).toEqual({ high, medium, low });
  });
});
