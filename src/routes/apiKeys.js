/**
 * API Keys Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for API key management operations
 * OWNER: Security Team
 * DEPENDENCIES: API Keys model, middleware (auth, RBAC), validation helpers
 * 
 * Admin-only endpoints for API key lifecycle management including creation, listing,
 * rotation, deprecation, and revocation. Supports zero-downtime key rotation.
 */

const express = require('express');
const router = express.Router();
const apiKeysModel = require('../models/apiKeys');
const { requireAdmin } = require('../middleware/rbac');
const { ValidationError } = require('../utils/errors');
const { validateNonEmptyString, validateRole, validateInteger } = require('../utils/validationHelpers');

/**
 * POST /api/v1/api-keys
 * Create a new API key (admin only)
 */
router.post('/', requireAdmin(), async (req, res, next) => {
  try {
    const { name, role = 'user', expiresInDays, metadata } = req.body;

    const nameValidation = validateNonEmptyString(name, 'Name');
    if (!nameValidation.valid) {
      throw new ValidationError(nameValidation.error);
    }

    const roleValidation = validateRole(role);
    if (!roleValidation.valid) {
      throw new ValidationError(roleValidation.error);
    }

    if (expiresInDays !== undefined) {
      const expiresValidation = validateInteger(expiresInDays, { min: 1 });
      if (!expiresValidation.valid) {
        throw new ValidationError(`Invalid expiresInDays: ${expiresValidation.error}`);
      }
    }

    const keyInfo = await apiKeysModel.createApiKey({
      name: name.trim(),
      role,
      expiresInDays,
      createdBy: req.user.id,
      metadata: metadata || {}
    });

    res.status(201).json({
      success: true,
      data: {
        id: keyInfo.id,
        key: keyInfo.key, // Only returned once!
        keyPrefix: keyInfo.keyPrefix,
        name: keyInfo.name,
        role: keyInfo.role,
        status: keyInfo.status,
        createdAt: keyInfo.createdAt,
        expiresAt: keyInfo.expiresAt,
        warning: 'Store this key securely. It will not be shown again.'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/api-keys
 * List all API keys (admin only)
 */
router.get('/', requireAdmin(), async (req, res, next) => {
  try {
    const { status, role } = req.query;
    
    const filters = {};
    if (status) filters.status = status;
    if (role) filters.role = role;

    const keys = await apiKeysModel.listApiKeys(filters);

    res.json({
      success: true,
      data: keys
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/api-keys/:id/deprecate
 * Deprecate an API key (admin only)
 */
router.post('/:id/deprecate', requireAdmin(), async (req, res, next) => {
  try {
    const keyIdValidation = validateInteger(req.params.id, { min: 1 });
    
    if (!keyIdValidation.valid) {
      throw new ValidationError(`Invalid key ID: ${keyIdValidation.error}`);
    }

    const success = await apiKeysModel.deprecateApiKey(keyIdValidation.value);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found or already deprecated'
        }
      });
    }

    res.json({
      success: true,
      message: 'API key deprecated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/api-keys/:id
 * Revoke an API key (admin only)
 */
router.delete('/:id', requireAdmin(), async (req, res, next) => {
  try {
    const keyIdValidation = validateInteger(req.params.id, { min: 1 });
    
    if (!keyIdValidation.valid) {
      throw new ValidationError(`Invalid key ID: ${keyIdValidation.error}`);
    }

    const success = await apiKeysModel.revokeApiKey(keyIdValidation.value);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found'
        }
      });
    }

    res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/api-keys/cleanup
 * Clean up old expired and revoked keys (admin only)
 */
router.post('/cleanup', requireAdmin(), async (req, res, next) => {
  try {
    const { retentionDays = 90 } = req.body;

    if (typeof retentionDays !== 'number' || retentionDays < 1) {
      throw new ValidationError('retentionDays must be a positive number');
    }

    const deletedCount = await apiKeysModel.cleanupOldKeys(retentionDays);

    res.json({
      success: true,
      data: {
        deletedCount,
        retentionDays
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
