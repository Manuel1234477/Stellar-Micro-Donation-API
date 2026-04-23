/**
 * API Keys Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for API key management operations
 * OWNER: Security Team
 * DEPENDENCIES: API Keys model, middleware (auth, RBAC), validation helpers, scope validator
 * 
 * Admin-only endpoints for API key lifecycle management including creation, listing,
 * rotation, deprecation, and revocation. Supports zero-downtime key rotation and
 * fine-grained scope-based access control.
 */

const express = require('express');
const router = express.Router();
const apiKeysModel = require('../models/apiKeys');
const { requireAdmin } = require('../middleware/rbac');
const { ValidationError } = require('../utils/errors');
const { validateNonEmptyString, validateRole, validateInteger } = require('../utils/validationHelpers');
const { validateScopes } = require('../utils/scopeValidator');

const AuditLogService = require('../services/AuditLogService');
const TOTPService = require('../services/TOTPService');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

const { validateSchema } = require('../middleware/schemaValidation');
const { API_KEY_STATUS } = require('../constants');

const apiKeyCreateSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: true, trim: true, minLength: 1, maxLength: 255 },
      role: { type: 'string', required: false, enum: ['admin', 'user', 'guest'] },
      expiresInDays: { type: 'integer', required: false, min: 1 },
      metadata: { type: 'object', required: false, nullable: true },
      rateLimit: { type: 'integer', required: false, min: 1 },
      rateLimitWindowSeconds: { type: 'integer', required: false, min: 1 },
      allowedIps: { type: 'array', required: false, nullable: true },
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
 * Request body can include optional 'scopes' array for fine-grained access control
 */
router.post('/', requireAdmin(), apiKeyCreateSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { name, role = 'user', expiresInDays, metadata, rateLimit, rateLimitWindowSeconds, allowedIps } = req.body;

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

    // Validate scopes
    const scopeValidation = validateScopes(scopes);
    if (!scopeValidation.valid) {
      throw new ValidationError(`Invalid scopes: ${scopeValidation.errors.join('; ')}`);
    }

    const keyInfo = await apiKeysModel.createApiKey({
      name: name.trim(),
      role,
      expiresInDays,
      createdBy: req.user.id,
      metadata: metadata || {},
      rateLimit: rateLimit || null,
      rateLimitWindowSeconds: rateLimitWindowSeconds || null,
      allowedIps: allowedIps || null,
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
        scopesCount: scopeValidation.scopes.length,
        scopes: scopeValidation.scopes,
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
        scopes: keyInfo.scopes,
        status: keyInfo.status,
        createdAt: keyInfo.createdAt,
        expiresAt: keyInfo.expiresAt,
        rateLimit: keyInfo.rateLimit,
        rateLimitWindowSeconds: keyInfo.rateLimitWindowSeconds,
        warning: 'Store this key securely. It will not be shown again.'
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /api/v1/api-keys
 * List all API keys (admin only)
 */
router.get('/', requireAdmin(), apiKeyListQuerySchema, asyncHandler(async (req, res, next) => {
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
}));

const apiKeyRotateSchema = validateSchema({
  body: {
    fields: {
      gracePeriodDays: { type: 'integer', required: false, min: 1 },
    },
  },
});

/**
 * POST /api/v1/api-keys/:id/rotate
 * Atomically rotate an API key: creates a new key and deprecates the old one (admin only)
 */
router.post('/:id/rotate', requireAdmin(), apiKeyIdParamSchema, apiKeyRotateSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const keyIdValidation = validateInteger(req.params.id, { min: 1 });
    if (!keyIdValidation.valid) {
      throw new ValidationError(`Invalid key ID: ${keyIdValidation.error}`);
    }

    const gracePeriodDays = req.body.gracePeriodDays ?? 30;

    const result = await apiKeysModel.rotateApiKey(keyIdValidation.value, { gracePeriodDays });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found or already revoked' }
      });
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: AuditLogService.ACTION.API_KEY_CREATED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyIdValidation.value}/rotate`,
      details: {
        oldKeyId: result.oldKeyId,
        newKeyId: result.newKey.id,
        gracePeriodDays,
        autoRevokeAt: result.autoRevokeAt,
        rotatedBy: req.user.id,
      }
    });

    res.status(201).json({
      success: true,
      data: {
        newKey: {
          id: result.newKey.id,
          key: result.newKey.key,
          keyPrefix: result.newKey.keyPrefix,
          name: result.newKey.name,
          role: result.newKey.role,
          status: result.newKey.status,
          createdAt: result.newKey.createdAt,
          warning: 'Store this key securely. It will not be shown again.',
        },
        oldKeyId: result.oldKeyId,
        deprecatedAt: result.deprecatedAt,
        gracePeriodDays: result.gracePeriodDays,
        autoRevokeAt: result.autoRevokeAt,
      }
    });
  } catch (error) {
    next(error);
  }
}));
router.post('/:id/deprecate', requireAdmin(), apiKeyIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
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
}));

/**
 * PATCH /api/v1/api-keys/:id
 * Update mutable fields on an API key, e.g. allowedIps (admin only)
 */
router.patch('/:id', requireAdmin(), apiKeyIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const keyIdValidation = validateInteger(req.params.id, { min: 1 });
    if (!keyIdValidation.valid) {
      throw new ValidationError(`Invalid key ID: ${keyIdValidation.error}`);
    }

    const { allowedIps } = req.body;
    const updates = {};
    if (allowedIps !== undefined) updates.allowed_ips = allowedIps;

    const updated = await apiKeysModel.updateApiKey(keyIdValidation.value, updates);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: 'API_KEY_UPDATED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyIdValidation.value}`,
      details: { keyId: keyIdValidation.value, updatedFields: Object.keys(updates), updatedBy: req.user.id },
    });

    res.json({ success: true, message: 'API key updated successfully' });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /api/v1/api-keys/:id
 * Revoke an API key (admin only)
 */
router.delete('/:id', requireAdmin(), apiKeyIdParamSchema, asyncHandler(async (req, res, next) => {
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
}));

/**
 * POST /api/v1/api-keys/cleanup
 * Clean up old expired and revoked keys (admin only)
 */
router.post('/cleanup', requireAdmin(), apiKeyCleanupSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { retentionDays = 90 } = req.body;

    if (typeof retentionDays !== 'number' || retentionDays < 1) {
      throw new ValidationError('retentionDays must be a positive number');
    }

    const deletedCount = await apiKeysModel.cleanupOldKeys(retentionDays);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: 'API_KEY_CLEANUP',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/api/v1/api-keys/cleanup',
      details: { retentionDays, deletedCount, performedBy: req.user.id }
    });

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
}));

// ─── TOTP Routes ──────────────────────────────────────────────────────────────

/**
 * POST /api-keys/:id/totp/setup
 * Generate a TOTP secret and QR code for an API key (admin only).
 * TOTP is not yet active — the admin must call /verify to activate it.
 */
router.post('/:id/totp/setup', requireAdmin(), apiKeyIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { value: keyId } = validateInteger(req.params.id, { min: 1 });

    // Fetch key name for the otpauth label
    const { initializeApiKeysTable } = require('../models/apiKeys');
    await initializeApiKeysTable();
    const db = require('../utils/database');
    const row = await db.get(`SELECT name FROM api_keys WHERE id = ?`, [keyId]);
    if (!row) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }

    const result = await TOTPService.generateSecret(keyId, row.name);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: 'TOTP_SETUP_INITIATED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyId}/totp/setup`,
      details: { keyId, initiatedBy: req.user.id },
    });

    res.status(200).json({
      success: true,
      data: {
        secret: result.secret,
        qrCodeDataUrl: result.qrCodeDataUrl,
        otpauthUrl: result.otpauthUrl,
        backupCodes: result.backupCodes,
        warning: 'Store backup codes securely. They will not be shown again.',
        instructions: 'Scan the QR code with your authenticator app, then call POST /totp/verify with a valid code to activate TOTP.',
      },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /api-keys/:id/totp/verify
 * Verify a TOTP code and activate TOTP for the API key (admin only).
 * Also accepts a backup code to authenticate when TOTP is already enabled.
 */
router.post('/:id/totp/verify', requireAdmin(), apiKeyIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { value: keyId } = validateInteger(req.params.id, { min: 1 });
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'code is required' },
      });
    }

    // If TOTP is already enabled, this endpoint just verifies the code
    const alreadyEnabled = await TOTPService.isTotpEnabled(keyId);
    if (alreadyEnabled) {
      const totpValid = await TOTPService.verify(keyId, String(code));
      const backupValid = !totpValid && await TOTPService.verifyBackupCode(keyId, String(code));
      const valid = totpValid || backupValid;

      res.setHeader('X-TOTP-Required', 'true');
      if (!valid) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOTP', message: 'Invalid or expired TOTP code' },
        });
      }
      return res.status(200).json({ success: true, data: { verified: true, usedBackupCode: backupValid } });
    }

    // First-time activation
    const result = await TOTPService.enable(keyId, String(code));
    if (!result.enabled) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOTP', message: result.reason || 'Invalid TOTP code' },
      });
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: 'TOTP_ENABLED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyId}/totp/verify`,
      details: { keyId, enabledBy: req.user.id },
    });

    res.status(200).json({ success: true, data: { enabled: true } });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /api-keys/:id/totp
 * Disable TOTP for an API key (admin only). Requires a valid TOTP or backup code.
 */
router.delete('/:id/totp', requireAdmin(), apiKeyIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const { value: keyId } = validateInteger(req.params.id, { min: 1 });
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'code is required to disable TOTP' },
      });
    }

    const result = await TOTPService.disable(keyId, String(code));
    if (!result.disabled) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOTP', message: result.reason || 'Invalid code' },
      });
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: 'TOTP_DISABLED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api/v1/api-keys/${keyId}/totp`,
      details: { keyId, disabledBy: req.user.id },
    });

    res.status(200).json({ success: true, data: { disabled: true } });
  } catch (error) {
    next(error);
  }
}));

// ─── Expiration Notices ───────────────────────────────────────────────────────

/**
 * GET /api-keys/:id/expiration-notices
 * List all expiration notifications sent for a given API key (admin only).
 */
router.get('/:id/expiration-notices', requireAdmin(), apiKeyIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const { value: keyId } = validateInteger(req.params.id, { min: 1 });
    const { getExpirationNotices } = require('../models/apiKeys');
    const notices = await getExpirationNotices(keyId);
    res.json({ success: true, data: { keyId, notices } });
  } catch (error) {
    next(error);
  }
}));

// ─── Anomaly Detection ────────────────────────────────────────────────────────

const anomalyDetectionService = require('../services/AnomalyDetectionService');

/**
 * GET /api-keys/:id/anomalies
 * Returns anomaly history for the given API key (admin only).
 */
router.get('/:id/anomalies', requireAdmin, apiKeyIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const keyId = String(req.params.id);
    const anomalies = anomalyDetectionService.getAnomalies(keyId);
    res.status(200).json({ success: true, data: { keyId, anomalies } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /api-keys/:id/tier
 * Returns the subscription tier for the given API key (admin only).
 */
router.get('/:id/tier', requireAdmin(), apiKeyIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const Database = require('../utils/database');
    const keyId = parseInt(req.params.id, 10);
    const row = await Database.get(
      'SELECT id, name, tier FROM api_keys WHERE id = ? AND status != ?',
      [keyId, 'revoked']
    );
    if (!row) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API key not found' } });
    }
    res.json({ success: true, data: { id: row.id, name: row.name, tier: row.tier || 'free' } });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
