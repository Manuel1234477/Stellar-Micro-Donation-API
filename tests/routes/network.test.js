'use strict';

/**
 * Tests for the /network route.
 *
 * Extracted from the legacy issue bundle `tests/issues-802-803.test.js`
 * (issue #802) as part of the test-naming convention cleanup (#1791/#1792).
 */

const request = require('supertest');
const express = require('express');

describe('/network route (issue #802)', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();

    app = express();
    app.use(express.json());

    const networkRouter = require('../../src/routes/network');
    app.use('/network', networkRouter);
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('GET /network', () => {
    it('responds with a 200 status', async () => {
      const res = await request(app).get('/network');

      expect(res.status).toBe(200);
    });

    it('returns a JSON payload', async () => {
      const res = await request(app).get('/network');

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toBeDefined();
      expect(typeof res.body).toBe('object');
    });

    it('reports the network identifier', async () => {
      const res = await request(app).get('/network');

      expect(res.body).toHaveProperty('network');
      expect(res.body.network).toBeDefined();
    });

    it('reports the network passphrase', async () => {
      const res = await request(app).get('/network');

      expect(res.body).toHaveProperty('passphrase');
      expect(typeof res.body.passphrase).toBe('string');
      expect(res.body.passphrase.length).toBeGreaterThan(0);
    });

    it('reports the network protocol version', async () => {
      const res = await request(app).get('/network');

      expect(res.body).toHaveProperty('protocolVersion');
      expect(typeof res.body.protocolVersion).toBe('number');
    });

    it('is idempotent across repeated requests', async () => {
      const first = await request(app).get('/network');
      const second = await request(app).get('/network');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
    });
  });

  describe('unsupported methods', () => {
    it('returns 404 for POST /network', async () => {
      const res = await request(app).post('/network').send({});

      expect(res.status).toBe(404);
    });

    it('returns 404 for DELETE /network', async () => {
      const res = await request(app).delete('/network');

      expect(res.status).toBe(404);
    });
  });
});