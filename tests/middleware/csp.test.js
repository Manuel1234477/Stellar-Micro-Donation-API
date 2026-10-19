/**
 * Tests for Content Security Policy (CSP) middleware.
 *
 * Extracted from tests/issues/issues-918-919-920-921.test.js.
 * Issue references: #918, #919, #920, #921.
 */

const request = require('supertest');
const express = require('express');

describe('CSP middleware (#918-#921)', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    app = express();
  });

  describe('CSP header presence (#918)', () => {
    test('sets a Content-Security-Policy header on responses', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    test('does not break normal responses', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/test');

      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('CSP directives (#919)', () => {
    test('includes default-src directive', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.send('ok'));

      const res = await request(app).get('/test');
      const policy = res.headers['content-security-policy'];

      expect(policy).toContain('default-src');
    });

    test('includes script-src directive', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.send('ok'));

      const res = await request(app).get('/test');
      const policy = res.headers['content-security-policy'];

      expect(policy).toContain('script-src');
    });

    test('includes style-src directive', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.send('ok'));

      const res = await request(app).get('/test');
      const policy = res.headers['content-security-policy'];

      expect(policy).toContain('style-src');
    });
  });

  describe('CSP restrictions (#920)', () => {
    test('restricts object-src', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.send('ok'));

      const res = await request(app).get('/test');
      const policy = res.headers['content-security-policy'];

      expect(policy).toContain('object-src');
    });

    test('restricts frame-ancestors', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/test', (req, res) => res.send('ok'));

      const res = await request(app).get('/test');
      const policy = res.headers['content-security-policy'];

      expect(policy).toContain('frame-ancestors');
    });
  });

  describe('CSP configuration (#921)', () => {
    test('applies CSP to all routes', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/a', (req, res) => res.send('a'));
      app.get('/b', (req, res) => res.send('b'));

      const resA = await request(app).get('/a');
      const resB = await request(app).get('/b');

      expect(resA.headers['content-security-policy']).toBeDefined();
      expect(resB.headers['content-security-policy']).toBeDefined();
    });

    test('applies CSP to error responses', async () => {
      const cspMiddleware = require('../../src/middleware/csp');
      app.use(cspMiddleware);
      app.get('/error', (req, res) => res.status(500).send('error'));

      const res = await request(app).get('/error');

      expect(res.status).toBe(500);
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });
});