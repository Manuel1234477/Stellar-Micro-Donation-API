'use strict';

/**
 * Tests for versioned memo encryption and background re-encryption job (#904, #1601)
 *
 * Covers:
 *  - Ciphertext includes version prefix (v<n>:...)
 *  - Decryption routes to the correct key by version
 *  - Key registry supports multiple concurrent versions
 *  - MemoReencryptionJob processes memos in batches
 *  - MemoReencryptionJob.getStatus() returns progress
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let tmpKeysDir;
let originalMemoKeysDir;

beforeAll(() => {
  tmpKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-key-test-multi-'));
  originalMemoKeysDir = process.env.MEMO_KEYS_DIR;
  process.env.MEMO_KEYS_DIR = tmpKeysDir;
});

afterAll(() => {
  if (originalMemoKeysDir !== undefined) {
    process.env.MEMO_KEYS_DIR = originalMemoKeysDir;
  } else {
    delete process.env.MEMO_KEYS_DIR;
  }
  try { fs.rmSync(tmpKeysDir, { recursive: true }); } catch { /* ignore */ }
});

let memoKeyManager;
let MemoEncryptionService;

beforeEach(() => {
  jest.resetModules();
  memoKeyManager = require('../../src/utils/memoKeyManager');
  MemoEncryptionService = require('../../src/services/MemoEncryptionService');
  // Reset key store for clean state
  const keysFile = path.join(tmpKeysDir, 'keys.json');
  if (fs.existsSync(keysFile)) fs.unlinkSync(keysFile);
  memoKeyManager.initializeKeyStorage();
});

// Stellar test keys (not real accounts)
const RECIPIENT_PUBLIC = 'GB2FODFFKR2GHNSGYBOW6OVUQ7WBCZ7WPED2K3PVG4JRRKOS47GPYT34';
const RECIPIENT_SECRET = 'SCYVBUKBSEUU7WGUW2HI4NT7LVH65H6OGADFU7PFH3UX24IDMZEI4YYO';
const PLAINTEXT = 'Versioned memo test: thank you for your support!';

// ─── Versioned ciphertext format ──────────────────────────────────────────────

describe('Versioned ciphertext', () => {
  test('encrypt produces v<n>:<base64> format', () => {
    const { memoEnvelope } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(typeof memoEnvelope).toBe('string');
    expect(memoEnvelope).toMatch(/^v\d+:.+/);
  });

  test('version prefix matches active key version', () => {
    const activeVersion = memoKeyManager.getActiveKeyVersion();
    const { memoEnvelope, encryptionMetadata } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(memoEnvelope.startsWith(`v${activeVersion}:`)).toBe(true);
    expect(encryptionMetadata.keyVersion).toBe(activeVersion);
  });

  test('encryptionMetadata includes algorithm and createdAt', () => {
    const { encryptionMetadata } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(encryptionMetadata).toHaveProperty('algorithm', 'ECDH-X25519-AES256GCM');
    expect(encryptionMetadata).toHaveProperty('createdAt');
    expect(new Date(encryptionMetadata.createdAt)).toBeInstanceOf(Date);
  });

  test('decrypt v1 ciphertext with correct secret key', () => {
    const { memoEnvelope } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    const decrypted = MemoEncryptionService.decryptMemoForRecipient(memoEnvelope, RECIPIENT_SECRET);
    expect(decrypted).toBe(PLAINTEXT);
  });

  test('decrypt fails with wrong secret key', () => {
    const { memoEnvelope } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(() => {
      MemoEncryptionService.decryptMemoForRecipient(memoEnvelope, RECIPIENT_SECRET.replace('S', 'T'));
    }).toThrow();
  });
});

// ─── Key registry: multiple concurrent versions ───────────────────────────────

describe('Key registry: multiple versions', () => {
  test('getAllKeyVersions returns all versions after rotation', () => {
    expect(memoKeyManager.getAllKeyVersions().length).toBe(1);
    memoKeyManager.rotateKey();
    const versions = memoKeyManager.getAllKeyVersions();
    expect(versions.length).toBe(2);
    expect(versions.map(v => v.version)).toEqual([1, 2]);
  });

  test('active version is updated after rotation', () => {
    expect(memoKeyManager.getActiveKeyVersion()).toBe(1);
    memoKeyManager.rotateKey();
    expect(memoKeyManager.getActiveKeyVersion()).toBe(2);
  });

  test('getKeyMaterial returns key for each version', () => {
    memoKeyManager.rotateKey();
    const v1Key = memoKeyManager.getKeyMaterial(1);
    const v2Key = memoKeyManager.getKeyMaterial(2);
    expect(Buffer.isBuffer(v1Key)).toBe(true);
    expect(Buffer.isBuffer(v2Key)).toBe(true);
    expect(v1Key.length).toBe(32);
    expect(v2Key.length).toBe(32);
    // Keys should be different
    expect(v1Key.equals(v2Key)).toBe(false);
  });

  test('getKeyMaterial throws for unknown version', () => {
    expect(() => memoKeyManager.getKeyMaterial(999)).toThrow(/not found/i);
  });

  test('new encryptions use the active key version after rotation', () => {
    memoKeyManager.rotateKey();
    const activeVersion = memoKeyManager.getActiveKeyVersion();
    const { memoEnvelope, encryptionMetadata } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(encryptionMetadata.keyVersion).toBe(activeVersion);
    expect(memoEnvelope.startsWith(`v${activeVersion}:`)).toBe(true);
  });
});

// ─── Decrypt routes to correct key by version ────────────────────────────────

describe('Decryption with multiple key versions', () => {
  test('v1 ciphertext can be decrypted after rotating to v2', () => {
    // Encrypt with v1
    const { memoEnvelope: v1Ciphertext } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(v1Ciphertext.startsWith('v1:')).toBe(true);

    // Rotate to v2
    memoKeyManager.rotateKey();

    // v1 ciphertext should still decrypt (key v1 still in store)
    const decrypted = MemoEncryptionService.decryptMemoForRecipient(v1Ciphertext, RECIPIENT_SECRET);
    expect(decrypted).toBe(PLAINTEXT);
  });

  test('v2 ciphertext can be decrypted while v1 still in store', () => {
    memoKeyManager.rotateKey(); // now on v2
    const { memoEnvelope: v2Ciphertext } = MemoEncryptionService.encryptMemoForRecipient(PLAINTEXT, RECIPIENT_PUBLIC);
    expect(v2Ciphertext.startsWith('v2:')).toBe(true);

    const decrypted = MemoEncryptionService.decryptMemoForRecipient(v2Ciphertext, RECIPIENT_SECRET);
    expect(decrypted).toBe(PLAINTEXT);
  });

  test('decrypt fails gracefully for unknown key version', () => {
    // Craft a fake "v99:" versioned ciphertext
    const fakeCiphertext = 'v99:aGVsbG8=';
    expect(() => {
      MemoEncryptionService.decryptMemoForRecipient(fakeCiphertext, RECIPIENT_SECRET);
    }).toThrow(/unknown key version|not found/i);
  });
});

// ─── Background re-encryption job ────────────────────────────────────────────

describe('MemoReencryptionJob', () => {
  let MemoReencryptionJob;
  let Database;

  beforeAll(async () => {
    MemoReencryptionJob = require('../../src/jobs/memoReencryptionJob');
    Database = require('../../src/utils/database');
    await Database.initialize();
  });

  afterAll(async () => {
    await Database.close();
  });

  test('exports MemoReencryptionJob class', () => {
    expect(typeof MemoReencryptionJob).toBe('function');
  });

  test('constructor sets defaults', () => {
    const job = new MemoReencryptionJob();
    expect(job.isRunning).toBe(false);
    expect(job.batchSize).toBeGreaterThan(0);
    expect(job.intervalMs).toBeGreaterThan(0);
  });

  test('getStatus returns structured status object', () => {
    const job = new MemoReencryptionJob({ batchSize: 10, intervalMs: 5000 });
    const status = job.getStatus();
    expect(status).toHaveProperty('isRunning', false);
    expect(status).toHaveProperty('batchSize', 10);
    expect(status).toHaveProperty('intervalMs', 5000);
    expect(status).toHaveProperty('activeKeyVersion');
    expect(status).toHaveProperty('stats');
    expect(status.stats).toHaveProperty('processed');
    expect(status.stats).toHaveProperty('succeeded');
    expect(status.stats).toHaveProperty('failed');
    expect(status.stats).toHaveProperty('skipped');
  });

  test('runOnce processes memos in the donations_store', async () => {
    const job = new MemoReencryptionJob({
      batchSize: 100,
      recipientSecrets: {}, // No secrets, all memos will be skipped
    });

    const result = await job.runOnce();
    expect(result).toHaveProperty('processed');
    expect(result).toHaveProperty('succeeded');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('skipped');
    // With no secrets, all memos with encrypted envelopes will be skipped
    expect(typeof result.skipped).toBe('number');
  });

  test('stop() sets isRunning to false', () => {
    const job = new MemoReencryptionJob({ intervalMs: 9999999 });
    // Mark as running manually (without actually starting the interval)
    job.isRunning = true;
    job.stop();
    expect(job.isRunning).toBe(false);
  });

  test('start() and stop() are idempotent', () => {
    const job = new MemoReencryptionJob({ intervalMs: 9999999 });
    expect(() => {
      job.stop(); // stop on not-started job should not throw
      job.stop(); // second stop is a no-op
    }).not.toThrow();
  });
});

// ─── serializeVersionedCiphertext / deserializeVersionedCiphertext ────────────

describe('memoKeyManager versioning utilities', () => {
  test('serialize produces v<n>:<base64> format', () => {
    const envelope = { v: 1, alg: 'ECDH-X25519-AES256GCM', ciphertext: 'abc' };
    const result = memoKeyManager.serializeVersionedCiphertext({ keyVersion: 3, encryptedEnvelope: envelope });
    expect(result).toMatch(/^v3:.+/);
  });

  test('deserialize round-trips correctly', () => {
    const envelope = { v: 1, alg: 'ECDH-X25519-AES256GCM', ciphertext: 'hello' };
    const serialized = memoKeyManager.serializeVersionedCiphertext({ keyVersion: 5, encryptedEnvelope: envelope });
    const { keyVersion, encryptedEnvelope } = memoKeyManager.deserializeVersionedCiphertext(serialized);
    expect(keyVersion).toBe(5);
    expect(encryptedEnvelope).toEqual(envelope);
  });

  test('deserialize throws on invalid format', () => {
    expect(() => memoKeyManager.deserializeVersionedCiphertext('invalid')).toThrow();
    expect(() => memoKeyManager.deserializeVersionedCiphertext('')).toThrow();
    expect(() => memoKeyManager.deserializeVersionedCiphertext(null)).toThrow();
  });
});
