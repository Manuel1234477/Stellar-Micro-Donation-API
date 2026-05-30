'use strict';

jest.mock('maxmind', () => ({
  open: jest.fn(),
}), { virtual: true });

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const maxmind = require('maxmind');
const Database = require('../src/utils/database');
const config = require('../src/config');
const AuditLogService = require('../src/services/AuditLogService');
const GeoRuleService = require('../src/services/GeoRuleService');
const geoAdminRouter = require('../src/routes/admin/geoBlocking');
const { errorHandler } = require('../src/middleware/errorHandler');
const log = require('../src/utils/log');
const { GeoBlockMiddleware } = require('../src/middleware/geoBlock');

describe('extended geo blocking', () => {
  const originalGeoConfig = {
    blockedCountries: [...config.geoBlocking.blockedCountries],
    allowedCountries: [...config.geoBlocking.allowedCountries],
    allowedIPs: [...config.geoBlocking.allowedIPs],
    maxmindDbPath: config.geoBlocking.maxmindDbPath,
  };

  const countryByIp = new Map();
  let existsSyncSpy;
  let middleware;
  let app;

  function buildApp(currentMiddleware) {
    const testApp = express();

    testApp.set('trust proxy', true);
    testApp.use(express.json());
    testApp.use((req, res, next) => {
      req.apiKey = { role: 'admin', isLegacy: true };
      req.user = { id: 'admin-1', role: 'admin' };
      next();
    });
    testApp.use((req, res, next) => currentMiddleware.middleware(req, res, next));
    testApp.use('/admin/geo', geoAdminRouter);
    testApp.use('/admin/geo-blocking', geoAdminRouter);
    testApp.get('/protected', (req, res) => {
      res.json({ success: true, data: { ok: true } });
    });
    testApp.use(errorHandler);

    return testApp;
  }

  beforeAll(async () => {
    existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(log, 'info').mockImplementation(() => {});
    jest.spyOn(log, 'warn').mockImplementation(() => {});
    jest.spyOn(log, 'error').mockImplementation(() => {});

    await Database.initialize();
    await GeoRuleService.ensureTable();
    await Database.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        severity TEXT NOT NULL,
        result TEXT NOT NULL,
        userId TEXT,
        requestId TEXT,
        ipAddress TEXT,
        resource TEXT,
        reason TEXT,
        details TEXT,
        integrityHash TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    existsSyncSpy.mockReturnValue(true);
    countryByIp.clear();

    config.geoBlocking.blockedCountries = [];
    config.geoBlocking.allowedCountries = [];
    config.geoBlocking.allowedIPs = [];
    config.geoBlocking.maxmindDbPath = originalGeoConfig.maxmindDbPath;

    await Database.run('DELETE FROM geo_rules');
    await Database.run('DELETE FROM audit_logs');
    GeoRuleService.invalidateCache();

    maxmind.open.mockResolvedValue({
      get: jest.fn((ip) => {
        const countryCode = countryByIp.get(ip);
        return countryCode ? { country: { iso_code: countryCode } } : null;
      }),
    });

    middleware = new GeoBlockMiddleware();
    await middleware.initialize(true);
    app = buildApp(middleware);
  });

  afterAll(async () => {
    config.geoBlocking.blockedCountries = originalGeoConfig.blockedCountries;
    config.geoBlocking.allowedCountries = originalGeoConfig.allowedCountries;
    config.geoBlocking.allowedIPs = originalGeoConfig.allowedIPs;
    config.geoBlocking.maxmindDbPath = originalGeoConfig.maxmindDbPath;

    GeoRuleService.invalidateCache();
    existsSyncSpy.mockRestore();
    log.info.mockRestore();
    log.warn.mockRestore();
    log.error.mockRestore();
    await Database.close();
  });

  it('adds a runtime block rule and blocks matching requests with the geo header', async () => {
    const createResponse = await request(app)
      .post('/admin/geo/block')
      .send({ countryCode: 'ru' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.countryCode).toBe('RU');
    expect(createResponse.body.data.ruleType).toBe('block');

    countryByIp.set('203.0.113.10', 'RU');

    const blockedResponse = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '203.0.113.10');

    expect(blockedResponse.status).toBe(403);
    expect(blockedResponse.headers['x-blocked-reason']).toBe('geo');
    expect(blockedResponse.body.error.code).toBe('GEO_BLOCKED');

    const storedRule = await Database.get(
      'SELECT countryCode, ruleType, createdBy FROM geo_rules WHERE countryCode = ? AND ruleType = ?',
      ['RU', 'block']
    );

    expect(storedRule).toEqual({
      countryCode: 'RU',
      ruleType: 'block',
      createdBy: 'admin-1',
    });
  });

  it('lets allow rules override block rules for the same country', async () => {
    await request(app)
      .post('/admin/geo/block')
      .send({ countryCode: 'CA' })
      .expect(201);

    await request(app)
      .post('/admin/geo/allow')
      .send({ countryCode: 'CA' })
      .expect(201);

    countryByIp.set('198.51.100.20', 'CA');

    const response = await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '198.51.100.20');

    expect(response.status).toBe(200);
    expect(response.body.data.ok).toBe(true);

    const auditEntries = await AuditLogService.query({ action: 'GEO_REQUEST_BLOCKED' });
    expect(auditEntries).toHaveLength(0);
  });

  it('lists active rules from config and database through GET /admin/geo/rules', async () => {
    config.geoBlocking.blockedCountries = ['IR'];
    config.geoBlocking.allowedCountries = ['US'];
    config.geoBlocking.allowedIPs = ['10.0.0.0/8'];

    await request(app)
      .post('/admin/geo/block')
      .send({ countryCode: 'RU' })
      .expect(201);

    await request(app)
      .post('/admin/geo/allow')
      .send({ countryCode: 'NG' })
      .expect(201);

    const response = await request(app).get('/admin/geo/rules');

    expect(response.status).toBe(200);
    expect(response.body.data.config.blockCountries).toEqual(['IR']);
    expect(response.body.data.config.allowCountries).toEqual(['US']);
    expect(response.body.data.database.blockCountries).toEqual(['RU']);
    expect(response.body.data.database.allowCountries).toEqual(['NG']);
    expect(response.body.data.effective.blockCountries).toEqual(expect.arrayContaining(['IR', 'RU']));
    expect(response.body.data.effective.allowCountries).toEqual(expect.arrayContaining(['US', 'NG']));
    expect(response.body.data.cache.ttlMs).toBe(60000);
  });

  it('keeps geo rules cached for 60 seconds and invalidates the cache on admin mutations', async () => {
    await GeoRuleService.addRule('block', 'RU', 'seed-admin');

    const firstLoad = await GeoRuleService.loadRules();
    expect(firstLoad.map((rule) => rule.countryCode)).toEqual(['RU']);

    await Database.run(
      'INSERT INTO geo_rules (countryCode, ruleType, createdBy) VALUES (?, ?, ?)',
      ['GB', 'block', 'direct-insert']
    );

    const cachedLoad = await GeoRuleService.loadRules();
    expect(cachedLoad.map((rule) => rule.countryCode)).toEqual(['RU']);
    expect(GeoRuleService._cache.expiresAt).toBeGreaterThan(Date.now());
    expect(GeoRuleService._cache.expiresAt - Date.now()).toBeLessThanOrEqual(60000);

    await request(app)
      .post('/admin/geo/block')
      .send({ countryCode: 'US' })
      .expect(201);

    const refreshedLoad = await GeoRuleService.loadRules();
    expect(refreshedLoad.map((rule) => rule.countryCode)).toEqual(expect.arrayContaining(['RU', 'GB', 'US']));
  });

  it('writes an audit log entry for every blocked request with country, ip, and matched rule', async () => {
    await request(app)
      .post('/admin/geo/block')
      .send({ countryCode: 'BR' })
      .expect(201);

    countryByIp.set('198.51.100.8', 'BR');

    await request(app)
      .get('/protected')
      .set('X-Forwarded-For', '198.51.100.8')
      .expect(403);

    const auditEntries = await AuditLogService.query({ action: 'GEO_REQUEST_BLOCKED' });

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].ipAddress).toBe('198.51.100.8');
    expect(auditEntries[0].details.detectedCountry).toBe('BR');
    expect(auditEntries[0].details.matchedRule).toEqual({
      type: 'block',
      countryCode: 'BR',
      source: 'database',
    });
  });

  it('removes runtime rules through the delete endpoints', async () => {
    await request(app)
      .post('/admin/geo/block')
      .send({ countryCode: 'DE' })
      .expect(201);

    const deleteResponse = await request(app).delete('/admin/geo/block/DE');

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.data.removed).toBe(true);

    const storedRule = await Database.get(
      'SELECT id FROM geo_rules WHERE countryCode = ? AND ruleType = ?',
      ['DE', 'block']
    );

    expect(storedRule).toBeUndefined();
  });

  it('keeps the legacy /admin/geo-blocking endpoints working', async () => {
    const updateResponse = await request(app)
      .put('/admin/geo-blocking')
      .send({
        blockedCountries: ['KP'],
        allowedCountries: ['GH'],
        allowedIPs: ['192.168.1.0/24'],
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.blockedCountries).toEqual(['KP']);
    expect(updateResponse.body.data.allowedCountries).toEqual(['GH']);
    expect(updateResponse.body.data.allowedIPs).toEqual(['192.168.1.0/24']);

    const getResponse = await request(app).get('/admin/geo-blocking');
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.blockedCountries).toEqual(expect.arrayContaining(['KP']));

    const reloadResponse = await request(app).post('/admin/geo-blocking/reload-db');
    expect(reloadResponse.status).toBe(200);
    expect(reloadResponse.body.data.message).toContain('reloaded successfully');
  });
});
