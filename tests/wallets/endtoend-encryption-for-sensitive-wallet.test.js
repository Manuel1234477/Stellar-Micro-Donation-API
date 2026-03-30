'use strict';

/**
 * Tests: End-to-End Envelope Encryption for Wallet Secrets
 *
 * Covers:
 *  - KMS provider selection (local / aws / unknown fallback)
 *  - DEK generation
 *  - Local KEK encrypt/decrypt DEK round-trip
 *  - encryptWithDEK / decryptWithDEK round-trip (v2 envelope)
 *  - Legacy v1 format backward-compatibility via decryptWithDEK
 *  - rotateDEK produces a new envelope that still decrypts correctly
 *  - rotateDEK changes the stored ciphertext (new DEK each time)
 *  - Error: missing ENCRYPTION_KEY for local provider
 *  - Error: malformed encrypted DEK
 *  - Error: unsupported envelope version
 *  - Error: tampered auth tag (GCM integrity check)
 *  - AWS KMS backend (mocked — no live network required)
 */

const crypto = require('crypto');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Set env vars and reload a module fresh (bypasses require cache). */
function freshRequire(modulePath, envOverrides = {}) {
  // Apply env overrides
  const saved = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  // Bust cache for the module and its local deps
  const abs = require.resolve(modulePath);
  [abs, require.resolve('../src/utils/kms'), require.resolve('../src/utils/encryption')].forEach(
    (p) => { try { delete require.cache[p]; } catch (_) {} }
  );

  const mod = require(modulePath);

  // Restore env
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return mod;
}

// ─── KMS module tests ─────────────────────────────────────────────────────────

describe('kms.js', () => {
  const TEST_KEY = 'test-encryption-key-for-unit-tests';

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    process.env.KMS_PROVIDER = 'local';
    // Clear module cache so env changes take effect
    delete require.cache[require.resolve('../src/utils/kms')];
  });

  afterEach(() => {
    delete require.cache[require.resolve('../src/utils/kms')];
  });

  describe('getProvider()', () => {
    it('returns "local" by default', () => {
      delete process.env.KMS_PROVIDER;
      const { getProvider } = require('../../src/utils/kms');
      expect(getProvider()).toBe('local');
    });

    it('returns "aws" when KMS_PROVIDER=aws', () => {
      process.env.KMS_PROVIDER = 'aws';
      delete require.cache[require.resolve('../src/utils/kms')];
      const { getProvider } = require('../../src/utils/kms');
      expect(getProvider()).toBe('aws');
    });

    it('falls back to "local" for unknown provider', () => {
      process.env.KMS_PROVIDER = 'vault';
      delete require.cache[require.resolve('../src/utils/kms')];
      const { getProvider } = require('../../src/utils/kms');
      expect(getProvider()).toBe('local');
    });
  });

  describe('generateDEK()', () => {
    it('returns a 32-byte Buffer', () => {
      const { generateDEK } = require('../../src/utils/kms');
      const dek = generateDEK();
      expect(Buffer.isBuffer(dek)).toBe(true);
      expect(dek.length).toBe(32);
    });

    it('generates unique DEKs each call', () => {
      const { generateDEK } = require('../../src/utils/kms');
      expect(generateDEK().toString('hex')).not.toBe(generateDEK().toString('hex'));
    });
  });

  describe('local provider — encryptDEK / decryptDEK', () => {
    it('round-trips a DEK correctly', async () => {
      const { generateDEK, encryptDEK, decryptDEK } = require('../../src/utils/kms');
      const dek = generateDEK();
      const enc = await encryptDEK(dek);
      const dec = await decryptDEK(enc);
      expect(dec.toString('hex')).toBe(dek.toString('hex'));
    });

    it('produces different ciphertext for the same DEK (random IV)', async () => {
      const { generateDEK, encryptDEK } = require('../../src/utils/kms');
      const dek = generateDEK();
      const enc1 = await encryptDEK(dek);
      const enc2 = await encryptDEK(dek);
      expect(enc1).not.toBe(enc2);
    });

    it('throws when ENCRYPTION_KEY is missing', async () => {
      delete process.env.ENCRYPTION_KEY;
      delete require.cache[require.resolve('../src/utils/kms')];
      const { generateDEK, encryptDEK } = require('../../src/utils/kms');
      await expect(encryptDEK(generateDEK())).rejects.toThrow('ENCRYPTION_KEY');
    });

    it('throws on malformed encrypted DEK', async () => {
      const { decryptDEK } = require('../../src/utils/kms');
      await expect(decryptDEK('not:valid')).rejects.toThrow();
    });

    it('throws on tampered auth tag', async () => {
      const { generateDEK, encryptDEK, decryptDEK } = require('../../src/utils/kms');
      const enc = await encryptDEK(generateDEK());
      const parts = enc.split(':');
      // Flip last byte of auth tag
      const tag = parts[2];
      parts[2] = tag.slice(0, -2) + (tag.slice(-2) === 'ff' ? '00' : 'ff');
      await expect(decryptDEK(parts.join(':'))).rejects.toThrow();
    });
  });

  describe('AWS KMS backend (mocked)', () => {
    // Register a virtual mock so Jest can resolve it even without the package installed.
    // jest.mock is hoisted, so the string literal must be used directly here.
    jest.mock('@aws-sdk/client-kms', () => ({}), { virtual: true });

    let sendMock;

    beforeEach(() => {
      process.env.KMS_PROVIDER = 'aws';
      process.env.KMS_KEY_ID = 'arn:aws:kms:us-east-1:000000000000:key/test-key';
      process.env.AWS_REGION = 'us-east-1';

      sendMock = jest.fn();

      jest.doMock('@aws-sdk/client-kms', () => ({
        KMSClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
        EncryptCommand: jest.fn().mockImplementation((input) => ({ _type: 'Encrypt', ...input })),
        DecryptCommand: jest.fn().mockImplementation((input) => ({ _type: 'Decrypt', ...input })),
      }), { virtual: true });

      delete require.cache[require.resolve('../src/utils/kms')];
    });

    afterEach(() => {
      jest.dontMock('@aws-sdk/client-kms');
      delete require.cache[require.resolve('../src/utils/kms')];
      delete process.env.KMS_KEY_ID;
      delete process.env.AWS_REGION;
    });

    it('calls AWS KMS encrypt and returns base64 blob', async () => {
      const fakeCiphertext = crypto.randomBytes(32);
      sendMock.mockResolvedValue({ CiphertextBlob: fakeCiphertext });

      const { generateDEK, encryptDEK } = require('../../src/utils/kms');
      const result = await encryptDEK(generateDEK());
      expect(typeof result).toBe('string');
      expect(Buffer.from(result, 'base64').length).toBeGreaterThan(0);
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('calls AWS KMS decrypt and returns plaintext DEK', async () => {
      const fakeDEK = crypto.randomBytes(32);
      sendMock.mockResolvedValue({ Plaintext: fakeDEK });

      const { decryptDEK } = require('../../src/utils/kms');
      const result = await decryptDEK(Buffer.from('fake').toString('base64'));
      expect(Buffer.from(result).toString('hex')).toBe(fakeDEK.toString('hex'));
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('throws when KMS_KEY_ID is missing', async () => {
      delete process.env.KMS_KEY_ID;
      delete require.cache[require.resolve('../src/utils/kms')];
      const { generateDEK, encryptDEK } = require('../../src/utils/kms');
      await expect(encryptDEK(generateDEK())).rejects.toThrow('KMS_KEY_ID');
    });
  });
});

// ─── Envelope encryption (encryption.js) tests ───────────────────────────────

describe('encryption.js — envelope encryption', () => {
  const TEST_KEY = 'envelope-test-key-abc123';
  const SECRET = 'SCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X';

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    process.env.KMS_PROVIDER = 'local';
    delete require.cache[require.resolve('../src/utils/kms')];
    delete require.cache[require.resolve('../src/utils/encryption')];
  });

  afterEach(() => {
    delete require.cache[require.resolve('../src/utils/kms')];
    delete require.cache[require.resolve('../src/utils/encryption')];
  });

  describe('encryptWithDEK()', () => {
    it('returns a JSON string with v:2 and required fields', async () => {
      const { encryptWithDEK } = require('../../src/utils/encryption');
      const envelope = await encryptWithDEK(SECRET);
      const parsed = JSON.parse(envelope);
      expect(parsed.v).toBe(2);
      expect(typeof parsed.encryptedDEK).toBe('string');
      expect(typeof parsed.iv).toBe('string');
      expect(typeof parsed.ct).toBe('string');
      expect(typeof parsed.tag).toBe('string');
    });

    it('produces different ciphertext on each call (unique DEK + IV)', async () => {
      const { encryptWithDEK } = require('../../src/utils/encryption');
      const e1 = await encryptWithDEK(SECRET);
      const e2 = await encryptWithDEK(SECRET);
      expect(e1).not.toBe(e2);
    });

    it('does not embed the plaintext in the envelope', async () => {
      const { encryptWithDEK } = require('../../src/utils/encryption');
      const envelope = await encryptWithDEK(SECRET);
      expect(envelope).not.toContain(SECRET);
    });
  });

  describe('decryptWithDEK()', () => {
    it('round-trips a wallet secret correctly', async () => {
      const { encryptWithDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const envelope = await encryptWithDEK(SECRET);
      const result = await decryptWithDEK(envelope);
      expect(result).toBe(SECRET);
    });

    it('handles legacy v1 format (iv:ct:tag) transparently', async () => {
      const { encrypt, decryptWithDEK } = require('../../src/utils/encryption');
      const legacyEncrypted = encrypt(SECRET);
      // Must NOT start with '{' — confirm it's legacy format
      expect(legacyEncrypted.startsWith('{')).toBe(false);
      const result = await decryptWithDEK(legacyEncrypted);
      expect(result).toBe(SECRET);
    });

    it('throws on unsupported envelope version', async () => {
      const { decryptWithDEK } = require('../../src/utils/encryption');
      const badEnvelope = JSON.stringify({ v: 99, encryptedDEK: 'x', iv: 'x', ct: 'x', tag: 'x' });
      await expect(decryptWithDEK(badEnvelope)).rejects.toThrow('Unsupported envelope version');
    });

    it('throws on tampered ciphertext (GCM auth failure)', async () => {
      const { encryptWithDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const envelope = await encryptWithDEK(SECRET);
      const parsed = JSON.parse(envelope);
      // Flip a byte in the ciphertext
      parsed.ct = parsed.ct.slice(0, -2) + (parsed.ct.slice(-2) === 'ff' ? '00' : 'ff');
      await expect(decryptWithDEK(JSON.stringify(parsed))).rejects.toThrow();
    });

    it('throws on tampered auth tag', async () => {
      const { encryptWithDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const envelope = await encryptWithDEK(SECRET);
      const parsed = JSON.parse(envelope);
      parsed.tag = parsed.tag.slice(0, -2) + (parsed.tag.slice(-2) === 'ff' ? '00' : 'ff');
      await expect(decryptWithDEK(JSON.stringify(parsed))).rejects.toThrow();
    });

    it('throws on malformed JSON envelope', async () => {
      const { decryptWithDEK } = require('../../src/utils/encryption');
      await expect(decryptWithDEK('{not valid json')).rejects.toThrow();
    });
  });

  describe('rotateDEK()', () => {
    it('produces a new envelope that decrypts to the same plaintext', async () => {
      const { encryptWithDEK, decryptWithDEK, rotateDEK } = require('../../src/utils/encryption');
      const original = await encryptWithDEK(SECRET);
      const rotated = await rotateDEK(original);
      expect(await decryptWithDEK(rotated)).toBe(SECRET);
    });

    it('produces a different ciphertext after rotation', async () => {
      const { encryptWithDEK, rotateDEK } = require('../../src/utils/encryption');
      const original = await encryptWithDEK(SECRET);
      const rotated = await rotateDEK(original);
      expect(rotated).not.toBe(original);
    });

    it('rotated envelope has a different encryptedDEK', async () => {
      const { encryptWithDEK, rotateDEK } = require('../../src/utils/encryption');
      const original = await encryptWithDEK(SECRET);
      const rotated = await rotateDEK(original);
      expect(JSON.parse(rotated).encryptedDEK).not.toBe(JSON.parse(original).encryptedDEK);
    });

    it('can rotate a legacy v1 envelope to v2', async () => {
      const { encrypt, rotateDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const legacy = encrypt(SECRET);
      const rotated = await rotateDEK(legacy);
      expect(JSON.parse(rotated).v).toBe(2);
      expect(await decryptWithDEK(rotated)).toBe(SECRET);
    });

    it('multiple rotations all decrypt correctly', async () => {
      const { encryptWithDEK, decryptWithDEK, rotateDEK } = require('../../src/utils/encryption');
      let envelope = await encryptWithDEK(SECRET);
      for (let i = 0; i < 3; i++) {
        envelope = await rotateDEK(envelope);
      }
      expect(await decryptWithDEK(envelope)).toBe(SECRET);
    });
  });

  describe('edge cases', () => {
    it('encrypts an empty string', async () => {
      const { encryptWithDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const envelope = await encryptWithDEK('');
      expect(await decryptWithDEK(envelope)).toBe('');
    });

    it('encrypts a very long secret', async () => {
      const { encryptWithDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const long = 'S' + 'x'.repeat(2000);
      const envelope = await encryptWithDEK(long);
      expect(await decryptWithDEK(envelope)).toBe(long);
    });

    it('encrypts unicode characters', async () => {
      const { encryptWithDEK, decryptWithDEK } = require('../../src/utils/encryption');
      const unicode = '🔑 secret: こんにちは';
      const envelope = await encryptWithDEK(unicode);
      expect(await decryptWithDEK(envelope)).toBe(unicode);
    });
  });
});
