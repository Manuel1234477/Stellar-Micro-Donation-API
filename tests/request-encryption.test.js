'use strict';

/**
 * Request Body Encryption Tests
 *
 * Covers:
 * - EncryptionService: key generation, encrypt/decrypt round-trip, error cases
 * - requireEncryption middleware: enforces X-Encrypted header, decrypts body
 * - decryptIfEncrypted middleware: pass-through for unencrypted requests
 * - GET /encryption/public-key route
 * - End-to-end hybrid encryption scheme
 */

const crypto = require('crypto');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => { req.user = { id: 'u1', role: 'admin' }; next(); },
  requireAdmin: () => (req, res, next) => { req.user = { id: 'u1', role: 'admin' }; next(); },
  attachUserRole: () => (req, res, next) => next(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// EncryptionService unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('EncryptionService', () => {
  let EncryptionService;
  let svc;

  beforeEach(() => {
    jest.resetModules();
    // Re-require to get a fresh instance (avoids cached key pair from other tests)
    EncryptionService = require('../src/services/EncryptionService');
    svc = EncryptionService;
  });

  test('getPublicKey() returns a PEM-encoded RSA public key', () => {
    const pub = svc.getPublicKey();
    expect(pub).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pub).toContain('-----END PUBLIC KEY-----');
  });

  test('getKeyPair() returns the same pair on repeated calls (singleton)', () => {
    const pair1 = svc.getKeyPair();
    const pair2 = svc.getKeyPair();
    expect(pair1.publicKey).toBe(pair2.publicKey);
    expect(pair1.privateKey).toBe(pair2.privateKey);
  });

  test('getPublicKeyFingerprint() returns a 64-char hex string', () => {
    const fp = svc.getPublicKeyFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  test('resetKeyPair() causes a new key pair to be generated', () => {
    const fp1 = svc.getPublicKeyFingerprint();
    svc.resetKeyPair();
    const fp2 = svc.getPublicKeyFingerprint();
    // New key pair → different fingerprint
    expect(fp1).not.toBe(fp2);
  });

  test('encrypt() + decrypt() round-trip restores original body', () => {
    const body = { address: 'GABC123', label: 'test wallet', secret: 'S...' };
    const pub = svc.getPublicKey();

    const encrypted = EncryptionService.constructor.encrypt
      ? EncryptionService.constructor.encrypt(body, pub)
      : require('../src/services/EncryptionService').constructor.encrypt(body, pub);

    // Use the static method directly
    const { EncryptionService: ES } = jest.requireActual('../src/services/EncryptionService')
      ? { EncryptionService: require('../src/services/EncryptionService') }
      : {};

    // Call static encrypt
    const payload = require('../src/services/EncryptionService').constructor.encrypt
      ? require('../src/services/EncryptionService').constructor.encrypt(body, pub)
      : null;

    // Fallback: call the static method directly from the class
    const EncSvcClass = Object.getPrototypeOf(svc).constructor;
    const enc = EncSvcClass.encrypt(body, pub);

    expect(enc).toHaveProperty('encryptedKey');
    expect(enc).toHaveProperty('iv');
    expect(enc).toHaveProperty('ciphertext');
    expect(enc).toHaveProperty('authTag');

    const decrypted = svc.decrypt(enc);
    expect(decrypted).toEqual(body);
  });

  test('decrypt() throws on missing fields', () => {
    expect(() => svc.decrypt({ encryptedKey: 'x', iv: 'y', ciphertext: 'z' }))
      .toThrow('Missing required encryption fields');
  });

  test('decrypt() throws on tampered ciphertext', () => {
    const body = { foo: 'bar' };
    const pub = svc.getPublicKey();
    const EncSvcClass = Object.getPrototypeOf(svc).constructor;
    const enc = EncSvcClass.encrypt(body, pub);

    // Flip a byte in the ciphertext
    const ctBuf = Buffer.from(enc.ciphertext, 'base64');
    ctBuf[0] ^= 0xff;
    enc.ciphertext = ctBuf.toString('base64');

    expect(() => svc.decrypt(enc)).toThrow();
  });

  test('decrypt() throws on wrong IV length', () => {
    const body = { foo: 'bar' };
    const pub = svc.getPublicKey();
    const EncSvcClass = Object.getPrototypeOf(svc).constructor;
    const enc = EncSvcClass.encrypt(body, pub);

    enc.iv = Buffer.alloc(8).toString('base64'); // wrong length

    expect(() => svc.decrypt(enc)).toThrow('Invalid IV length');
  });

  test('each encrypt() call produces a unique IV', () => {
    const body = { x: 1 };
    const pub = svc.getPublicKey();
    const EncSvcClass = Object.getPrototypeOf(svc).constructor;

    const enc1 = EncSvcClass.encrypt(body, pub);
    const enc2 = EncSvcClass.encrypt(body, pub);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.encryptedKey).not.toBe(enc2.encryptedKey);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireEncryption middleware tests
// ─────────────────────────────────────────────────────────────────────────────

describe('requireEncryption middleware', () => {
  const request = require('supertest');
  const express = require('express');

  function buildApp(useRequire = true) {
    const app = express();
    app.use(express.json());
    const { requireEncryption, decryptIfEncrypted } = require('../src/middleware/requestDecryption');
    const mw = useRequire ? requireEncryption() : decryptIfEncrypted();
    app.post('/test', mw, (req, res) => res.json({ success: true, body: req.body }));
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || err.status || 400).json({ success: false, error: err.message });
    });
    return app;
  }

  test('returns 400 when X-Encrypted header is absent', async () => {
    const app = buildApp(true);
    const res = await request(app).post('/test').send({ foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/encrypted/i);
  });

  test('returns 400 when X-Encrypted: true but body is not valid encrypted payload', async () => {
    const app = buildApp(true);
    const res = await request(app)
      .post('/test')
      .set('X-Encrypted', 'true')
      .send({ notEncrypted: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/decryption failed/i);
  });

  test('decrypts body and passes plain object to handler', async () => {
    jest.resetModules();
    const encSvc = require('../src/services/EncryptionService');
    const EncSvcClass = Object.getPrototypeOf(encSvc).constructor;
    const pub = encSvc.getPublicKey();
    const body = { address: 'GABC', label: 'my wallet' };
    const enc = EncSvcClass.encrypt(body, pub);

    const app = express();
    app.use(express.json());
    const { requireEncryption } = require('../src/middleware/requestDecryption');
    app.post('/test', requireEncryption(), (req, res) => res.json({ success: true, body: req.body }));
    app.use((err, req, res, _next) => res.status(400).json({ error: err.message }));

    const res = await request(app)
      .post('/test')
      .set('X-Encrypted', 'true')
      .send(enc);

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual(body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// decryptIfEncrypted middleware tests
// ─────────────────────────────────────────────────────────────────────────────

describe('decryptIfEncrypted middleware', () => {
  const request = require('supertest');
  const express = require('express');

  function buildApp() {
    const app = express();
    app.use(express.json());
    const { decryptIfEncrypted } = require('../src/middleware/requestDecryption');
    app.post('/test', decryptIfEncrypted(), (req, res) => res.json({ success: true, body: req.body }));
    app.use((err, req, res, _next) => res.status(400).json({ error: err.message }));
    return app;
  }

  test('passes through unencrypted request unchanged', async () => {
    const app = buildApp();
    const body = { foo: 'bar' };
    const res = await request(app).post('/test').send(body);
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual(body);
  });

  test('decrypts when X-Encrypted: true is set', async () => {
    jest.resetModules();
    const encSvc = require('../src/services/EncryptionService');
    const EncSvcClass = Object.getPrototypeOf(encSvc).constructor;
    const pub = encSvc.getPublicKey();
    const body = { secret: 'S...' };
    const enc = EncSvcClass.encrypt(body, pub);

    const app = express();
    app.use(express.json());
    const { decryptIfEncrypted } = require('../src/middleware/requestDecryption');
    app.post('/test', decryptIfEncrypted(), (req, res) => res.json({ success: true, body: req.body }));
    app.use((err, req, res, _next) => res.status(400).json({ error: err.message }));

    const res = await request(app)
      .post('/test')
      .set('X-Encrypted', 'true')
      .send(enc);

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual(body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /encryption/public-key route tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /encryption/public-key', () => {
  const request = require('supertest');
  const express = require('express');

  function buildApp() {
    const app = express();
    app.use(express.json());
    const encryptionRoutes = require('../src/routes/encryption');
    app.use('/encryption', encryptionRoutes);
    return app;
  }

  test('returns 200 with publicKey, algorithm, keySize, and fingerprint', async () => {
    const app = buildApp();
    const res = await request(app).get('/encryption/public-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(res.body.data.algorithm).toMatch(/RSA-OAEP/);
    expect(res.body.data.keySize).toBe(2048);
    expect(res.body.data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('returns the same public key on repeated calls', async () => {
    const app = buildApp();
    const r1 = await request(app).get('/encryption/public-key');
    const r2 = await request(app).get('/encryption/public-key');
    expect(r1.body.data.publicKey).toBe(r2.body.data.publicKey);
    expect(r1.body.data.fingerprint).toBe(r2.body.data.fingerprint);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end hybrid encryption scheme test
// ─────────────────────────────────────────────────────────────────────────────

describe('End-to-end hybrid encryption', () => {
  const request = require('supertest');
  const express = require('express');

  test('client fetches public key, encrypts body, server decrypts correctly', async () => {
    jest.resetModules();
    const encSvc = require('../src/services/EncryptionService');
    const EncSvcClass = Object.getPrototypeOf(encSvc).constructor;

    // Step 1: "client" fetches public key
    const pubKeyApp = express();
    pubKeyApp.use(express.json());
    pubKeyApp.use('/encryption', require('../src/routes/encryption'));
    const pkRes = await request(pubKeyApp).get('/encryption/public-key');
    const { publicKey } = pkRes.body.data;

    // Step 2: "client" encrypts a sensitive body
    const sensitiveBody = { address: 'GABC123', secret: 'SXYZ789', label: 'vault' };
    const encrypted = EncSvcClass.encrypt(sensitiveBody, publicKey);

    // Step 3: "client" sends encrypted request
    const apiApp = express();
    apiApp.use(express.json());
    const { requireEncryption } = require('../src/middleware/requestDecryption');
    apiApp.post('/wallets', requireEncryption(), (req, res) =>
      res.status(201).json({ success: true, received: req.body })
    );
    apiApp.use((err, req, res, _next) => res.status(400).json({ error: err.message }));

    const res = await request(apiApp)
      .post('/wallets')
      .set('X-Encrypted', 'true')
      .send(encrypted);

    // Step 4: verify server received the plain-text body
    expect(res.status).toBe(201);
    expect(res.body.received).toEqual(sensitiveBody);
  });

  test('tampered ciphertext is rejected with 400', async () => {
    jest.resetModules();
    const encSvc = require('../src/services/EncryptionService');
    const EncSvcClass = Object.getPrototypeOf(encSvc).constructor;
    const pub = encSvc.getPublicKey();

    const enc = EncSvcClass.encrypt({ secret: 'S...' }, pub);
    // Tamper with ciphertext
    const buf = Buffer.from(enc.ciphertext, 'base64');
    buf[0] ^= 0xff;
    enc.ciphertext = buf.toString('base64');

    const app = express();
    app.use(express.json());
    const { requireEncryption } = require('../src/middleware/requestDecryption');
    app.post('/test', requireEncryption(), (req, res) => res.json({ ok: true }));
    app.use((err, req, res, _next) => res.status(400).json({ error: err.message }));

    const res = await request(app)
      .post('/test')
      .set('X-Encrypted', 'true')
      .send(enc);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/decryption failed/i);
  });

  test('non-encrypted request to requireEncryption endpoint returns 400', async () => {
    const app = express();
    app.use(express.json());
    const { requireEncryption } = require('../src/middleware/requestDecryption');
    app.post('/sensitive', requireEncryption(), (req, res) => res.json({ ok: true }));
    app.use((err, req, res, _next) => res.status(400).json({ error: err.message }));

    const res = await request(app).post('/sensitive').send({ address: 'GABC' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/encrypted/i);
  });
});
