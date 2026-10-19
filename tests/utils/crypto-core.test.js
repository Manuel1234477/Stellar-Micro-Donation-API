'use strict';

/**
 * Crypto core (#1776) — known-answer, tamper and format tests.
 *
 * Covers:
 *  - AES-256-GCM known-answer test (GCM spec test case, 256-bit key)
 *  - Versioned envelope "v<n>:<iv>:<ct>:<tag>" known answer (existing stored format)
 *  - Tamper detection on IV, ciphertext, tag and version prefix
 *  - Random 96-bit IV per seal (no reuse)
 *  - Wrappers route through the core (no direct createCipheriv elsewhere)
 */

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const core = require('../../src/utils/crypto');

const KAT = {
  key: 'feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308',
  iv: 'cafebabefacedbaddecaf888',
  plaintext: 'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255',
  ciphertext: '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad',
  tag: 'b094dac5d93471bdec1a502270e3cc6c',
};

// Produced with ENCRYPTION_KEY="kat-encryption-key", IV 000102…0b, plaintext "known answer"
const VERSIONED_KAT = 'v1:000102030405060708090a0b:48ef85a5ad7adf08ff24374c:d5725bb9a9271e63a34f4103e83fa590';

const hex = (h) => Buffer.from(h, 'hex');

describe('AES-256-GCM known answer', () => {
  it('opens the GCM spec test vector', () => {
    const out = core.open(hex(KAT.key), { iv: hex(KAT.iv), ciphertext: hex(KAT.ciphertext), tag: hex(KAT.tag) });
    expect(out.toString('hex')).toBe(KAT.plaintext);
  });

  it('rejects the vector with a flipped tag bit', () => {
    const tag = hex(KAT.tag);
    tag[0] ^= 0x01;
    expect(() => core.open(hex(KAT.key), { iv: hex(KAT.iv), ciphertext: hex(KAT.ciphertext), tag }))
      .toThrow(expect.objectContaining({ code: 'DECRYPTION_FAILED' }));
  });
});

describe('versioned envelope', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_1', 'ENCRYPTION_KEY_2', 'ENCRYPTION_KEY_VERSION']) saved[k] = process.env[k];
    process.env.ENCRYPTION_KEY = 'kat-encryption-key';
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY_VERSION;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('decrypts a known stored value', () => {
    expect(core.decryptVersioned(VERSIONED_KAT)).toBe('known answer');
  });

  it('EncryptionService.decryptField reads the same known value', () => {
    const svc = require('../../src/services/EncryptionService');
    expect(svc.decryptField(VERSIONED_KAT)).toBe('known answer');
  });

  it('round-trips with the active version and records it in the prefix', () => {
    process.env.ENCRYPTION_KEY_2 = 'second-key';
    process.env.ENCRYPTION_KEY_VERSION = '2';
    const env = core.encryptVersioned('rotated');
    expect(env.startsWith('v2:')).toBe(true);
    expect(core.decryptVersioned(env)).toBe('rotated');
  });

  it('uses a fresh 96-bit IV for every encryption', () => {
    const a = core.parseVersioned(core.encryptVersioned('same'));
    const b = core.parseVersioned(core.encryptVersioned('same'));
    expect(a.iv).toHaveLength(12);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it.each([
    ['iv', 1],
    ['ciphertext', 2],
    ['tag', 3],
  ])('detects tampering with the %s', (_name, index) => {
    const parts = VERSIONED_KAT.split(':');
    const buf = Buffer.from(parts[index], 'hex');
    buf[0] ^= 0x80;
    parts[index] = buf.toString('hex');
    expect(() => core.decryptVersioned(parts.join(':'))).toThrow(expect.objectContaining({ code: 'DECRYPTION_FAILED' }));
  });

  it('fails when the version prefix is changed to another key', () => {
    process.env.ENCRYPTION_KEY_2 = 'second-key';
    const swapped = VERSIONED_KAT.replace(/^v1:/, 'v2:');
    expect(() => core.decryptVersioned(swapped)).toThrow(expect.objectContaining({ code: 'DECRYPTION_FAILED' }));
  });

  it('rejects a truncated auth tag', () => {
    const parts = VERSIONED_KAT.split(':');
    parts[3] = parts[3].slice(0, 16);
    expect(() => core.decryptVersioned(parts.join(':'))).toThrow(expect.objectContaining({ code: 'INVALID_ENVELOPE' }));
  });

  it('rejects malformed envelopes', () => {
    expect(() => core.parseVersioned('v1:zz:zz')).toThrow(expect.objectContaining({ code: 'INVALID_ENVELOPE' }));
    expect(core.isVersionedEnvelope('plain text')).toBe(false);
    expect(core.isVersionedEnvelope(VERSIONED_KAT)).toBe(true);
  });

  it('reports a missing key version', () => {
    delete process.env.ENCRYPTION_KEY_9;
    expect(() => core.keyProvider.getVersionedKey(9)).toThrow(expect.objectContaining({ code: 'KEY_NOT_CONFIGURED' }));
  });
});

describe('primitives', () => {
  it('rejects keys that are not 32 bytes', () => {
    expect(() => core.seal(Buffer.alloc(16), 'x')).toThrow(expect.objectContaining({ code: 'INVALID_KEY' }));
  });

  it('binds additional authenticated data', () => {
    const key = core.generateKey();
    const sealed = core.seal(key, 'payload', { aad: Buffer.from('ctx-a') });
    expect(core.open(key, sealed, { aad: Buffer.from('ctx-a') }).toString()).toBe('payload');
    expect(() => core.open(key, sealed, { aad: Buffer.from('ctx-b') })).toThrow(expect.objectContaining({ code: 'DECRYPTION_FAILED' }));
  });

  it('matches node:crypto output for the same IV (interop)', () => {
    const key = core.generateKey();
    const sealed = core.seal(key, 'interop');
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, sealed.iv);
    decipher.setAuthTag(sealed.tag);
    expect(Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString()).toBe('interop');
  });
});

describe('single implementation', () => {
  it('no other source file calls createCipheriv/createDecipheriv directly', () => {
    const srcDir = path.join(__dirname, '../../src');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && full !== path.join(srcDir, 'utils/crypto.js')
          && /create(?:Cipher|Decipher)iv\(/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(srcDir, full));
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
