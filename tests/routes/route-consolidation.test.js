'use strict';

/**
 * Admin route consolidation (#1778)
 *
 * Covers:
 *  - The duplicate modules are gone and each feature has one module
 *  - Deprecated paths are mounted and emit Deprecation / Sunset / Link headers
 *  - Deprecated aliases use the same auth guard as the canonical routes
 */

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const SRC = path.join(__dirname, '../../src');
const { deprecated, redirectDeprecated, DEPRECATION_SUNSET } = require('../../src/middleware/deprecation');

describe('one module per feature', () => {
  it.each([
    'routes/admin/walletDonationLimits.js',
    'routes/admin/xdr.js',
    'routes/admin/geoBlocking.js',
    'routes/admin/corporateMatching.js',
    'routes/v2/corporateMatching.js',
    'routes/admin/auditLogExport.js',
    'routes/admin/apiKeyUsage.js',
    'routes/admin/apiKeyAnalytics.js',
  ])('%s was removed', (file) => {
    expect(fs.existsSync(path.join(SRC, file))).toBe(false);
  });

  it('canonical modules expose the routers the bootstrap mounts', () => {
    expect(typeof require('../../src/routes/admin/geoRules').deprecatedRouter).toBe('function');
    expect(typeof require('../../src/routes/admin/inspect').deprecatedRouter).toBe('function');
    expect(typeof require('../../src/routes/corporateMatching').adminRouter).toBe('function');
    expect(typeof require('../../src/routes/corporateMatching').v2Router).toBe('function');
    expect(typeof require('../../src/routes/auditLogExport').adminRouter).toBe('function');
    expect(typeof require('../../src/routes/apiKeyUsage').adminRouter).toBe('function');
  });

  it('the route table never mounts the same router twice at the same path', () => {
    const { ADMIN_ROUTES } = require('../../src/bootstrap/routes');
    const duplicates = ADMIN_ROUTES.filter(([mount, router], i) =>
      ADMIN_ROUTES.findIndex(([m, r]) => m === mount && r === router) !== i);
    expect(duplicates.map(([mount]) => mount)).toEqual([]);
  });

  it('deprecated aliases are mounted for geo-blocking and decode-xdr', () => {
    const src = fs.readFileSync(path.join(SRC, 'bootstrap/routes.js'), 'utf8');
    expect(src).toMatch(/\['\/admin\/geo-blocking',\s+require\('\.\.\/routes\/admin\/geoRules'\)\.deprecatedRouter\]/);
    expect(src).toMatch(/\['\/admin\/transactions',\s+require\('\.\.\/routes\/admin\/inspect'\)\.deprecatedRouter\]/);
  });
});

describe('deprecation middleware', () => {
  function appWith(...handlers) {
    const app = express();
    app.get('/old/:id', ...handlers, (req, res) => res.json({ ok: true }));
    return app;
  }

  it('sets Deprecation, Sunset and Link and continues', async () => {
    const res = await request(appWith(deprecated((req) => `/new/${req.params.id}`))).get('/old/7');
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBe(DEPRECATION_SUNSET);
    expect(res.headers.link).toBe('</new/7>; rel="successor-version"');
  });

  it('redirectDeprecated answers 308 to the successor and keeps the query string', async () => {
    const res = await request(appWith(redirectDeprecated('/new'))).get('/old/1?x=2');
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe('/new?x=2');
    expect(res.headers.deprecation).toBe('true');
  });
});

describe('deprecated aliases keep the canonical guard', () => {
  it('geo-blocking aliases reject requests without an API key', async () => {
    const app = express();
    app.use(express.json());
    app.use('/admin/geo-blocking', require('../../src/routes/admin/geoRules').deprecatedRouter);
    const res = await request(app).get('/admin/geo-blocking/rules');
    expect([401, 403]).toContain(res.status);
  });

  it('decode-xdr alias rejects non-admin callers', async () => {
    const app = express();
    app.use(express.json());
    app.use('/admin/transactions', require('../../src/routes/admin/inspect').deprecatedRouter);
    app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({}));
    const res = await request(app).post('/admin/transactions/decode-xdr').send({ xdr: 'AAAA' });
    expect([401, 403]).toContain(res.status);
  });
});
