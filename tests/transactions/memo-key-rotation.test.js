'use strict';

/**
 * Tests for memo encryption key rotation (#904)
 *
 * Covers:
 *  - encrypt stores versioned ciphertext ("v<n>:…")
 *  - decrypt v1 ciphertext after rotation to v2 succeeds
 *  - encrypt new memos with v2 after rotation
 *  - re-encrypt v1 memo to v2
 *  - decrypt with unknown version fails gracefully
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use a temp directory for the key store so tests don't mutate the real file
let tmpKeysDir;
let originalMemoKeysDir;

beforeAll(() => {
  tmpKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-key-test-'));
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

// Re-require after setting the env var so the modules pick up the temp directory
let memoKeyManager;
let MemoEncryptionService;

beforeEach(() => {
  // Clear module cache so each test starts with a fresh key store
  jest.resetModules();
  memoKeyManager = require('../../src/utils/memoKeyManager');
  MemoEncryptionService = require('../../src/services/MemoEncryptionService');
  // Remove any existing key file to ensure a clean state
  const keysFile = path.join(tmpKeysDir, 'keys.json');
  if (fs.existsSync(keysFile)) fs.unlinkSync(keysFile);
  // Initialize fresh key store (v1)
  memoKeyManager.initializeKeyStorage();
});

// Stellar test keys (generated for tests — not real accounts)
const RECIPIENT_PUBLIC  = 'GB2FODFFKR2GHNSGYBOW6OVUQ7WBCZ7WPED2K3PVG4JRRKOS47GPYT34';
const RECIPIENT_SECRET  = 'SCYVBUKBSEUU7WGUW2HI4NT7LVH65H6OGADFU7PFH3UX24IDMZEI4YYO';

const PLAINTEXT = 'Thank you for your generous donation!';

describe('#904 Memo encryption key rotation', () => {
  test('encrypt returns versioned ciphertext in v<n>:base64 format', () => {
    const { memoEnvelope } = MemoEncryptionService.encryptMemoForRecipient(
      PLAINTEXT,
      RECIPIENT_PUBLIC
    );
    expect(typeof memoEnvelope).toBe('string');
    expect(memoEnvelope).toMatch(/^v\d+:.+/);
  });

  test('encrypt uses the active key version (v1 initially)', () => {
    const { memoEnvelope, encryptionMetadata } = MemoEncryptionService.encryptMemoForRecipient(
      PLAINTEXT,
      RECIPIENT_PUBLIC
    );
    expect(encryptionMetadata.keyVersion).toBe(1);
    expect(memoEnvelope.startsWith('v1:')).toBe(true);
  });

  test('decrypt v1 ciphertext succeeds with correct recipient secret', () => {
    const { memoEnvelope } = MemoEncryptionService.encryptMemoForRecipient(
      PLAINTEXT,
      RECIPIENT_PUBLIC
    );
    const decrypted = MemoEncryptionService.decryptMemoForRecipient(
      memoEnvelope,
      RECIPIENT_SECRET
    );
    expect(decrypted).toBe(PLAINTEXT);
  });

  test('after rotating to v2, new encryptions use v2', () => {
    memoKeyManager.rotateKey();
    const activeVersion = memoKeyManager.getActiveKeyVersion();
    expect(activeVersion).toBe(2);

    const { memoEnvelope, encryptionMetadata } = MemoEncryptionService.encryptMemoForRecipient(
      PLAINTEXT,
      RECIPIENT_PUBLIC
    );
    expect(encryptionMetadata.keyVersion).toBe(2);
    expect(memoEnvelope.startsWith('v2:')).toBe(true);
  });

  test('decrypt v1 ciphertext still succeeds after rotation to v2', () => {
    // Encrypt with v1
    const { memoEnvelope: v1Memo } = MemoEncryptionService.encryptMemoForRecipient(
      PLAINTEXT,
      RECIPIENT_PUBLIC
    );
    expect(v1Memo.startsWith('v1:')).toBe(true);

    // Rotate to v2
    memoKeyManager.rotateKey();

    // v1 memo should still decrypt (old key retained in store)
    const decrypted = MemoEncryptionService.decryptMemoForRecipient(v1Memo, RECIPIENT_SECRET);
    expect(decrypted).toBe(PLAINTEXT);
  });

  test('re-encrypt: decrypt v1 and re-encrypt to v2', () => {
    // Encrypt with v1
    const { memoEnvelope: v1Memo } = MemoEncryptionService.encryptMemoForRecipient(
      PLAINTEXT,
      RECIPIENT_PUBLIC
    );

    // Rotate to v2
    memoKeyManager.rotateKey();

    // Decrypt v1 memo
    const plaintext = MemoEncryptionService.decryptMemoForRecipient(v1Memo, RECIPIENT_SECRET);

    // Re-encrypt with v2
    const { memoEnvelope: v2Memo, encryptionMetadata } = MemoEncryptionService.encryptMemoForRecipient(
      plaintext,
      RECIPIENT_PUBLIC
    );

    expect(v2Memo.startsWith('v2:')).toBe(true);
    expect(encryptionMetadata.keyVersion).toBe(2);

    // v2 memo must decrypt correctly
    const decryptedV2 = MemoEncryptionService.decryptMemoForRecipient(v2Memo, RECIPIENT_SECRET);
    expect(decryptedV2).toBe(PLAINTEXT);
  });

  test('decrypt with unknown version fails gracefully', () => {
    // Manually craft a versioned ciphertext with a nonexistent version
    const fakeVersionedMemo = 'v99:' + Buffer.from(JSON.stringify({
      v: 1,
      alg: 'ECDH-X25519-AES256GCM',
      ephemeralPublicKey: 'fake',
      salt: 'fake',
      iv: 'fake',
      ciphertext: 'fake',
      authTag: 'fake',
    })).toString('base64');

    expect(() =>
      MemoEncryptionService.decryptMemoForRecipient(fakeVersionedMemo, RECIPIENT_SECRET)
    ).toThrow(/unknown key version/i);
  });

  test('getAllKeyVersions reflects retiredAt after rotation', () => {
    memoKeyManager.rotateKey();
    const versions = memoKeyManager.getAllKeyVersions();
    expect(versions).toHaveLength(2);

    const v1 = versions.find(k => k.version === 1);
    const v2 = versions.find(k => k.version === 2);

    expect(v1).toBeDefined();
    expect(v1.retiredAt).not.toBeNull();

    expect(v2).toBeDefined();
    expect(v2.retiredAt).toBeNull();
  });
});
