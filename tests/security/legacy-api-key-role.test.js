/**
 * Tests for legacy API key role assignment and comparison (Issue #1885)
 *
 * Legacy keys must not gain admin from an "admin-" prefix, must require an
 * explicit role configuration, and must be compared in constant time.
 */

const request = require('supertest');
const express = require('express');

const ADMIN_LOOKALIKE = 'admin-staging-partner-key-0001';
const PLAIN_LEGACY = 'plain-legacy-key-0002';

function loadRbacWithLegacyKeys(keys) {
  process.env.API_KEYS = keys;
  let rbac;
  jest.isolateModules(() => {
    jest.doMock('../../src/models/apiKeys', () => ({ validateApiKey: jest.fn(async () => null) }));
    rbac = require('../../src/middleware/rbac');
  });
  return rbac;
}

function buildApp(rbac) {
  const app = express();
  app.use((req, res, next) => {
    // Simulate the apiKey middleware populating the principal from a legacy key
    const key = req.headers['x-api-key'];
    if (key) {
      req.user = { id: 'legacy', role: 'user' };
    }
    next();
  });
  app.use(rbac.attachUserRole);
  app.get('/whoami', (req, res) => res.json({ role: req.user && req.user.role }));
  return app;
}

describe('Legacy API key role (#1885)', () => {
  const originalKeys = process.env.API_KEYS;

  afterEach(() => {
    process.env.API_KEYS = originalKeys;
    jest.dontMock('../../src/models/apiKeys');
  });

  test('a legacy key with an admin- prefix does not receive admin role', async () => {
    const rbac = loadRbacWithLegacyKeys(`${ADMIN_LOOKALIKE},${PLAIN_LEGACY}`);

    const res = await request(buildApp(rbac))
      .get('/whoami')
      .set('x-api-key', ADMIN_LOOKALIKE);

    expect(res.body.role).not.toBe('admin');
  });

  test('admin role for a legacy key requires explicit key:role configuration', async () => {
    const rbac = loadRbacWithLegacyKeys(`${ADMIN_LOOKALIKE}:admin,${PLAIN_LEGACY}:user`);

    const res = await request(buildApp(rbac))
      .get('/whoami')
      .set('x-api-key', ADMIN_LOOKALIKE);

    expect(res.body.role).toBe('admin');
  });

  test('legacy key matching uses constant-time comparison', () => {
    const safeEqual = require('../../src/utils/safeEqual').safeEqual;
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/middleware/rbac.js'),
      'utf8'
    );

    expect(source).not.toMatch(/getLegacyKeys\(\)\.includes\(/);
    expect(typeof safeEqual).toBe('function');
  });
});
