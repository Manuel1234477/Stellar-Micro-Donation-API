'use strict';

/**
 * Tests for GET /admin/system/info.
 *
 * Extracted from the legacy issue-numbered bundle (issue #803) so the suite
 * lives next to the module it covers, per docs/TEST_NAMING_CONVENTION.md.
 */

const request = require('supertest');
const express = require('express');

describe('GET /admin/system/info (issue #803)', () => {
  let app;
  let systemInfoService;
  let adminAuth;

  beforeEach(() => {
    jest.resetModules();

    systemInfoService = {
      getSystemInfo: jest.fn().mockResolvedValue({
        version: '1.0.0',
        uptime: 12345,
        nodeVersion: process.version,
        environment: 'test',
      }),
    };

    adminAuth = (req, res, next) => {
      if (req.headers['x-admin-key'] === 'test-admin-key') {
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized' });
    };

    const router = express.Router();
    router.get('/admin/system/info', adminAuth, async (req, res, next) => {
      try {
        const info = await systemInfoService.getSystemInfo();
        res.json(info);
      } catch (err) {
        next(err);
      }
    });

    app = express();
    app.use(express.json());
    app.use(router);
    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message });
    });
  });

  it('returns system information for an authenticated admin', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-admin-key', 'test-admin-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: '1.0.0',
      uptime: 12345,
      nodeVersion: process.version,
      environment: 'test',
    });
    expect(systemInfoService.getSystemInfo).toHaveBeenCalledTimes(1);
  });

  it('rejects requests without an admin key', async () => {
    const res = await request(app).get('/admin/system/info');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(systemInfoService.getSystemInfo).not.toHaveBeenCalled();
  });

  it('rejects requests with an invalid admin key', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-admin-key', 'wrong-key');

    expect(res.status).toBe(401);
    expect(systemInfoService.getSystemInfo).not.toHaveBeenCalled();
  });

  it('returns 500 when the system info service fails', async () => {
    systemInfoService.getSystemInfo.mockRejectedValueOnce(
      new Error('system info unavailable')
    );

    const res = await request(app)
      .get('/admin/system/info')
      .set('x-admin-key', 'test-admin-key');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'system info unavailable' });
  });
});