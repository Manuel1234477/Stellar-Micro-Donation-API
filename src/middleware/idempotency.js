/**
 * Idempotency Middleware - Request Deduplication Layer
 * 
 * RESPONSIBILITY: Prevents duplicate transaction execution through idempotency key tracking
 * OWNER: Backend Team
 * DEPENDENCIES: IdempotencyService, Database, logger
 * 
 * Guarantees that a single logical operation (like a Stellar donation) is executed
 * exactly once, even if the client retries due to network instability.
 * Flow: Header Check -> Key Validation -> Cache Lookup -> Hash Request Body -> Return Response.
 */

const IdempotencyService = require('../services/IdempotencyService');
const { ValidationError } = require('../utils/errors');
const log = require('../utils/log');

// Marks a stored response that also carries the original status and headers (#1871).
// Records written before this envelope existed hold a bare body and replay as 200.
const STORED_ENVELOPE_VERSION = 2;

/**
 * Issue #1871: Namespace used to scope idempotency records.
 * API-key callers keep their numeric key id. Every other authenticated principal
 * (JWT, DB and legacy keys set req.user) is namespaced by its user id so that
 * two principals choosing the same key never see each other's stored responses.
 * @param {object} req - Express request
 * @returns {number|string|null}
 */
function resolveScopeId(req) {
  if (req.apiKey?.id) return req.apiKey.id;
  if (req.user?.id) return `principal:${req.user.id}`;
  return null;
}

/**
 * Unwraps a stored record into the status, headers and body to replay.
 * @param {object} response - Parsed response column
 * @returns {{ status: number, headers: object, body: object }}
 */
function unwrapStoredResponse(response) {
  if (response && response.__idempotentEnvelope === STORED_ENVELOPE_VERSION) {
    return { status: response.status, headers: response.headers || {}, body: response.body };
  }
  return { status: 200, headers: {}, body: response };
}

/**
 * Replays a completed record with the status code and headers of the original response.
 * @param {object} res - Express response
 * @param {object} record - Record returned by IdempotencyService.get
 * @returns {object} Express response
 */
function sendReplay(res, record) {
  const { status, headers, body } = unwrapStoredResponse(record.response);
  res.setHeader('X-Idempotency-Replayed', 'true');
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) res.setHeader(name, value);
  }
  return res.status(status).json({
    ...body,
    _idempotent: true,
    _originalTimestamp: record.createdAt
  });
}

/**
 * Required Idempotency Check
 * Intent: Force the client to provide a unique key for write operations.
 * Flow:
 * 1. Extract 'Idempotency-Key' or 'x-idempotency-key' from headers.
 * 2. Validate format (ensure it's not empty or malformed).
 * 3. Query the IdempotencyService to see if this key has a successful cached response.
 * 4. If found: Short-circuit the request and return the cached JSON immediately.
 * 5. If not found: Generate a cryptographic hash of the body to detect "Key Reuse" (same key, different data).
 * Issue #891: Scope idempotency keys by API key ID to prevent cross-tenant collisions
 */
async function requireIdempotency(req, res, next) {
  try {
    const idempotencyKey = req.headers['idempotency-key']
      || req.headers['x-idempotency-key']
      || req.idempotency?.key;

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

    // Issue #891 / #1871: Scope by API key id or authenticated principal
    const apiKeyId = resolveScopeId(req);

    const existing = await IdempotencyService.get(idempotencyKey, apiKeyId);

    if (existing) {
      // Issue #1870: a reused key with a different body is a client bug, not a replay
      if (existing.requestHash !== IdempotencyService.generateRequestHash(req.body)) {
        log.warn('IDEMPOTENCY', 'Idempotency key reused with different payload', { idempotencyKey, apiKeyId });
        return sendKeyReused(res);
      }
      log.info('IDEMPOTENCY', 'Returning cached response', { idempotencyKey, apiKeyId });
      return sendReplay(res, existing);
    }

    // Check if the same key is currently in-flight on another request
    const inFlight = await IdempotencyService.isPending(idempotencyKey, apiKeyId);
    if (inFlight) {
      log.warn('IDEMPOTENCY', 'Concurrent request with same key is in-flight', { idempotencyKey, apiKeyId });
      return res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'A request with this idempotency key is already being processed. Retry after it completes.'
        }
      });
    }

    const requestHash = IdempotencyService.generateRequestHash(req.body);

    // Atomically reserve the slot before executing the operation
    const reserved = await IdempotencyService.reserve(idempotencyKey, requestHash, apiKeyId);
    if (!reserved) {
      // Another concurrent request beat us to the reservation
      const racing = await IdempotencyService.isPending(idempotencyKey, apiKeyId);
      if (racing) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'A request with this idempotency key is already being processed. Retry after it completes.'
          }
        });
      }
      // It completed while we were checking — return the completed response
      const completed = await IdempotencyService.get(idempotencyKey, apiKeyId);
      if (completed) {
        if (completed.requestHash !== requestHash) {
          return sendKeyReused(res);
        }
        return sendReplay(res, completed);
      }
    }

    const duplicate = await IdempotencyService.findByHash(requestHash, idempotencyKey, apiKeyId);
    if (duplicate) {
      log.warn('IDEMPOTENCY', 'Duplicate request payload detected with different key', {
        originalKey: duplicate.idempotencyKey,
        newKey: idempotencyKey,
        apiKeyId
      });
      req.idempotencyWarning = {
        message: 'Similar request detected with different idempotency key',
        originalKey: duplicate.idempotencyKey,
        originalTimestamp: duplicate.createdAt
      };
    }

    // Attach idempotency data to request for handler to use
    req.idempotency = {
      ...(req.idempotency || {}),
      key: idempotencyKey,
      hash: requestHash,
      isNew: true,
      apiKeyId
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Issue #1870: Rejects a key that was previously used with a different request body.
 * Mirrors the IETF Idempotency-Key draft: 422 surfaces client bugs instead of
 * silently replaying a response for a different operation.
 * @param {object} res - Express response
 * @returns {object} Express response
 */
function sendKeyReused(res) {
  return res.status(422).json({
    success: false,
    error: {
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was already used with a different request body.'
    }
  });
}

/**
 * Cache Storage Utility
 * Intent: Store the successful outcome of an operation so it can be replayed later.
 * Flow: Called by the controller after successful DB/Stellar operations -> Persists result to the idempotency table.
 * Issue #891: Include apiKeyId in storage for scoping
 * Issue #1871: Store the original status code, headers and request id so replays match.
 * @param {object} req - Express request
 * @param {object} response - Response body to replay
 * @param {{ statusCode?: number, headers?: object }} [options]
 */
async function storeIdempotencyResponse(req, response, { statusCode = 200, headers = {} } = {}) {
  if (!req.idempotency || !req.idempotency.isNew) {
    return;
  }

  const envelope = {
    __idempotentEnvelope: STORED_ENVELOPE_VERSION,
    status: statusCode,
    headers: { ...(req.id ? { 'X-Request-Id': req.id } : {}), ...headers },
    body: response
  };

  try {
    await IdempotencyService.complete(
      req.idempotency.key,
      envelope,
      req.idempotency.apiKeyId,
      req.user?.id
    );
  } catch (error) {
    log.error('IDEMPOTENCY', 'Failed to complete idempotent response', { error: error.message });
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
    req.idempotency = { key: null, isNew: false };
    return next();
  }

  return requireIdempotency(req, res, next);
}

/**
 * Conditional Idempotency Handler for POST /donations.
 * When REQUIRE_IDEMPOTENCY_KEY=true, the Idempotency-Key header is required.
 * When REQUIRE_IDEMPOTENCY_KEY=false (default), it is optional.
 * The key must be a non-empty string of 1–128 characters.
 */
async function conditionalIdempotency(req, res, next) {
  const required = process.env.REQUIRE_IDEMPOTENCY_KEY === 'true';
  const idempotencyKey = req.headers['idempotency-key']
    || req.headers['x-idempotency-key']
    || req.idempotency?.key;

  if (!idempotencyKey) {
    if (required) {
      return next(new ValidationError(
        'An Idempotency-Key header is required for donation creation',
        { header: 'Idempotency-Key' },
        'IDEMPOTENCY_KEY_REQUIRED'
      ));
    }
    req.idempotency = { key: null, isNew: false };
    return next();
  }

  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 128) {
    return next(new ValidationError(
      'Idempotency-Key must be a non-empty string of 1–128 characters',
      { idempotencyKey },
      'INVALID_IDEMPOTENCY_KEY'
    ));
  }

  try {
    const apiKeyId = resolveScopeId(req);
    const existing = await IdempotencyService.get(idempotencyKey, apiKeyId);
    const requestHash = IdempotencyService.generateRequestHash(req.body);
    if (existing) {
      // Issue #1870: a reused key with a different body is a client bug, not a replay
      if (existing.requestHash !== requestHash) {
        log.warn('IDEMPOTENCY', 'Idempotency key reused with different payload', { idempotencyKey, apiKeyId });
        return sendKeyReused(res);
      }
      log.info('IDEMPOTENCY', 'Returning cached response', { idempotencyKey, apiKeyId });
      return sendReplay(res, existing);
    }
    req.idempotency = { key: idempotencyKey, hash: requestHash, isNew: true, apiKeyId };
    next();
  } catch (error) {
    next(error);
  }
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
  conditionalIdempotency,
  storeIdempotencyResponse,
  cleanupExpiredKeys
};
