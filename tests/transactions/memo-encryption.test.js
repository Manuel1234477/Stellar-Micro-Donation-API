/**
 * Memo Encryption Extended Tests
 *
 * RESPONSIBILITY: Comprehensive test coverage for memo encryption with key versioning
 * Tests cover: encryption, decryption, key rotation, versioning, and unauthorized access
 * Coverage Target: 95% of all memo encryption code
 */

'use strict';

const crypto = require('crypto');
const {
  encryptMemo,
  decryptMemo,
  encryptMemoWithVersion,
  decryptMemoWithVersion,
  isEncryptedMemoEnvelope,
  envelopeToMemoHash,
  ed25519PubToX25519,
  ed25519SeedToX25519,
  decodeStellarPublicKey,
  decodeStellarSecretKey,
} = require('../../src/utils/memoEncryption');

const memoKeyManager = require('../../src/utils/memoKeyManager');
const MemoEncryptionService = require('../../src/services/MemoEncryptionService');

// Clean up test key storage before tests
beforeAll(() => {
  memoKeyManager.clearAllKeys();
});

// Re-initialize for each test
beforeEach(() => {
  memoKeyManager.clearAllKeys();
  memoKeyManager.initializeKeyStorage();
});

// ─── Test Key Generation –────────────────────────────────────────────────────

/**
 * Generate a test Stellar key pair
 * @returns {{publicKey: string, secretKey: string}}
 */
function generateTestStellarKeyPair() {
  const { StrKey } = require('stellar-sdk');
  const keypair = require('stellar-sdk').Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
}

// ─── Unit: Memo Encryption and Decryption ────────────────────────────────────

describe('Memo Encryption - Basic Operations', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('encryptMemo encrypts plaintext and returns envelope', () => {
    const plaintext = 'Thank you for your support!';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    expect(envelope).toHaveProperty('v', 1);
    expect(envelope).toHaveProperty('alg', 'ECDH-X25519-AES256GCM');
    expect(envelope).toHaveProperty('ephemeralPublicKey');
    expect(envelope).toHaveProperty('salt');
    expect(envelope).toHaveProperty('iv');
    expect(envelope).toHaveProperty('ciphertext');
    expect(envelope).toHaveProperty('authTag');

    // All properties should be base64 strings (except v and alg)
    expect(typeof envelope.ephemeralPublicKey).toBe('string');
    expect(typeof envelope.salt).toBe('string');
    expect(typeof envelope.iv).toBe('string');
    expect(typeof envelope.ciphertext).toBe('string');
    expect(typeof envelope.authTag).toBe('string');
  });

  test('decryptMemo recovers plaintext from envelope', () => {
    const plaintext = 'Secret donor message';
    const envelope = encryptMemo(plaintext, keypair.publicKey);
    const decrypted = decryptMemo(envelope, keypair.secretKey);

    expect(decrypted).toBe(plaintext);
  });

  test('decryptMemo works with JSON string envelope', () => {
    const plaintext = 'Another secret message';
    const envelope = encryptMemo(plaintext, keypair.publicKey);
    const envelopeJSON = JSON.stringify(envelope);
    const decrypted = decryptMemo(envelopeJSON, keypair.secretKey);

    expect(decrypted).toBe(plaintext);
  });

  test('decryption fails with wrong secret key', () => {
    const plaintext = 'Protected message';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    const wrongKeypair = generateTestStellarKeyPair();
    expect(() => {
      decryptMemo(envelope, wrongKeypair.secretKey);
    }).toThrow('Decryption failed');
  });

  test('decryption fails if envelope is tampered', () => {
    const plaintext = 'Tamper-protected message';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    // Tamper with ciphertext
    envelope.ciphertext = Buffer.from('tampered data').toString('base64');

    expect(() => {
      decryptMemo(envelope, keypair.secretKey);
    }).toThrow('Decryption failed');
  });

  test('decryption fails if auth tag is tampered', () => {
    const plaintext = 'Auth-tag protected message';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    // Tamper with auth tag
    envelope.authTag = Buffer.from(crypto.randomBytes(16)).toString('base64');

    expect(() => {
      decryptMemo(envelope, keypair.secretKey);
    }).toThrow('Decryption failed');
  });

  test('encryptMemo rejects empty plaintext', () => {
    expect(() => {
      encryptMemo('', keypair.publicKey);
    }).toThrow('plaintext must be a non-empty string');
  });

  test('encryptMemo rejects null plaintext', () => {
    expect(() => {
      encryptMemo(null, keypair.publicKey);
    }).toThrow('plaintext must be a non-empty string');
  });

  test('encryptMemo rejects invalid Stellar address', () => {
    expect(() => {
      encryptMemo('Test message', 'invalid-address');
    }).toThrow('Invalid Stellar public key');
  });

  test('decryptMemo rejects invalid secret key', () => {
    const plaintext = 'Test';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    expect(() => {
      decryptMemo(envelope, 'SBAD');
    }).toThrow('Invalid Stellar secret key');
  });

  test('encryptMemo produces different ciphertexts for same plaintext', () => {
    const plaintext = 'Same message';
    const envelope1 = encryptMemo(plaintext, keypair.publicKey);
    const envelope2 = encryptMemo(plaintext, keypair.publicKey);

    // Ephemeral keys and salts should differ
    expect(envelope1.ephemeralPublicKey).not.toBe(envelope2.ephemeralPublicKey);
    expect(envelope1.salt).not.toBe(envelope2.salt);
    expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
  });

  test('encryptMemo handles long memo texts', () => {
    const longMemo = 'A'.repeat(10000);
    const envelope = encryptMemo(longMemo, keypair.publicKey);
    const decrypted = decryptMemo(envelope, keypair.secretKey);

    expect(decrypted).toBe(longMemo);
  });

  test('encryptMemo handles special characters and unicode', () => {
    const specialMemo = '🎉 Thank you! 中文 Español العربية';
    const envelope = encryptMemo(specialMemo, keypair.publicKey);
    const decrypted = decryptMemo(envelope, keypair.secretKey);

    expect(decrypted).toBe(specialMemo);
  });
});

// ─── Unit: Key Versioning Functions ───────────────────────────────────────────

describe('Memo Encryption - Key Versioning', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('encryptMemoWithVersion includes key version', () => {
    const plaintext = 'Versioned message';
    const result = encryptMemoWithVersion(plaintext, 1, keypair.publicKey);

    expect(result).toHaveProperty('keyVersion', 1);
    expect(result).toHaveProperty('encryptedEnvelope');
    expect(result).toHaveProperty('keyVersionPrefix', 'v1');
    expect(result.encryptedEnvelope).toHaveProperty('v', 1);
  });

  test('encryptMemoWithVersion rejects invalid key version', () => {
    const plaintext = 'Test message';
    
    expect(() => {
      encryptMemoWithVersion(plaintext, -1, keypair.publicKey);
    }).toThrow('keyVersion must be a positive number');

    expect(() => {
      encryptMemoWithVersion(plaintext, 0, keypair.publicKey);
    }).toThrow('keyVersion must be a positive number');

    expect(() => {
      encryptMemoWithVersion(plaintext, 'v1', keypair.publicKey);
    }).toThrow('keyVersion must be a positive number');
  });

  test('decryptMemoWithVersion decrypts versioned envelope', () => {
    const plaintext = 'Version test';
    const versionedResult = encryptMemoWithVersion(plaintext, 2, keypair.publicKey);
    const decrypted = decryptMemoWithVersion(
      versionedResult.encryptedEnvelope,
      keypair.secretKey
    );

    expect(decrypted).toBe(plaintext);
  });
});

// ─── Unit: Envelope Validation ────────────────────────────────────────────────

describe('Memo Encryption - Envelope Validation', () => {
  test('isEncryptedMemoEnvelope returns true for valid envelope object', () => {
    const envelope = {
      v: 1,
      alg: 'ECDH-X25519-AES256GCM',
      ephemeralPublicKey: 'test',
      salt: 'test',
      iv: 'test',
      ciphertext: 'test',
      authTag: 'test',
    };

    expect(isEncryptedMemoEnvelope(envelope)).toBe(true);
  });

  test('isEncryptedMemoEnvelope returns true for valid envelope JSON string', () => {
    const envelope = {
      v: 1,
      alg: 'ECDH-X25519-AES256GCM',
      ephemeralPublicKey: 'test',
      salt: 'test',
      iv: 'test',
      ciphertext: 'test',
      authTag: 'test',
    };

    expect(isEncryptedMemoEnvelope(JSON.stringify(envelope))).toBe(true);
  });

  test('isEncryptedMemoEnvelope returns false for invalid envelope', () => {
    expect(isEncryptedMemoEnvelope(null)).toBe(false);
    expect(isEncryptedMemoEnvelope(undefined)).toBe(false);
    expect(isEncryptedMemoEnvelope({})).toBe(false);
    expect(isEncryptedMemoEnvelope({ v: 2, alg: 'ECDH-X25519-AES256GCM' })).toBe(false);
    expect(isEncryptedMemoEnvelope('not json')).toBe(false);
  });
});

// ─── Unit: Memo Hash ──────────────────────────────────────────────────────────

describe('Memo Encryption - Memo Hash for On-Chain Storage', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('envelopeToMemoHash produces consistent hash', () => {
    const plaintext = 'Hashable memo';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    const hash1 = envelopeToMemoHash(envelope);
    const hash2 = envelopeToMemoHash(envelope);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex (64 chars)
  });

  test('envelopeToMemoHash produces different hashes for different envelopes', () => {
    const plaintext = 'Test memo';
    const envelope1 = encryptMemo(plaintext, keypair.publicKey);
    const envelope2 = encryptMemo(plaintext, keypair.publicKey);

    const hash1 = envelopeToMemoHash(envelope1);
    const hash2 = envelopeToMemoHash(envelope2);

    expect(hash1).not.toBe(hash2);
  });

  test('envelopeToMemoHash produces valid hex string', () => {
    const plaintext = 'Hex test memo';
    const envelope = encryptMemo(plaintext, keypair.publicKey);
    const hash = envelopeToMemoHash(envelope);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });
});

// ─── Unit: Key Management ─────────────────────────────────────────────────────

describe('Memo Key Manager - Key Versioning', () => {
  test('initializeKeyStorage creates version 1 if not exists', () => {
    const index = memoKeyManager.initializeKeyStorage();

    expect(index).toHaveProperty('activeVersion', 1);
    expect(index).toHaveProperty('keys');
    expect(index.keys).toHaveLength(1);
    expect(index.keys[0]).toHaveProperty('version', 1);
    expect(index.keys[0]).toHaveProperty('status', 'active');
  });

  test('getActiveKeyVersion returns current active version', () => {
    const version = memoKeyManager.getActiveKeyVersion();
    expect(typeof version).toBe('number');
    expect(version).toBeGreaterThan(0);
  });

  test('getKeyMaterial returns 32-byte buffer for valid version', () => {
    const material = memoKeyManager.getKeyMaterial(1);
    expect(Buffer.isBuffer(material)).toBe(true);
    expect(material.length).toBe(32);
  });

  test('getKeyMaterial throws for non-existent version', () => {
    expect(() => {
      memoKeyManager.getKeyMaterial(999);
    }).toThrow('Key version 999 not found');
  });

  test('getActiveKeyMaterial returns current key', () => {
    const material = memoKeyManager.getActiveKeyMaterial();
    expect(Buffer.isBuffer(material)).toBe(true);
    expect(material.length).toBe(32);
  });

  test('getAllKeyVersions returns all versions with metadata', () => {
    const versions = memoKeyManager.getAllKeyVersions();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toHaveProperty('version');
    expect(versions[0]).toHaveProperty('createdAt');
    expect(versions[0]).toHaveProperty('status');
  });
});

// ─── Integration: Key Rotation ────────────────────────────────────────────────

describe('Memo Key Manager - Key Rotation', () => {
  test('rotateKey creates new version and marks old as retired', () => {
    const oldVersion = memoKeyManager.getActiveKeyVersion();
    const newVersion = memoKeyManager.rotateKey();

    expect(newVersion).toBe(oldVersion + 1);
    expect(memoKeyManager.getActiveKeyVersion()).toBe(newVersion);

    const versions = memoKeyManager.getAllKeyVersions();
    const oldEntry = versions.find(v => v.version === oldVersion);
    const newEntry = versions.find(v => v.version === newVersion);

    expect(oldEntry.status).toBe('retired');
    expect(newEntry.status).toBe('active');
  });

  test('rotateKey multiple times maintains all versions', () => {
    const v1 = memoKeyManager.getActiveKeyVersion();
    const v2 = memoKeyManager.rotateKey();
    const v3 = memoKeyManager.rotateKey();

    const versions = memoKeyManager.getAllKeyVersions();
    expect(versions.length).toBe(3);
    expect(versions.map(v => v.version)).toEqual([v1, v2, v3]);
  });

  test('old key versions remain usable after rotation', () => {
    const oldVersion = memoKeyManager.getActiveKeyVersion();
    const oldMaterial = memoKeyManager.getKeyMaterial(oldVersion);

    memoKeyManager.rotateKey();

    const retrievedMaterial = memoKeyManager.getKeyMaterial(oldVersion);
    expect(retrievedMaterial).toEqual(oldMaterial);
  });
});

// ─── Integration: Versioned Ciphertext Serialization ──────────────────────────

describe('Memo Key Manager - Versioned Ciphertext', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('serializeVersionedCiphertext formats v<version>:<base64>', () => {
    const plaintext = 'Test';
    const envelope = encryptMemo(plaintext, keypair.publicKey);
    const versionedEncryption = {
      keyVersion: 1,
      encryptedEnvelope: envelope,
    };

    const serialized = memoKeyManager.serializeVersionedCiphertext(versionedEncryption);

    expect(serialized).toMatch(/^v1:/);
    expect(typeof serialized).toBe('string');
  });

  test('deserializeVersionedCiphertext recovers version and envelope', () => {
    const plaintext = 'Test';
    const envelope = encryptMemo(plaintext, keypair.publicKey);
    const versionedEncryption = {
      keyVersion: 2,
      encryptedEnvelope: envelope,
    };

    const serialized = memoKeyManager.serializeVersionedCiphertext(versionedEncryption);
    const deserialized = memoKeyManager.deserializeVersionedCiphertext(serialized);

    expect(deserialized.keyVersion).toBe(2);
    expect(deserialized.encryptedEnvelope).toEqual(envelope);
  });

  test('deserializeVersionedCiphertext rejects malformed ciphertext', () => {
    expect(() => {
      memoKeyManager.deserializeVersionedCiphertext('invalid');
    }).toThrow('Invalid versioned ciphertext format');

    expect(() => {
      memoKeyManager.deserializeVersionedCiphertext('v1:not-base64!!!');
    }).toThrow('Failed to deserialize');

    expect(() => {
      memoKeyManager.deserializeVersionedCiphertext(null);
    }).toThrow('Versioned ciphertext must be a string');
  });
});

// ─── Integration: Memo Encryption Service ─────────────────────────────────────

describe('Memo Encryption Service - Full Lifecycle', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('encryptMemoForRecipient encrypts and returns all required fields', () => {
    const plaintext = 'Service test memo';
    const result = MemoEncryptionService.encryptMemoForRecipient(
      plaintext,
      keypair.publicKey
    );

    expect(result).toHaveProperty('memoEnvelope');
    expect(result).toHaveProperty('memoHash');
    expect(result).toHaveProperty('encryptionMetadata');
    expect(result.encryptionMetadata).toHaveProperty('keyVersion');
    expect(result.encryptionMetadata).toHaveProperty('algorithm');
    expect(result.encryptionMetadata).toHaveProperty('createdAt');
  });

  test('decryptMemoForRecipient recovers plaintext', () => {
    const plaintext = 'Service decrypt test';
    const encrypted = MemoEncryptionService.encryptMemoForRecipient(
      plaintext,
      keypair.publicKey
    );
    const decrypted = MemoEncryptionService.decryptMemoForRecipient(
      encrypted.memoEnvelope,
      keypair.secretKey
    );

    expect(decrypted).toBe(plaintext);
  });

  test('decryptMemoForRecipient rejects with wrong secret', () => {
    const plaintext = 'Protection test';
    const encrypted = MemoEncryptionService.encryptMemoForRecipient(
      plaintext,
      keypair.publicKey
    );

    const wrongKeypair = generateTestStellarKeyPair();
    expect(() => {
      MemoEncryptionService.decryptMemoForRecipient(
        encrypted.memoEnvelope,
        wrongKeypair.secretKey
      );
    }).toThrow();
  });

  test('encryptMemoForRecipient rejects invalid recipient address', () => {
    expect(() => {
      MemoEncryptionService.encryptMemoForRecipient('Test', 'not-a-stellar-address');
    }).toThrow('Invalid Stellar recipient address');
  });

  test('getEncryptionStatus reports encryption metrics', () => {
    const status = MemoEncryptionService.getEncryptionStatus([]);

    expect(status).toHaveProperty('activeVersion');
    expect(status).toHaveProperty('allVersions');
    expect(status).toHaveProperty('memosEncryptedCount');
    expect(status).toHaveProperty('memosUsingOldVersions');
    expect(status).toHaveProperty('rotationRequired');
  });
});

// ─── Integration: Key Rotation Workflow ────────────────────────────────────────

describe('Memo Encryption Service - Key Rotation Workflow', () => {
  let keypair;
  let transactionRecords;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();

    // Create sample transaction records with encrypted memos
    const encrypted1 = MemoEncryptionService.encryptMemoForRecipient(
      'First memo',
      keypair.publicKey
    );

    const encrypted2 = MemoEncryptionService.encryptMemoForRecipient(
      'Second memo',
      keypair.publicKey
    );

    transactionRecords = [
      {
        id: 'tx1',
        memoEnvelope: encrypted1.memoEnvelope,
        encryptionMetadata: encrypted1.encryptionMetadata,
        recipient: keypair.publicKey,
      },
      {
        id: 'tx2',
        memoEnvelope: encrypted2.memoEnvelope,
        encryptionMetadata: encrypted2.encryptionMetadata,
        recipient: keypair.publicKey,
      },
      {
        id: 'tx3',
        // No memo
      },
    ];
  });

  test('initiateKeyRotation creates new key version', () => {
    const oldVersion = memoKeyManager.getActiveKeyVersion();
    const result = MemoEncryptionService.initiateKeyRotation();

    expect(result).toHaveProperty('status', 'initiated');
    expect(result.newVersion).toBe(oldVersion + 1);
    expect(result.previousVersion).toBe(oldVersion);
  });

  test('getMemosToReencrypt identifies memos with old version', () => {
    const oldVersion = memoKeyManager.getActiveKeyVersion();
    MemoEncryptionService.initiateKeyRotation();

    const toReencrypt = MemoEncryptionService.getMemosToReencrypt(
      transactionRecords,
      oldVersion
    );

    expect(toReencrypt.length).toBe(2);
    expect(toReencrypt.map(t => t.id)).toEqual(['tx1', 'tx2']);
  });

  test('getMemosToReencrypt returns empty when no old versions exist', () => {
    MemoEncryptionService.initiateKeyRotation();

    const toReencrypt = MemoEncryptionService.getMemosToReencrypt(
      transactionRecords,
      999 // Non-existent version
    );

    expect(toReencrypt.length).toBe(0);
  });

  test('reencryptMemoToLatestVersion updates memo to new version', () => {
    const oldVersion = memoKeyManager.getActiveKeyVersion();
    MemoEncryptionService.initiateKeyRotation();
    const newVersion = memoKeyManager.getActiveKeyVersion();

    const updated = MemoEncryptionService.reencryptMemoToLatestVersion(
      transactionRecords[0],
      keypair.secretKey
    );

    expect(updated.encryptionMetadata.keyVersion).toBe(newVersion);
    expect(updated.previousKeyVersion).toBe(oldVersion);
    // Check that the metadata was updated
    expect(updated).toHaveProperty('memoEnvelope');
    expect(updated).toHaveProperty('encryptionMetadata');
  });

  test('reencryptMemoToLatestVersion skips memos already at latest', () => {
    const updated = MemoEncryptionService.reencryptMemoToLatestVersion(
      transactionRecords[0],
      keypair.secretKey
    );

    const currentVersion = memoKeyManager.getActiveKeyVersion();
    expect(updated.encryptionMetadata.keyVersion).toBe(currentVersion);
  });

  test('reencryptMemoToLatestVersion fails without memo', () => {
    const recordWithoutMemo = { id: 'tx3' };

    expect(() => {
      MemoEncryptionService.reencryptMemoToLatestVersion(
        recordWithoutMemo,
        keypair.secretKey
      );
    }).toThrow();
  });
});

// ─── Edge Cases and Security ──────────────────────────────────────────────────

describe('Memo Encryption - Security and Edge Cases', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('encryption provides forward secrecy (ephemeral keys)', () => {
    const plaintext = 'Forward secrecy test';
    const envelope1 = encryptMemo(plaintext, keypair.publicKey);
    const envelope2 = encryptMemo(plaintext, keypair.publicKey);

    // Different ephemeral keys should produce different ciphertexts
    expect(envelope1.ephemeralPublicKey).not.toBe(envelope2.ephemeralPublicKey);
  });

  test('encryption provides AEAD authentication', () => {
    const plaintext = 'Auth test';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    // Modify associated data in the envelope
    const modified = { ...envelope, salt: Buffer.alloc(32).toString('base64') };

    expect(() => {
      decryptMemo(modified, keypair.secretKey);
    }).toThrow('Decryption failed');
  });

  test('key manager maintains isolation between versions', () => {
    const v1Material = memoKeyManager.getKeyMaterial(1);
    memoKeyManager.rotateKey();
    const v2Material = memoKeyManager.getKeyMaterial(2);

    // Each version should have unique key material
    expect(v1Material).not.toEqual(v2Material);
  });

  test('decryption fails gracefully with corrupted env envelope', () => {
    const envelope = {
      v: 1,
      alg: 'ECDH-X25519-AES256GCM',
      ephemeralPublicKey: 'not-valid-base64!!!',
      salt: 'test',
      iv: 'test',
      ciphertext: 'test',
      authTag: 'test',
    };

    expect(() => {
      decryptMemo(envelope, keypair.secretKey);
    }).toThrow();
  });

  test('Stellar key conversion is consistent', () => {
    const publicKeyBytes = decodeStellarPublicKey(keypair.publicKey);
    expect(publicKeyBytes.length).toBe(32);

    const secretKeyBytes = decodeStellarSecretKey(keypair.secretKey);
    expect(secretKeyBytes.length).toBe(32);
  });
});

// ─── Performance and Stress Tests ─────────────────────────────────────────────

describe('Memo Encryption - Performance', () => {
  let keypair;

  beforeEach(() => {
    keypair = generateTestStellarKeyPair();
  });

  test('encryption completes within acceptable time for typical memo', () => {
    const plaintext = 'Typical memo of moderate length';
    const startTime = Date.now();

    encryptMemo(plaintext, keypair.publicKey);

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(100); // Should complete in < 100ms
  });

  test('decryption completes within acceptable time', () => {
    const plaintext = 'Test message';
    const envelope = encryptMemo(plaintext, keypair.publicKey);

    const startTime = Date.now();
    decryptMemo(envelope, keypair.secretKey);
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(100); // Should complete in < 100ms
  });

  test('key rotation completes quickly', () => {
    const startTime = Date.now();

    memoKeyManager.rotateKey();

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(50); // Should complete in < 50ms
  });
});

describe('Memo Encryption - Multi-Recipient Support', () => {
  test('Same plaintext can be encrypted for multiple recipients', () => {
    const plaintext = 'Shared message';
    const keypair1 = generateTestStellarKeyPair();
    const keypair2 = generateTestStellarKeyPair();

    const envelope1 = encryptMemo(plaintext, keypair1.publicKey);
    const envelope2 = encryptMemo(plaintext, keypair2.publicKey);

    // Each recipient decrypt their own
    expect(decryptMemo(envelope1, keypair1.secretKey)).toBe(plaintext);
    expect(decryptMemo(envelope2, keypair2.secretKey)).toBe(plaintext);

    // Cross-recipient decryption fails
    expect(() => {
      decryptMemo(envelope1, keypair2.secretKey);
    }).toThrow();
  });
});
