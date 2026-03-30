# Stellar Transaction Memo Encryption

## Overview

Stellar transaction memos are publicly visible on the blockchain. This feature adds optional end-to-end encryption of memos so that only the intended recipient (the holder of the destination Stellar secret key) can read them.

Encryption uses **ECDH key exchange** (X25519) derived from the recipient's Stellar keypair, combined with **AES-256-GCM** authenticated encryption. The encrypted memo and its metadata are stored in the API database alongside the transaction record.

---

## Security Model

| Property | Guarantee |
|---|---|
| **Confidentiality** | Only the recipient (holder of the Stellar secret key) can decrypt |
| **Integrity** | AES-GCM authentication tag detects any tampering |
| **Forward secrecy** | Each encryption uses a fresh ephemeral X25519 key pair |
| **Non-repudiation** | Envelope hash can be stored on-chain as `MEMO_HASH` |

> **Production warning:** The `GET /donations/:id/memo/decrypt` endpoint accepts a Stellar secret key as a query parameter. In production, **memo decryption should be performed client-side** so that private keys never leave the user's device. This endpoint is provided for server-side integrations and testing only.

---

## Key Derivation: Ed25519 → X25519

Stellar accounts use **Ed25519** keys, but ECDH requires **X25519** (Montgomery curve). The standard conversion (used by Signal, age, and libsodium) is applied:

**Public key conversion** — Edwards→Montgomery birational map:
```
u = (1 + y) / (1 - y)  mod p      where p = 2^255 - 19
```
The Ed25519 public key stores the y-coordinate in little-endian with the sign of x in bit 255.

**Private key derivation** — SHA-512 + RFC 7748 clamping:
```
x25519_scalar = SHA-512(stellar_seed)[0:32]
x25519_scalar[0]  &= 248   // clear bits 0,1,2
x25519_scalar[31] &= 127   // clear bit 7
x25519_scalar[31] |= 64    // set bit 6
```

This ensures `ECDH(enc_eph_priv, recipient_x25519_pub) == ECDH(recipient_x25519_priv, enc_eph_pub)`.

---

## Encryption Algorithm

```
ECDH-X25519-AES256GCM
```

Full flow:
1. Convert recipient's Ed25519 Stellar public key → X25519 public key
2. Generate one-time ephemeral X25519 key pair
3. `shared_secret = X25519(ephemeral_priv, recipient_x25519_pub)`
4. `aes_key = HKDF-SHA256(shared_secret, random_salt, "stellar-memo-encryption-v1", 32)`
5. `(ciphertext, auth_tag) = AES-256-GCM(aes_key, random_iv, plaintext)`

---

## Envelope Format

The encryption result is a JSON object stored on the transaction record:

```json
{
  "v": 1,
  "alg": "ECDH-X25519-AES256GCM",
  "ephemeralPublicKey": "<base64, 32 bytes>",
  "salt": "<base64, 32 bytes>",
  "iv": "<base64, 12 bytes>",
  "ciphertext": "<base64>",
  "authTag": "<base64, 16 bytes>"
}
```

| Field | Description |
|---|---|
| `v` | Envelope version (currently `1`) |
| `alg` | Algorithm identifier |
| `ephemeralPublicKey` | One-time sender public key for ECDH |
| `salt` | Random HKDF salt (unique per encryption) |
| `iv` | AES-GCM nonce (unique per encryption) |
| `ciphertext` | Encrypted memo bytes |
| `authTag` | GCM authentication tag (16 bytes) |

---

## API Changes

### POST /donations — new `encryptMemo` field

Add `"encryptMemo": true` to the request body to encrypt the memo before storing it.

**Request:**
```http
POST /donations
X-API-Key: <key>
X-Idempotency-Key: <unique-key>
Content-Type: application/json

{
  "amount": "10.00",
  "currency": "XLM",
  "recipient": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "donor": "GCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "memo": "private donation note",
  "encryptMemo": true
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "transactionHash": "txn-1234567890-abc",
    "encryptionMetadata": {
      "encrypted": true,
      "algorithm": "ECDH-X25519-AES256GCM",
      "nonce": "<base64 iv>"
    }
  }
}
```

If `encryptMemo` is omitted or `false`, no encryption is applied and `encryptionMetadata` is absent from the response.

---

### GET /donations/:id/memo/decrypt

Decrypt the encrypted memo for a donation. Requires the recipient's Stellar secret key.

**Request:**
```http
GET /donations/txn-1234567890-abc/memo/decrypt?recipientSecret=SXXXXXXXXXX
X-API-Key: <key>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "donationId": "txn-1234567890-abc",
    "memo": "private donation note",
    "algorithm": "ECDH-X25519-AES256GCM"
  }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| `400` | `MISSING_FIELD` | `recipientSecret` query param absent |
| `403` | `DECRYPTION_FAILED` | Wrong key or tampered ciphertext |
| `404` | `NOT_FOUND` | Donation ID does not exist |
| `422` | `MEMO_NOT_ENCRYPTED` | Donation has no encrypted memo |

---

## Implementation

| File | Change |
|---|---|
| `src/utils/memoEncryption.js` | New — ECDH encryption/decryption utility |
| `src/routes/donation.js` | `encryptMemo` field in schema + POST handler + decrypt endpoint |
| `src/routes/models/transaction.js` | `encryptionMetadata` and `memoEnvelope` fields added to `create()` |

---

## Running the Tests

```bash
# Run only the memo encryption tests
npm test tests/add-stellar-transaction-memo-encryption.test.js

# With coverage
npm run test:coverage -- --testPathPattern=add-stellar-transaction-memo-encryption
```

No live Stellar network is required. All tests run with `MOCK_STELLAR=true`.

---

## Performance Tuning

- **Key derivation** uses modular exponentiation (Fermat's little theorem) for the Ed25519→X25519 conversion. This is computed once per encryption/decryption and takes < 5 ms in Node.js.
- **HKDF** uses Node's built-in `crypto.hkdfSync` (Node 15+) or falls back to a manual HMAC-SHA256 implementation.
- The ephemeral X25519 key pair generation via `crypto.generateKeyPairSync('x25519')` is fast (< 1 ms).
- Total encryption overhead per memo is typically **< 10 ms**.
