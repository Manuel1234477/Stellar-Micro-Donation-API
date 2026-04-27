/**
 * Request Decryption Middleware
 *
 * RESPONSIBILITY: Transparently decrypt hybrid-encrypted request bodies
 * OWNER: Security Team
 * DEPENDENCIES: EncryptionService
 *
 * Usage:
 *   // Require encryption on a specific route:
 *   router.post('/sensitive', requireEncryption(), handler);
 *
 *   // Optionally decrypt if X-Encrypted header is present:
 *   router.post('/optional', decryptIfEncrypted(), handler);
 *
 * After decryption, req.body is replaced with the plain-text parsed object
 * so downstream handlers are unaware of the encryption layer.
 */

'use strict';

const encryptionService = require('../services/EncryptionService');
const { ValidationError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

/**
 * Middleware factory: require that the request body is encrypted.
 * Returns 400 if the X-Encrypted header is absent or decryption fails.
 *
 * @returns {Function} Express middleware
 */
function requireEncryption() {
  return (req, res, next) => {
    const isEncrypted = req.headers['x-encrypted'] === 'true';

    if (!isEncrypted) {
      return next(
        new ValidationError(
          'This endpoint requires an encrypted request body. Set X-Encrypted: true and encrypt the body using the server public key from GET /encryption/public-key.',
          null,
          ERROR_CODES.INVALID_REQUEST
        )
      );
    }

    _decrypt(req, next);
  };
}

/**
 * Middleware factory: decrypt the request body only when X-Encrypted: true is present.
 * Passes through unencrypted requests unchanged.
 *
 * @returns {Function} Express middleware
 */
function decryptIfEncrypted() {
  return (req, res, next) => {
    if (req.headers['x-encrypted'] !== 'true') {
      return next();
    }
    _decrypt(req, next);
  };
}

/**
 * Shared decryption logic.
 * @private
 */
function _decrypt(req, next) {
  try {
    const payload = req.body;

    if (!payload || typeof payload !== 'object') {
      throw new ValidationError(
        'Encrypted request body must be a JSON object with fields: encryptedKey, iv, ciphertext, authTag',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const decrypted = encryptionService.decrypt(payload);

    log.debug('REQUEST_DECRYPTION', 'Request body decrypted successfully', {
      path: req.path,
      method: req.method,
    });

    req.body = decrypted;
    next();
  } catch (err) {
    log.warn('REQUEST_DECRYPTION', 'Decryption failed', {
      path: req.path,
      method: req.method,
      error: err.message,
    });

    next(
      new ValidationError(
        `Request body decryption failed: ${err.message}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      )
    );
  }
}

module.exports = { requireEncryption, decryptIfEncrypted };
