'use strict';
/**
 * Issue #1866 — POST /donations/batch must be registered once and must enforce
 * donations:create.
 *
 * - Only one POST /batch route may exist on the donations router (no shadowing).
 * - A read-only key must receive 403 instead of creating donations.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../src/middleware/apiKey', () => (req, res, next) => {
  const role = req.headers['x-test-role'];
  if (!role) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
  }
  req.apiKey = { id: `key-${role}`, role };
  req.user = { id: `key-${role}`, role };
  next();
});

jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  run: jest.fn(),
  query: jest.fn(),
}));

const donationsRouter = require('../../src/routes/donations/create');

function postBatchRoutes(router) {
  return router.stack.filter(
    (layer) => layer.route && layer.route.path === '/batch' && layer.route.methods.post
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/donations', donationsRouter);
  return app;
}

describe('Issue #1866: POST /donations/batch route registration and RBAC', () => {
  it('registers exactly one POST /batch route', () => {
    expect(postBatchRoutes(donationsRouter)).toHaveLength(1);
  });

  it('rejects a read-only (guest) key with 403 and creates nothing', async () => {
    const res = await request(buildApp())
      .post('/donations/batch')
      .set('x-test-role', 'guest')
      .send({ donations: [{ amount: '1', recipient: 'GABC' }] });

    expect(res.status).toBe(403);
  });

  it('accepts the batch request for a key with donations:create', async () => {
    const res = await request(buildApp())
      .post('/donations/batch')
      .set('x-test-role', 'user')
      .send({ donations: [] });

    // Empty array is rejected by per-item validation, not by RBAC.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
