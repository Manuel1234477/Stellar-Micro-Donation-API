/**
 * Stellar Transaction Memo Encryption Tests
 *
 * COVERAGE:
 * - encryptMemo: envelope structure, field sizes, randomness, Unicode, validation
 * - decryptMemo: round-trip, wrong key, tampered data, bad version/algorithm
 * - isEncryptedMemoEnvelope: object/JSON detection
 * - envelopeToMemoHash: deterministic 64-char hex
 * - ed25519PubToX25519 / ed25519SeedToX25519: correctness, RFC 7748 clamping
 * - decodeStellarPublicKey / decodeStellarSecretKey: valid + invalid inputs
 * - POST /donations encryptMemo:true — response metadata + stored envelope
 * - POST /donations no encryptMemo — no metadata
 * - GET /donations/:id/memo/decrypt — 200 correct key / 403 wrong / 404 / 422 / 400
 * - Security: sender and third party cannot decrypt
 *
 * No live Stellar network required (MOCK_STELLAR=true).
 */
'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-xxx';

const request = require('supertest');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const {
  encryptMemo,
  decryptMemo,
  isEncryptedMemoEnvelope,
  envelopeToMemoHash,
  ed25519PubToX25519,
  ed25519SeedToX25519,
  decodeStellarPublicKey,
  decodeStellarSecretKey,
} = require('../../src/utils/memoEncryption');

const Transaction = require('../../src/routes/models/transaction');

const recipientKp = StellarSdk.Keypair.random();
const recipientPub = recipientKp.publicKey();
const recipientSec = recipientKp.secret();
const senderKp = StellarSdk.Keypair.random();
const senderPub = senderKp.publicKey();
const wrongKp = StellarSdk.Keypair.random();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.apiKey = { id: 'test-key-id', role: 'user' };
    req.idempotency = { key: `idem-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    next();
  });
  const donationRoutes = require('../../src/routes/donation');
  app.use('/donations', donationRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      error: { code: err.errorCode || err.code || 'ERROR', message: err.message },
    });
  });
  return app;
}

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(() => { Transaction.saveTransactions([]); });
afterAll(() => { Transaction.saveTransactions([]); });

// ── decodeStellarPublicKey ───────────────────────────────────────────────────

describe('decodeStellarPublicKey', () => {
  test('returns 32-byte Buffer for valid G... address', () => {
    const buf = decodeStellarPublicKey(recipientPub);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });
  test('throws for secret key (non-G... string)', () => {
    expect(() => decodeStellarPublicKey(recipientSec)).toThrow('Invalid Stellar public key');
  });
  test('throws for non-string input', () => {
    expect(() => decodeStellarPublicKey(42)).toThrow();
  });
  test('throws for empty string', () => {
    expect(() => decodeStellarPublicKey('')).toThrow();
  });
  test('throws for malformed G... string', () => {
    expect(() => decodeStellarPublicKey('GBADKEY!!!')).toThrow();
  });
});

// ── decodeStellarSecretKey ───────────────────────────────────────────────────

describe('decodeStellarSecretKey', () => {
  test('returns 32-byte Buffer for valid S... key', () => {
    const buf = decodeStellarSecretKey(recipientSec);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });
  test('throws for public key passed as secret', () => {
    expect(() => decodeStellarSecretKey(recipientPub)).toThrow('Invalid Stellar secret key');
  });
  test('throws for non-string input', () => {
    expect(() => decodeStellarSecretKey(null)).toThrow();
  });
  test('throws for empty string', () => {
    expect(() => decodeStellarSecretKey('')).toThrow();
  });
});

// ── ed25519PubToX25519 ───────────────────────────────────────────────────────

describe('ed25519PubToX25519', () => {
  test('returns 32-byte Buffer', () => {
    const x = ed25519PubToX25519(decodeStellarPublicKey(recipientPub));
    expect(Buffer.isBuffer(x)).toBe(true);
    expect(x.length).toBe(32);
  });
  test('is deterministic', () => {
    const ed = decodeStellarPublicKey(recipientPub);
    expect(ed25519PubToX25519(ed).equals(ed25519PubToX25519(ed))).toBe(true);
  });
  test('different keys produce different outputs', () => {
    const x1 = ed25519PubToX25519(decodeStellarPublicKey(recipientPub));
    const x2 = ed25519PubToX25519(decodeStellarPublicKey(senderPub));
    expect(x1.equals(x2)).toBe(false);
  });
});

// ── ed25519SeedToX25519 ──────────────────────────────────────────────────────

describe('ed25519SeedToX25519', () => {
  test('returns 32-byte Buffer', () => {
    const s = ed25519SeedToX25519(decodeStellarSecretKey(recipientSec));
    expect(Buffer.isBuffer(s)).toBe(true);
    expect(s.length).toBe(32);
  });
  test('RFC 7748: byte[0] low 3 bits are 0', () => {
    const s = ed25519SeedToX25519(decodeStellarSecretKey(recipientSec));
    expect(s[0] & 7).toBe(0);
  });
  test('RFC 7748: byte[31] bit 7 is 0', () => {
    const s = ed25519SeedToX25519(decodeStellarSecretKey(recipientSec));
    expect(s[31] & 128).toBe(0);
  });
  test('RFC 7748: byte[31] bit 6 is 1', () => {
    const s = ed25519SeedToX25519(decodeStellarSecretKey(recipientSec));
    expect(s[31] & 64).toBe(64);
  });
  test('is deterministic', () => {
    const seed = decodeStellarSecretKey(recipientSec);
    expect(ed25519SeedToX25519(seed).equals(ed25519SeedToX25519(seed))).toBe(true);
  });
});

// ── encryptMemo ──────────────────────────────────────────────────────────────

describe('encryptMemo', () => {
  test('returns envelope with all required fields', () => {
    const env = encryptMemo('hello', recipientPub);
    expect(env.v).toBe(1);
    expect(env.alg).toBe('ECDH-X25519-AES256GCM');
    expect(typeof env.ephemeralPublicKey).toBe('string');
    expect(typeof env.salt).toBe('string');
    expect(typeof env.iv).toBe('string');
    expect(typeof env.ciphertext).toBe('string');
    expect(typeof env.authTag).toBe('string');
  });
  test('ephemeralPublicKey decodes to 32 bytes', () => {
    expect(Buffer.from(encryptMemo('hello', recipientPub).ephemeralPublicKey, 'base64').length).toBe(32);
  });
  test('iv decodes to 12 bytes', () => {
    expect(Buffer.from(encryptMemo('hello', recipientPub).iv, 'base64').length).toBe(12);
  });
  test('authTag decodes to 16 bytes', () => {
    expect(Buffer.from(encryptMemo('hello', recipientPub).authTag, 'base64').length).toBe(16);
  });
  test('two encryptions of same plaintext produce different ciphertexts', () => {
    const e1 = encryptMemo('hello', recipientPub);
    const e2 = encryptMemo('hello', recipientPub);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
    expect(e1.iv).not.toBe(e2.iv);
  });
  test('handles Unicode memo', () => {
    expect(() => encryptMemo('こんにちは', recipientPub)).not.toThrow();
  });
  test('handles 28-char memo (Stellar max)', () => {
    expect(() => encryptMemo('a'.repeat(28), recipientPub)).not.toThrow();
  });
  test('throws for empty plaintext', () => {
    expect(() => encryptMemo('', recipientPub)).toThrow();
  });
  test('throws for non-string plaintext', () => {
    expect(() => encryptMemo(null, recipientPub)).toThrow();
  });
  test('throws for invalid Stellar address', () => {
    expect(() => encryptMemo('hello', 'NOT_A_KEY')).toThrow();
  });
});

// ── decryptMemo ──────────────────────────────────────────────────────────────

describe('decryptMemo', () => {
  test('round-trip: decrypt(encrypt(m)) === m', () => {
    const m = 'donation-ref-42';
    expect(decryptMemo(encryptMemo(m, recipientPub), recipientSec)).toBe(m);
  });
  test('round-trip with Unicode', () => {
    const m = 'こんにちは世界';
    expect(decryptMemo(encryptMemo(m, recipientPub), recipientSec)).toBe(m);
  });
  test('round-trip with special characters', () => {
    const m = 'ref#12 & <ok>';
    expect(decryptMemo(encryptMemo(m, recipientPub), recipientSec)).toBe(m);
  });
  test('accepts JSON string envelope', () => {
    const m = 'json-string-test';
    expect(decryptMemo(JSON.stringify(encryptMemo(m, recipientPub)), recipientSec)).toBe(m);
  });
  test('multiple consecutive round-trips succeed', () => {
    for (let i = 0; i < 3; i++) {
      expect(decryptMemo(encryptMemo(`memo-${i}`, recipientPub), recipientSec)).toBe(`memo-${i}`);
    }
  });
  test('throws "Decryption failed" with wrong key', () => {
    expect(() => decryptMemo(encryptMemo('secret', recipientPub), wrongKp.secret()))
      .toThrow('Decryption failed');
  });
  test('throws with tampered ciphertext', () => {
    const env = { ...encryptMemo('secret', recipientPub), ciphertext: 'dGFtcGVyZWQ=' };
    expect(() => decryptMemo(env, recipientSec)).toThrow();
  });
  test('throws with tampered authTag', () => {
    const env = { ...encryptMemo('secret', recipientPub), authTag: Buffer.alloc(16).toString('base64') };
    expect(() => decryptMemo(env, recipientSec)).toThrow();
  });
  test('throws for unsupported envelope version', () => {
    expect(() => decryptMemo({ ...encryptMemo('x', recipientPub), v: 99 }, recipientSec))
      .toThrow('Unsupported envelope version');
  });
  test('throws for unsupported algorithm', () => {
    expect(() => decryptMemo({ ...encryptMemo('x', recipientPub), alg: 'INVALID' }, recipientSec))
      .toThrow('Unsupported algorithm');
  });
  test('throws when public key passed instead of secret', () => {
    expect(() => decryptMemo(encryptMemo('hello', recipientPub), recipientPub)).toThrow();
  });
});

// ── isEncryptedMemoEnvelope ──────────────────────────────────────────────────

describe('isEncryptedMemoEnvelope', () => {
  test('true for valid envelope object', () => {
    expect(isEncryptedMemoEnvelope(encryptMemo('hi', recipientPub))).toBe(true);
  });
  test('true for valid JSON string', () => {
    expect(isEncryptedMemoEnvelope(JSON.stringify(encryptMemo('hi', recipientPub)))).toBe(true);
  });
  test('false for plain string', () => {
    expect(isEncryptedMemoEnvelope('hello world')).toBe(false);
  });
  test('false for null', () => {
    expect(isEncryptedMemoEnvelope(null)).toBe(false);
  });
  test('false for object missing alg', () => {
    expect(isEncryptedMemoEnvelope({ v: 1 })).toBe(false);
  });
  test('false for wrong version', () => {
    expect(isEncryptedMemoEnvelope({ v: 99, alg: 'ECDH-X25519-AES256GCM' })).toBe(false);
  });
  test('false for invalid JSON string', () => {
    expect(isEncryptedMemoEnvelope('{bad json')).toBe(false);
  });
});

// ── envelopeToMemoHash ───────────────────────────────────────────────────────

describe('envelopeToMemoHash', () => {
  test('returns 64-char hex string', () => {
    expect(envelopeToMemoHash(encryptMemo('hi', recipientPub))).toMatch(/^[0-9a-f]{64}$/);
  });
  test('is deterministic for the same object', () => {
    const env = encryptMemo('hi', recipientPub);
    expect(envelopeToMemoHash(env)).toBe(envelopeToMemoHash(env));
  });
  test('differs for different envelopes', () => {
    const h1 = envelopeToMemoHash(encryptMemo('hi', recipientPub));
    const h2 = envelopeToMemoHash(encryptMemo('hi', recipientPub));
    expect(h1).not.toBe(h2);
  });
});

// ── POST /donations with encryptMemo ─────────────────────────────────────────

describe('POST /donations with encryptMemo', () => {
  test('returns encryptionMetadata when encryptMemo is true', async () => {
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', `test-${Date.now()}`)
      .send({ amount: '10.00', recipient: recipientPub, donor: senderPub, memo: 'private-note', encryptMemo: true, currency: 'XLM' });

    expect(res.status).toBe(201);
    expect(res.body.data.encryptionMetadata).toBeDefined();
    expect(res.body.data.encryptionMetadata.encrypted).toBe(true);
    expect(res.body.data.encryptionMetadata.algorithm).toBe('ECDH-X25519-AES256GCM');
  });

  test('stores memoEnvelope on the transaction record', async () => {
    const idem = `env-${Date.now()}`;
    await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', idem)
      .send({ amount: '5.00', recipient: recipientPub, memo: 'stored', encryptMemo: true, currency: 'XLM' });

    const tx = Transaction.loadTransactions().find(t => t.idempotencyKey === idem);
    expect(tx).toBeDefined();
    expect(tx.memoEnvelope).toBeDefined();
    expect(tx.memoEnvelope.v).toBe(1);
    expect(tx.encryptionMetadata.encrypted).toBe(true);
  });

  test('no encryptionMetadata when encryptMemo is omitted', async () => {
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', `plain-${Date.now()}`)
      .send({ amount: '5.00', recipient: recipientPub, memo: 'plain', currency: 'XLM' });

    expect(res.status).toBe(201);
    expect(res.body.data.encryptionMetadata).toBeUndefined();
  });

  test('encryptMemo:true with no memo is a no-op (succeeds)', async () => {
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', `noop-${Date.now()}`)
      .send({ amount: '5.00', recipient: recipientPub, encryptMemo: true, currency: 'XLM' });

    expect([200, 201]).toContain(res.status);
  });
});

// ── GET /donations/:id/memo/decrypt ──────────────────────────────────────────

describe('GET /donations/:id/memo/decrypt', () => {
  let encryptedTxId;

  beforeEach(async () => {
    Transaction.saveTransactions([]);
    const idem = `dec-${Date.now()}`;
    await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', idem)
      .send({ amount: '10.00', recipient: recipientPub, memo: 'secret-note', encryptMemo: true, currency: 'XLM' });
    const tx = Transaction.loadTransactions().find(t => t.idempotencyKey === idem);
    encryptedTxId = tx?.id;
  });

  test('200 with correct memo for valid recipient secret', async () => {
    const res = await request(app)
      .get(`/donations/${encryptedTxId}/memo/decrypt`)
      .set('X-API-Key', 'test-key')
      .query({ recipientSecret: recipientSec });

    expect(res.status).toBe(200);
    expect(res.body.data.memo).toBe('secret-note');
    expect(res.body.data.donationId).toBe(encryptedTxId);
    expect(res.body.data.algorithm).toBe('ECDH-X25519-AES256GCM');
  });

  test('403 with wrong recipient secret', async () => {
    const res = await request(app)
      .get(`/donations/${encryptedTxId}/memo/decrypt`)
      .set('X-API-Key', 'test-key')
      .query({ recipientSecret: wrongKp.secret() });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DECRYPTION_FAILED');
  });

  test('404 for unknown donation ID', async () => {
    const res = await request(app)
      .get('/donations/nonexistent-xyz/memo/decrypt')
      .set('X-API-Key', 'test-key')
      .query({ recipientSecret: recipientSec });

    expect(res.status).toBe(404);
  });

  test('422 for donation without encrypted memo', async () => {
    const idem = `plain-d-${Date.now()}`;
    await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key')
      .set('X-Idempotency-Key', idem)
      .send({ amount: '5.00', recipient: recipientPub, memo: 'plain', currency: 'XLM' });
    const tx = Transaction.loadTransactions().find(t => t.idempotencyKey === idem);

    const res = await request(app)
      .get(`/donations/${tx.id}/memo/decrypt`)
      .set('X-API-Key', 'test-key')
      .query({ recipientSecret: recipientSec });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MEMO_NOT_ENCRYPTED');
  });

  test('400 when recipientSecret is missing', async () => {
    const res = await request(app)
      .get(`/donations/${encryptedTxId}/memo/decrypt`)
      .set('X-API-Key', 'test-key');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FIELD');
  });
});

// ── Security ─────────────────────────────────────────────────────────────────

describe('Security', () => {
  test('sender cannot decrypt memo intended for recipient', () => {
    const env = encryptMemo('classified', recipientPub);
    expect(() => decryptMemo(env, senderKp.secret())).toThrow('Decryption failed');
  });

  test('third party cannot decrypt without either key', () => {
    const env = encryptMemo('classified', recipientPub);
    expect(() => decryptMemo(env, wrongKp.secret())).toThrow('Decryption failed');
  });

  test('same-length memos produce same-length ciphertexts (no length oracle)', () => {
    const e1 = encryptMemo('hello', recipientPub);
    const e2 = encryptMemo('world', recipientPub);
    expect(Buffer.from(e1.ciphertext, 'base64').length)
      .toBe(Buffer.from(e2.ciphertext, 'base64').length);
  });
});
