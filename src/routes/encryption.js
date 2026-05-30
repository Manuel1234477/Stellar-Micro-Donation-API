/**
 * Encryption Routes - Public Key Distribution
 *
 * RESPONSIBILITY: Serve the server's RSA public key for client-side encryption
 * OWNER: Security Team
 * DEPENDENCIES: EncryptionService
 *
 * Endpoints:
 *   GET /encryption/public-key  – return RSA public key + fingerprint
 */

'use strict';

const express = require('express');
const router = express.Router();
const encryptionService = require('../services/EncryptionService');

/**
 * GET /encryption/public-key
 * Return the server's RSA-2048 public key in PEM format.
 * Clients use this key to encrypt the AES session key (RSA-OAEP/SHA-256).
 *
 * @returns {{ success: boolean, data: { publicKey: string, algorithm: string, fingerprint: string } }}
 */
router.get('/public-key', (req, res) => {
  const publicKey = encryptionService.getPublicKey();
  const fingerprint = encryptionService.getPublicKeyFingerprint();

  res.json({
    success: true,
    data: {
      publicKey,
      algorithm: 'RSA-OAEP-SHA256 + AES-256-GCM',
      keySize: 2048,
      fingerprint,
    },
  });
});

module.exports = router;
