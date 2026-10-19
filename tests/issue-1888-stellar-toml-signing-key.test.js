'use strict';

/**
 * Tests for issue #1888: /.well-known/stellar.toml must advertise the SEP-10 signing key,
 * not the funded service key, and must not fail per request on bad configuration.
 *
 * Acceptance criteria:
 * - The TOML contains WEB_AUTH_ENDPOINT, SIGNING_KEY, NETWORK_PASSPHRASE and FEDERATION_SERVER.
 * - An invalid signing key does not produce a 500 (startup checks reject it).
 * - The signing key advertised is distinct from the funded account when SEP10_SIGNING_KEY is set.
 */

const express = require('express');
const request = require('supertest');
const StellarSdk = require('stellar-sdk');
const { router, renderStellarToml } = require('../src/routes/federation');
const { resolveSep10SigningSecret } = require('../src/utils/sep10SigningKey');

const ENV_KEYS = [
  'SEP10_SIGNING_KEY',
  'SERVICE_SECRET_KEY',
  'STELLAR_SECRET',
  'SERVICE_SIGNING_KEY',
  'API_BASE_URL',
  'FEDERATION_DOMAIN',
];

describe('Issue #1888 – stellar.toml SEP-10 signing key', () => {
  const saved = {};
  let app;

  beforeAll(() => {
    app = express();
    app.use(router);
  });

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe('resolveSep10SigningSecret', () => {
    it('prefers the dedicated SEP10_SIGNING_KEY', () => {
      const dedicated = StellarSdk.Keypair.random().secret();
      process.env.SEP10_SIGNING_KEY = dedicated;
      process.env.SERVICE_SECRET_KEY = StellarSdk.Keypair.random().secret();

      expect(resolveSep10SigningSecret()).toEqual({ secret: dedicated, dedicated: true });
    });

    it('falls back to the legacy service key when no dedicated key is set', () => {
      const legacy = StellarSdk.Keypair.random().secret();
      process.env.SERVICE_SECRET_KEY = legacy;

      expect(resolveSep10SigningSecret()).toEqual({ secret: legacy, dedicated: false });
    });

    it('ignores SERVICE_SIGNING_KEY, which the challenge signer never uses', () => {
      process.env.SERVICE_SIGNING_KEY = StellarSdk.Keypair.random().secret();

      expect(resolveSep10SigningSecret().secret).toBe('');
    });
  });

  describe('GET /.well-known/stellar.toml', () => {
    it('contains the SEP-1/SEP-10 fields the service supports', async () => {
      const res = await request(app).get('/.well-known/stellar.toml');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/^NETWORK_PASSPHRASE="/m);
      expect(res.text).toMatch(/^FEDERATION_SERVER="/m);
      expect(res.text).toMatch(/^WEB_AUTH_ENDPOINT="/m);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('advertises the dedicated SEP-10 public key, distinct from the funded service key', async () => {
      const dedicated = StellarSdk.Keypair.random();
      const funded = StellarSdk.Keypair.random();
      process.env.SEP10_SIGNING_KEY = dedicated.secret();
      process.env.SERVICE_SECRET_KEY = funded.secret();

      const res = await request(app).get('/.well-known/stellar.toml');

      expect(res.text).toContain(`SIGNING_KEY="${dedicated.publicKey()}"`);
      expect(res.text).not.toContain(funded.publicKey());
    });

    it('advertises the legacy key that actually signs challenges when no dedicated key is set', async () => {
      const legacy = StellarSdk.Keypair.random();
      process.env.SERVICE_SECRET_KEY = legacy.secret();

      const res = await request(app).get('/.well-known/stellar.toml');

      expect(res.text).toContain(`SIGNING_KEY="${legacy.publicKey()}"`);
    });

    it('returns 200 and omits SIGNING_KEY for an invalid key instead of failing every request', async () => {
      process.env.SEP10_SIGNING_KEY = StellarSdk.Keypair.random().publicKey(); // public key, not a seed

      const res = await request(app).get('/.well-known/stellar.toml');

      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/SIGNING_KEY=/);
      expect(res.text).toMatch(/WEB_AUTH_ENDPOINT=/);
    });

    it('omits SIGNING_KEY when no key is configured', async () => {
      const res = await request(app).get('/.well-known/stellar.toml');

      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/SIGNING_KEY=/);
    });

    it('uses API_BASE_URL for WEB_AUTH_ENDPOINT, not the request Host header', async () => {
      process.env.API_BASE_URL = 'https://api.example.org/';

      const res = await request(app).get('/.well-known/stellar.toml').set('Host', 'attacker.example');

      expect(res.text).toContain('WEB_AUTH_ENDPOINT="https://api.example.org/auth"');
      expect(res.text).toContain('AUTH_SERVER="https://api.example.org/auth"');
      expect(res.text).not.toMatch(/^(WEB_AUTH_ENDPOINT|AUTH_SERVER)=.*attacker\.example/m);
    });
  });

  describe('renderStellarToml', () => {
    it('builds the same body from the same inputs', () => {
      const input = { domain: 'example.org', scheme: 'https', host: 'example.org', signingPublicKey: null };

      expect(renderStellarToml(input)).toBe(renderStellarToml(input));
    });
  });
});
