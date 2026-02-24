/**
 * Idempotency Middleware
 * Ensures donation requests are processed only once
 * 
 * Usage:
 *   router.post('/donations', requireIdempotency, handler);
 * 
 * Client must provide 'Idempotency-Key' header with unique identifier
 */

const IdempotencyService = require('../services/IdempotencyService');
const { ValidationError } = require('../utils/errors');
const log = require('../utils/log');

/**
 * Middleware to require and validate idempotency key
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
async function requireIdempotency(req, res, next) {
  try {
    // Extract idempotency key from header
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

    // Validate key presence
    if (!idempotencyKey) {
      throw new ValidationError(
        'Idempotency-Key header is required for this operation',
        { header: 'Idempotency-Key' },
        'IDEMPOTENCY_KEY_REQUIRED'
      );
    }

    // Validate key format
    const validation = IdempotencyService.validateKey(idempotencyKey);
    if (!validation.valid) {
      throw new ValidationError(
        validation.error,
        { idempotencyKey },
        'INVALID_IDEMPOTENCY_KEY'
      );
    }

    // Check if key already exists
    const existing = await IdempotencyService.get(idempotencyKey);
    
    if (existing) {
      // Return cached response (idempotent behavior)
      log.info('IDEMPOTENCY', 'Returning cached response', { idempotencyKey });
      
      return res.status(200).json({
        ...existing.response,
        _idempotent: true,
        _originalTimestamp: existing.createdAt
      });
    }

    // Generate request hash for duplicate detection
    const requestHash = IdempotencyService.generateRequestHash(req.body);

    // Check if same request was made with different key (potential duplicate)
    const duplicate = await IdempotencyService.findByHash(requestHash, idempotencyKey);
    
    if (duplicate) {
      log.warn('IDEMPOTENCY', 'Duplicate request payload detected with different key', {
        originalKey: duplicate.idempotencyKey,
        newKey: idempotencyKey,
      });
      
      // Return warning but allow processing (different key = different intent)
      req.idempotencyWarning = {
        message: 'Similar request detected with different idempotency key',
        originalKey: duplicate.idempotencyKey,
        originalTimestamp: duplicate.createdAt
      };
    }

    // Attach idempotency data to request for handler to use
    req.idempotency = {
      key: idempotencyKey,
      hash: requestHash,
      isNew: true
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to store idempotency response after successful processing
 * Should be used in the route handler after successful operation
 * 
 * @param {Object} req - Express request
 * @param {Object} response - Response data to cache
 * @returns {Promise<void>}
 */
async function storeIdempotencyResponse(req, response) {
  if (!req.idempotency || !req.idempotency.isNew) {
    return; // Already cached or not using idempotency
  }

  try {
    await IdempotencyService.store(
      req.idempotency.key,
      req.idempotency.hash,
      response,
      req.user?.id
    );

    log.info('IDEMPOTENCY', 'Stored idempotent response', { idempotencyKey: req.idempotency.key });
  } catch (error) {
    // Log error but don't fail the request
    log.error('IDEMPOTENCY', 'Failed to store idempotent response', { error: error.message });
  }
}

/**
 * Optional middleware for endpoints that support but don't require idempotency
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
async function optionalIdempotency(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

  if (!idempotencyKey) {
    // No idempotency key provided, continue without it
    return next();
  }

  // If key is provided, use full idempotency logic
  return requireIdempotency(req, res, next);
}

/**
 * Cleanup middleware - removes expired idempotency records
 * Can be called periodically or on app startup
 */
async function cleanupExpiredKeys() {
  try {
    const deleted = await IdempotencyService.cleanupExpired();
    log.info('IDEMPOTENCY', 'Cleaned up expired keys', { deleted });
    return deleted;
  } catch (error) {
    log.error('IDEMPOTENCY', 'Cleanup failed', { error: error.message });
    return 0;
  }
}

module.exports = {
  requireIdempotency,
  optionalIdempotency,
  storeIdempotencyResponse,
  cleanupExpiredKeys
};
