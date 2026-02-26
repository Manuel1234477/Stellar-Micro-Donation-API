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

const AuditLogService = require('../services/AuditLogService');

const { validateSchema } = require('../middleware/schemaValidation');
const { API_KEY_STATUS } = require('../constants');

const apiKeyCreateSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: true, trim: true, minLength: 1, maxLength: 255 },
      role: { type: 'string', required: false, enum: ['admin', 'user', 'guest'] },
      expiresInDays: { type: 'integer', required: false, min: 1 },
      metadata: { type: 'object', required: false, nullable: true },
    },
  },
});

const apiKeyListQuerySchema = validateSchema({
  query: {
    fields: {
      status: { type: 'string', required: false, enum: Object.values(API_KEY_STATUS) },
      role: { type: 'string', required: false, enum: ['admin', 'user', 'guest'] },
    },
  },
});

const apiKeyIdParamSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
    },
  },
});

const apiKeyCleanupSchema = validateSchema({
  body: {
    fields: {
      retentionDays: { type: 'integer', required: false, min: 1 },
    },
  },
});


/**
 * POST /api/v1/api-keys
 * Create a new API key (admin only)
 */
router.post('/', requireAdmin(), apiKeyCreateSchema, async (req, res, next) => {
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

    // Audit log: API key created
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: AuditLogService.ACTION.API_KEY_CREATED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyInfo.id}`,
      details: {
        keyId: keyInfo.id,
        keyName: name.trim(),
        role,
        expiresInDays,
        createdBy: req.user.id
      }
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
router.get('/', requireAdmin(), apiKeyListQuerySchema, async (req, res, next) => {
  try {
    const { status, role } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (role) filters.role = role;

    const keys = await apiKeysModel.listApiKeys(filters);

    // Audit log: API keys listed
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: AuditLogService.ACTION.API_KEY_LISTED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/api/v1/api-keys',
      details: {
        filters,
        resultCount: keys.length
      }
    });

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
router.post('/:id/deprecate', requireAdmin(), apiKeyIdParamSchema, async (req, res, next) => {
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

    // Audit log: API key deprecated
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: AuditLogService.ACTION.API_KEY_DEPRECATED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyIdValidation.value}`,
      details: {
        keyId: keyIdValidation.value,
        deprecatedBy: req.user.id
      }
    });

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
router.delete('/:id', requireAdmin(), apiKeyIdParamSchema, async (req, res, next) => {
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

    // Audit log: API key revoked
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: AuditLogService.ACTION.API_KEY_REVOKED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyIdValidation.value}`,
      details: {
        keyId: keyIdValidation.value,
        revokedBy: req.user.id
      }
    });

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
router.post('/cleanup', requireAdmin(), apiKeyCleanupSchema, async (req, res, next) => {
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
