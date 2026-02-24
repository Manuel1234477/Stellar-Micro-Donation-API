const express = require('express');
const router = express.Router();
const apiKeysModel = require('../models/apiKeys');
const { requireAdmin } = require('../middleware/rbacMiddleware');
const { ValidationError } = require('../utils/errors');
const log = require('../utils/log');

/**
 * POST /api/v1/api-keys
 * Create a new API key (admin only)
 */
router.post('/', requireAdmin(), async (req, res, next) => {
  try {
    const { name, role = 'user', expiresInDays, metadata } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Name is required');
    }

    if (!['admin', 'user', 'guest'].includes(role)) {
      throw new ValidationError('Role must be one of: admin, user, guest');
    }

    if (expiresInDays !== undefined && (typeof expiresInDays !== 'number' || expiresInDays <= 0)) {
      throw new ValidationError('expiresInDays must be a positive number');
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
    const keyId = parseInt(req.params.id, 10);
    
    if (isNaN(keyId)) {
      throw new ValidationError('Invalid key ID');
    }

    const success = await apiKeysModel.deprecateApiKey(keyId);

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
    const keyId = parseInt(req.params.id, 10);
    
    if (isNaN(keyId)) {
      throw new ValidationError('Invalid key ID');
    }

    const success = await apiKeysModel.revokeApiKey(keyId);

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
