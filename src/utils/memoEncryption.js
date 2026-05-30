/**
 * MemoEncryption - ECDH-based memo encryption for Stellar transactions
 *
 * Uses X25519 ECDH key exchange so only the intended recipient
 * (holder of the Stellar private key) can decrypt the memo.
 *
 * Encryption flow:
 *   1. Convert recipient's Ed25519 Stellar public key → X25519 via birational map:
 *      u = (1+y)/(1-y) mod p  where p = 2^255-19
 *   2. Generate ephemeral X25519 key pair
 *   3. ECDH(ephemeral_priv, recipient_x25519_pub) → shared secret
 *   4. HKDF-SHA256(shared_secret, random_salt, info) → 32-byte AES key
 *   5. AES-256-GCM encrypt the plaintext memo
 *   6. Return envelope { v, alg, ephemeralPublicKey, salt, iv, ciphertext, authTag }
 *
 * Decryption flow (recipient only):
 *   1. Derive X25519 scalar: SHA-512(stellar_seed)[0:32] + RFC 7748 clamping
 *   2. ECDH(recipient_x25519_priv, ephemeral_pub) → same shared secret
 *   3. Re-derive AES key via same HKDF params
 *   4. AES-256-GCM decrypt
 *
 * The Ed25519→X25519 conversion is the standard technique used by Signal,
 * age encryption, and libsodium's crypto_sign_ed25519_pk_to_curve25519.
 *
 * @module memoEncryption
 */
'use strict';

const crypto = require('crypto');

const ALGORITHM = 'ECDH-X25519-AES256GCM';
const ENVELOPE_VERSION = 1;
const HKDF_INFO = Buffer.from('stellar-memo-encryption-v1');

// Curve25519 prime p = 2^255 - 19
const P = (BigInt(1) << BigInt(255)) - BigInt(19);

// ─── Field arithmetic ────────────────────────────────────────────────────────

/**
 * Modular inverse of a mod p via Fermat's little theorem: a^(p-2) mod p.
 * @param {bigint} a
 * @returns {bigint}
 */
function modInverse(a) {
  const exp = P - BigInt(2);
  let result = BigInt(1);
  let base = ((a % P) + P) % P;
  let e = exp;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * base) % P;
    base = (base * base) % P;
    e >>= BigInt(1);
  }
  return result;
}

/**
 * Read a 32-byte little-endian Buffer as a BigInt.
 * @param {Buffer} buf
 * @returns {bigint}
 */
function bufToBigIntLE(buf) {
  let n = BigInt(0);
  for (let i = buf.length - 1; i >= 0; i--) n = (n << BigInt(8)) | BigInt(buf[i]);
  return n;
}

/**
 * Write a BigInt as a 32-byte little-endian Buffer.
 * @param {bigint} n
 * @returns {Buffer}
 */
function bigIntToBufLE(n) {
  const out = Buffer.alloc(32);
  let v = n;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

// ─── Key conversion ──────────────────────────────────────────────────────────

/**
 * Convert an Ed25519 public key (32 bytes) to an X25519 public key (32 bytes).
 *
 * The Ed25519 encoding stores the Edwards y-coordinate in little-endian with
 * the sign of x packed into bit 255. The X25519 Montgomery u-coordinate is:
 *   u = (1 + y) / (1 - y) mod p
 *
 * @param {Buffer} ed25519PubBytes - 32-byte Ed25519 public key
 * @returns {Buffer} 32-byte X25519 u-coordinate (little-endian)
 */
function ed25519PubToX25519(ed25519PubBytes) {
  const yBytes = Buffer.from(ed25519PubBytes);
  yBytes[31] &= 0x7f; // clear sign bit to isolate y-coordinate
  const y = bufToBigIntLE(yBytes);
  const num = (BigInt(1) + y) % P;
  const den = ((BigInt(1) - y) % P + P) % P;
  return bigIntToBufLE((num * modInverse(den)) % P);
}

/**
 * Derive an X25519 private scalar from an Ed25519 seed.
 *
 * Standard technique: SHA-512(seed)[0:32] with RFC 7748 §5 clamping.
 * This is the same scalar used internally by Ed25519 for signing, making
 * the X25519 public key consistent with the Ed25519 public key via the
 * birational map above.
 *
 * @param {Buffer} ed25519Seed - 32-byte Ed25519 private seed
 * @returns {Buffer} 32-byte clamped X25519 scalar
 */
function ed25519SeedToX25519(ed25519Seed) {
  const hash = crypto.createHash('sha512').update(ed25519Seed).digest();
  const scalar = Buffer.from(hash.subarray(0, 32));
  scalar[0] &= 248;   // clear bits 0, 1, 2
  scalar[31] &= 127;  // clear bit 7 (bit 255)
  scalar[31] |= 64;   // set bit 6 (bit 254)
  return scalar;
}

// ─── Node.js KeyObject helpers ───────────────────────────────────────────────

/**
 * Wrap 32 raw bytes as an X25519 public KeyObject using SPKI DER encoding.
 *
 * SPKI DER structure for X25519 (RFC 8410):
 *   SEQUENCE { SEQUENCE { OID 1.3.101.110 } BIT_STRING { 0x00 <32 bytes> } }
 *   Hex prefix: 302a300506032b656e032100
 *
 * @param {Buffer} rawKey - 32-byte key
 * @returns {crypto.KeyObject}
 */
function wrapX25519PublicKey(rawKey) {
  const spki = Buffer.concat([
    Buffer.from('302a300506032b656e032100', 'hex'),
    rawKey,
  ]);
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

/**
 * Wrap 32 raw bytes as an X25519 private KeyObject using PKCS#8 DER encoding.
 *
 * PKCS#8 DER structure for X25519 (RFC 8410):
 *   SEQUENCE { INTEGER 0  SEQUENCE { OID 1.3.101.110 }
 *              OCTET_STRING { OCTET_STRING { <32 bytes> } } }
 *   Hex prefix: 302e020100300506032b656e04220420
 *
 * @param {Buffer} rawKey - 32-byte key
 * @returns {crypto.KeyObject}
 */
function wrapX25519PrivateKey(rawKey) {
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b656e04220420', 'hex'),
    rawKey,
  ]);
  return crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

/**
 * Export an X25519 public KeyObject to its raw 32-byte form.
 * The raw key is the last 32 bytes of the SPKI DER encoding.
 *
 * @param {crypto.KeyObject} keyObj
 * @returns {Buffer}
 */
function exportX25519PublicKeyRaw(keyObj) {
  const spki = keyObj.export({ type: 'spki', format: 'der' });
  return spki.slice(spki.length - 32);
}

// ─── Stellar StrKey helpers ──────────────────────────────────────────────────

/**
 * Decode a Stellar G... address to raw 32-byte Ed25519 public key bytes.
 *
 * @param {string} address - Stellar public key address (G...)
 * @returns {Buffer} 32-byte raw public key
 * @throws {Error} if the address is not a valid Stellar public key
 */
function decodeStellarPublicKey(address) {
  if (typeof address !== 'string' || !address.startsWith('G')) {
    throw new Error('Invalid Stellar public key: must be a G... address');
  }
  try {
    const { StrKey } = require('stellar-sdk');
    return Buffer.from(StrKey.decodeEd25519PublicKey(address));
  } catch (err) {
    throw new Error(`Invalid Stellar public key: ${err.message}`);
  }
}

/**
 * Decode a Stellar S... secret key to raw 32-byte Ed25519 seed bytes.
 *
 * @param {string} secret - Stellar secret key (S...)
 * @returns {Buffer} 32-byte raw seed
 * @throws {Error} if the secret is not a valid Stellar secret key
 */
function decodeStellarSecretKey(secret) {
  if (typeof secret !== 'string' || !secret.startsWith('S')) {
    throw new Error('Invalid Stellar secret key: must be an S... key');
  }
  try {
    const { StrKey } = require('stellar-sdk');
    return Buffer.from(StrKey.decodeEd25519SecretSeed(secret));
  } catch (err) {
    throw new Error(`Invalid Stellar secret key: ${err.message}`);
  }
}

// ─── HKDF (with Node 15+ hkdfSync and manual fallback) ───────────────────────

/**
 * Derive a key using HKDF-SHA256.
 * Uses crypto.hkdfSync when available (Node 15+), otherwise falls back to
 * a manual HKDF implementation using HMAC-SHA256.
 *
 * @param {Buffer} ikm   - Input keying material (shared secret)
 * @param {Buffer} salt  - Random salt
 * @param {Buffer} info  - Context/application info
 * @param {number} len   - Output length in bytes
 * @returns {Buffer}
 */
function hkdf(ikm, salt, info, len) {
  if (typeof crypto.hkdfSync === 'function') {
    return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
  }
  // Manual HKDF-SHA256 (RFC 5869)
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const blocks = [];
  let prev = Buffer.alloc(0);
  const n = Math.ceil(len / 32);
  for (let i = 1; i <= n; i++) {
    prev = crypto.createHmac('sha256', prk)
      .update(Buffer.concat([prev, info, Buffer.from([i])]))
      .digest();
    blocks.push(prev);
  }
  return Buffer.concat(blocks).slice(0, len);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Encrypt a memo for a specific Stellar recipient.
 * Only the holder of the corresponding Stellar secret key can decrypt the result.
 *
 * @param {string} plaintext - Memo text to encrypt
 * @param {string} recipientStellarAddress - Recipient's Stellar public key (G...)
 * @returns {MemoEnvelope} Serialisable encryption envelope
 *
 * @typedef {Object} MemoEnvelope
 * @property {number} v                   - Envelope version (1)
 * @property {string} alg                 - Algorithm ('ECDH-X25519-AES256GCM')
 * @property {string} ephemeralPublicKey  - Base64 ephemeral X25519 public key (32 bytes)
 * @property {string} salt                - Base64 HKDF salt (32 bytes)
 * @property {string} iv                  - Base64 AES-GCM nonce (12 bytes)
 * @property {string} ciphertext          - Base64 AES-GCM ciphertext
 * @property {string} authTag             - Base64 GCM authentication tag (16 bytes)
 */
function encryptMemo(plaintext, recipientStellarAddress) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('plaintext must be a non-empty string');
  }

  // Convert recipient Stellar public key → X25519 public key
  const ed25519Pub = decodeStellarPublicKey(recipientStellarAddress);
  const x25519Pub = ed25519PubToX25519(ed25519Pub);
  const recipientPubKey = wrapX25519PublicKey(x25519Pub);

  // Generate one-time ephemeral X25519 key pair
  const { privateKey: ephPrivKey, publicKey: ephPubKey } =
    crypto.generateKeyPairSync('x25519');

  // ECDH: compute shared secret
  const sharedSecret = crypto.diffieHellman({
    privateKey: ephPrivKey,
    publicKey: recipientPubKey,
  });

  // Derive 32-byte AES key via HKDF-SHA256
  const salt = crypto.randomBytes(32);
  const derivedKey = hkdf(sharedSecret, salt, HKDF_INFO, 32);

  // Encrypt with AES-256-GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM,
    ephemeralPublicKey: exportX25519PublicKeyRaw(ephPubKey).toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext,
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt a memo envelope using the recipient's Stellar secret key.
 * Throws if the key is wrong or the envelope has been tampered with.
 *
 * @param {MemoEnvelope|string} envelope - Envelope object or JSON string
 * @param {string} recipientStellarSecret - Recipient's Stellar secret key (S...)
 * @returns {string} Decrypted plaintext memo
 * @throws {Error} on wrong key, tampered data, or unsupported envelope format
 */
function decryptMemo(envelope, recipientStellarSecret) {
  const env = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;

  if (env.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: ${env.v}`);
  }
  if (env.alg !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${env.alg}`);
  }

  // Derive recipient X25519 private key from Stellar seed
  const ed25519Seed = decodeStellarSecretKey(recipientStellarSecret);
  const x25519Scalar = ed25519SeedToX25519(ed25519Seed);
  const recipientPrivKey = wrapX25519PrivateKey(x25519Scalar);

  // Reconstruct ephemeral public key from envelope
  const ephPubKey = wrapX25519PublicKey(
    Buffer.from(env.ephemeralPublicKey, 'base64')
  );

  // ECDH: compute same shared secret
  const sharedSecret = crypto.diffieHellman({
    privateKey: recipientPrivKey,
    publicKey: ephPubKey,
  });

  // Re-derive AES key
  const derivedKey = hkdf(
    sharedSecret,
    Buffer.from(env.salt, 'base64'),
    HKDF_INFO,
    32
  );

  // AES-256-GCM decrypt (auth tag validates integrity + authenticity)
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      derivedKey,
      Buffer.from(env.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(env.authTag, 'base64'));
    let plaintext = decipher.update(env.ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    throw new Error('Decryption failed: invalid key or tampered ciphertext');
  }
}

/**
 * Encrypt a memo with key versioning for AES-256-GCM based encryption.
 * Each encryption operation associates a keyVersion that will be included in the output.
 *
 * @param {string|MemoEnvelope} plaintext - Plaintext memo to encrypt
 * @param {number} keyVersion - Key version identifier (e.g., 1, 2, 3...)
 * @param {string} recipientStellarAddress - Recipient's Stellar public key (G...)
 * @returns {Object} { keyVersion, encryptedEnvelope }
 */
function encryptMemoWithVersion(plaintext, keyVersion, recipientStellarAddress) {
  if (typeof keyVersion !== 'number' || keyVersion < 1) {
    throw new Error('keyVersion must be a positive number');
  }
  const envelope = encryptMemo(plaintext, recipientStellarAddress);
  return {
    keyVersion,
    encryptedEnvelope: envelope,
    keyVersionPrefix: `v${keyVersion}`,
  };
}

/**
 * Decrypt an envelope assuming the recipient has access to the correct key version.
 * The recipient uses their Stellar secret key (which never changes) to decrypt,
 * so key versioning is transparent to the decryption process.
 *
 * @param {MemoEnvelope|string} envelope - Encrypted envelope
 * @param {string} recipientStellarSecret - Recipient's Stellar secret key (S...)
 * @returns {string} Decrypted plaintext
 */
function decryptMemoWithVersion(envelope, recipientStellarSecret) {
  return decryptMemo(envelope, recipientStellarSecret);
}

/**
 * Return true if the given value appears to be a valid MemoEnvelope.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isEncryptedMemoEnvelope(value) {
  const check = (obj) =>
    obj !== null &&
    typeof obj === 'object' &&
    obj.v === ENVELOPE_VERSION &&
    obj.alg === ALGORITHM;

  if (typeof value === 'object') return check(value);
  if (typeof value === 'string') {
    try { return check(JSON.parse(value)); } catch { return false; }
  }
  return false;
}

/**
 * Compute a SHA-256 hash of the envelope suitable for on-chain MEMO_HASH storage.
 * Provides an immutable, verifiable on-chain reference without revealing the memo.
 *
 * @param {MemoEnvelope} envelope
 * @returns {string} 64-character hex digest
 */
function envelopeToMemoHash(envelope) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(envelope), 'utf8')
    .digest('hex');
}

module.exports = {
  encryptMemo,
  decryptMemo,
  encryptMemoWithVersion,
  decryptMemoWithVersion,
  isEncryptedMemoEnvelope,
  envelopeToMemoHash,
  // Exported for unit testing
  ed25519PubToX25519,
  ed25519SeedToX25519,
  decodeStellarPublicKey,
  decodeStellarSecretKey,
};
