# Request Body Encryption

## Overview

For highly sensitive operations (wallet creation, key management), request bodies can be encrypted end-to-end using hybrid encryption. This ensures that even TLS-terminating proxies cannot read sensitive request data.

## Encryption Scheme

Hybrid encryption combines the key-exchange efficiency of asymmetric cryptography with the speed of symmetric encryption:

1. Client fetches the server's RSA-2048 public key from `GET /encryption/public-key`.
2. Client generates a random 256-bit AES key and 96-bit IV.
3. Client encrypts the request body with **AES-256-GCM** → produces `ciphertext` + `authTag`.
4. Client encrypts the AES key with the server's public key using **RSA-OAEP/SHA-256** → `encryptedKey`.
5. Client sends the encrypted payload with header `X-Encrypted: true`.
6. Server decrypts the AES key with its RSA private key, then decrypts the body.

```
Client                                    Server
  │                                          │
  │── GET /encryption/public-key ──────────► │
  │◄── { publicKey, fingerprint } ──────────│
  │                                          │
  │  generate aesKey (32 bytes random)       │
  │  generate iv     (12 bytes random)       │
  │  ciphertext, authTag = AES-256-GCM(body, aesKey, iv)
  │  encryptedKey = RSA-OAEP(aesKey, publicKey)
  │                                          │
  │── POST /wallets ────────────────────────►│
  │   X-Encrypted: true                      │
  │   { encryptedKey, iv, ciphertext, authTag }
  │                                          │  aesKey = RSA-OAEP-decrypt(encryptedKey)
  │                                          │  body   = AES-256-GCM-decrypt(ciphertext)
  │◄── { success: true, data: ... } ─────── │
```

## API

### `GET /encryption/public-key`

Returns the server's RSA-2048 public key. No authentication required.

```json
{
  "success": true,
  "data": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "algorithm": "RSA-OAEP-SHA256 + AES-256-GCM",
    "keySize": 2048,
    "fingerprint": "a3f1..."
  }
}
```

Pin the `fingerprint` (SHA-256 of the DER-encoded public key) to detect key rotation.

### Encrypted Request Format

Set `X-Encrypted: true` and send the following JSON body:

| Field          | Type   | Description                                      |
|----------------|--------|--------------------------------------------------|
| `encryptedKey` | string | Base64 RSA-OAEP encrypted AES-256 key            |
| `iv`           | string | Base64 96-bit (12-byte) AES-GCM IV               |
| `ciphertext`   | string | Base64 AES-256-GCM encrypted request body        |
| `authTag`      | string | Base64 16-byte GCM authentication tag            |

### Middleware

Two middleware factories are available:

```js
const { requireEncryption, decryptIfEncrypted } = require('./middleware/requestDecryption');

// Mandatory — returns 400 if X-Encrypted header is absent
router.post('/wallets', requireEncryption(), handler);

// Optional — decrypts if X-Encrypted: true, passes through otherwise
router.post('/donations', decryptIfEncrypted(), handler);
```

## Client Example (Node.js)

```js
const crypto = require('crypto');
const axios = require('axios');

async function encryptedPost(url, body) {
  // 1. Fetch public key
  const { data: { data: { publicKey } } } = await axios.get('/encryption/public-key');

  // 2. Generate AES key + IV
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // 3. Encrypt body with AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // 4. Encrypt AES key with RSA-OAEP
  const encryptedKey = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey
  );

  // 5. Send encrypted request
  return axios.post(url, {
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  }, { headers: { 'X-Encrypted': 'true' } });
}
```

## Security Assumptions

- **Nonce reuse prevention**: Each request generates a fresh random AES key and IV. Reuse is statistically impossible (96-bit random IV).
- **Integrity**: AES-256-GCM provides authenticated encryption. Any tampering with the ciphertext or auth tag causes decryption to fail with a 400 error.
- **Key rotation**: The server key pair is generated once per process. To rotate, set `ENCRYPTION_PRIVATE_KEY` and `ENCRYPTION_PUBLIC_KEY` environment variables and restart. Clients detect rotation via the `fingerprint` field.
- **Private key confidentiality**: The RSA private key never leaves the server process and is never logged or serialised.
- **Defense in depth**: This layer supplements TLS — it does not replace it. Always deploy behind HTTPS.

## Running the Migration

No database migration required. The key pair is generated in memory at startup.

To inject a pre-generated key pair (recommended for production):

```bash
export ENCRYPTION_PRIVATE_KEY="$(cat private.pem)"
export ENCRYPTION_PUBLIC_KEY="$(cat public.pem)"
```
