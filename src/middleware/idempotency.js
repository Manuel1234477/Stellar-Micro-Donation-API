/**
 * Idempotency Middleware
 * Intent: Guarantee that a single logical operation (like a Stellar donation) is 
 * executed exactly once, even if the client retries the request due to network instability.
 * Flow: Header Check -> Key Validation -> Cache Lookup -> (If New) Hash Request Body -> (If Cached) Return Response.
 */

const IdempotencyService = require('../services/IdempotencyService');
const { ValidationError } = require('../utils/errors');
const log = require('../utils/log');

/**
 * Required Idempotency Check
 * Intent: Force the client to provide a unique key for write operations.
 * Flow: 
 * 1. Extract 'Idempotency-Key' or 'x-idempotency-key' from headers.
 * 2. Validate format (ensure it's not empty or malformed).
 * 3. Query the IdempotencyService to see if this key has a successful cached response.
 * 4. If found: Short-circuit the request and return the cached JSON immediately.
 * 5. If not found: Generate a cryptographic hash of the body to detect "Key Reuse" (same key, different data).
 */
async function requireIdempotency(req, res, next) {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      throw new ValidationError(
        'Idempotency-Key header is required for this operation',
        { header: 'Idempotency-Key' },
        'IDEMPOTENCY_KEY_REQUIRED'
      );
    }

    const validation = IdempotencyService.validateKey(idempotencyKey);
    if (!validation.valid) {
      throw new ValidationError(
        validation.error,
        { idempotencyKey },
        'INVALID_IDEMPOTENCY_KEY'
      );
    }

    const existing = await IdempotencyService.get(idempotencyKey);
    
    if (existing) {
      log.info('IDEMPOTENCY', 'Returning cached response', { idempotencyKey });
      
      // Return cached response (idempotent behavior)
      return res.status(200).json({
        ...existing.response,
        _idempotent: true,
        _originalTimestamp: existing.createdAt
      });
    }

    const requestHash = IdempotencyService.generateRequestHash(req.body);

    const duplicate = await IdempotencyService.findByHash(requestHash, idempotencyKey);
    
    if (duplicate) {
      log.warn('IDEMPOTENCY', 'Duplicate request payload detected with different key', {
        originalKey: duplicate.idempotencyKey,
        newKey: idempotencyKey,
      });
      
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
 * Cache Storage Utility
 * Intent: Store the successful outcome of an operation so it can be replayed later.
 * Flow: Called by the controller after successful DB/Stellar operations -> Persists result to the idempotency table.
 */
async function storeIdempotencyResponse(req, response) {
  if (!req.idempotency || !req.idempotency.isNew) {
    return; 
  }

  try {
    await IdempotencyService.store(
      req.idempotency.key,
      req.idempotency.hash,
      response,
      req.user?.id
    );
  } catch (error) {
    log.error('IDEMPOTENCY', 'Failed to store idempotent response', { error: error.message });
  }
}

/**
 * Optional Idempotency Handler
 * Intent: Allow flexible endpoints that support idempotency if a key is provided but don't require it.
 * Flow: Check for header -> If present, run requireIdempotency logic -> If absent, proceed to next().
 */
async function optionalIdempotency(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

  if (!idempotencyKey) {
    return next();
  }

  return requireIdempotency(req, res, next);
}

/**
 * Maintenance Utility
 * Intent: Purge old idempotency records to prevent the database from growing indefinitely.
 * Flow: Deletes records older than the configured retention period (e.g., 24 hours).
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