/**
 * RBAC Middleware - Authorization Layer
 * 
 * RESPONSIBILITY: Role-based access control and permission validation
 * OWNER: Security Team
 * DEPENDENCIES: Permissions model, API Keys model, config, Scope validator
 * 
 * Enforces granular permission checks for API endpoints. Handles transition between
 * legacy environment-based keys and database-backed API key system with RBAC.
 * Supports fine-grained scope-based access control for API keys.
 */

const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { hasPermission } = require('../models/permissions');
const { validateApiKey } = require('../models/apiKeys');
const config = require('../config');
const AuditLogService = require('../services/AuditLogService');
const perKeyRateLimit = require('./perKeyRateLimit');
const { tierMeetsMinimum } = require('../config/permissionMatrix');

/**
 * Role-Based Access Control (RBAC) Configuration
 * Intent: Handle the transition between legacy environment-based keys and
 * the new database-backed API key system with granular permissions.
 */
const legacyKeys = config.apiKeys.legacy;

/**
 * Single Permission Validator
 * Intent: Restrict endpoint access to users possessing a specific permission string.
 * Validates against both role-based and scope-based permissions.
 * Flow:
 * 1. Verify existence of req.user object (populated by attachUserRole).
 * 2. Extract current role (defaults to 'guest' if undefined).
 * 3. Cross-reference role and permission against the permissions model.
 * 4. If API key has scopes, additionally check that the required permission is in the scopes.
 * 5. Pass control to next middleware if authorized; otherwise, propagate a ForbiddenError.
 */
exports.checkPermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';

      // Check role-based permissions
      const roleHasPermission = hasPermission(userRole, permission);
      
      // Check scope-based permissions (if API key has scopes)
      let scopeHasPermission = true;
      if (req.apiKey && req.apiKey.scopes && Array.isArray(req.apiKey.scopes) && req.apiKey.scopes.length > 0) {
        scopeHasPermission = hasScope(req.apiKey.scopes, permission);
      }

      // Both role AND scope permissions must be satisfied
      const hasAccess = roleHasPermission && scopeHasPermission;

      if (!hasAccess) {
        const denialReason = !roleHasPermission 
          ? `Missing role permission: ${permission}` 
          : `Missing scope: ${permission}`;
        
        // Audit log: Permission denied (non-fatal)
        AuditLogService.log({
          category: AuditLogService.CATEGORY.AUTHORIZATION,
          action: AuditLogService.ACTION.PERMISSION_DENIED,
          severity: AuditLogService.SEVERITY.HIGH,
          result: 'FAILURE',
          userId: req.user.id,
          requestId: req.id,
          ipAddress: req.ip,
          resource: req.path,
          reason: denialReason,
          details: {
            userRole,
            requiredPermission: permission,
            method: req.method,
            hasScope: !roleHasPermission ? 'N/A' : scopeHasPermission,
            apiKeyId: req.apiKey?.id,
          }
        }).catch(() => {});

        throw new ForbiddenError(`Insufficient permissions. Required: ${permission}`);
      }

      // Audit log: Permission granted (non-fatal)
      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHORIZATION,
        action: AuditLogService.ACTION.PERMISSION_GRANTED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        details: {
          userRole,
          grantedPermission: permission,
          method: req.method,
          scopeVerified: req.apiKey?.scopes ? true : false,
          apiKeyId: req.apiKey?.id,
        }
      }).catch(() => {});

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Union Permission Validator (OR Logic)
 * Intent: Allow access if the user meets any one of multiple permission criteria.
 * Validates against both role-based and scope-based permissions.
 * Flow:
 * 1. Iterates through the 'permissions' array.
 * 2. Uses Array.prototype.some() to find at least one valid role-permission match.
 * 3. If API key has scopes, also checks that at least one scope permission matches.
 * 4. If no matches are found, generates a descriptive error listing all acceptable permissions.
 */
exports.checkAnyPermission = (permissions) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';
      
      // Check role-based permissions
      const roleHasAnyPermission = permissions.some(permission =>
        hasPermission(userRole, permission)
      );
      
      // Check scope-based permissions (if API key has scopes)
      let scopeHasAnyPermission = true;
      if (req.apiKey && req.apiKey.scopes && Array.isArray(req.apiKey.scopes) && req.apiKey.scopes.length > 0) {
        scopeHasAnyPermission = hasAnyScope(req.apiKey.scopes, permissions);
      }

      // Both role AND scope must satisfy at least one permission
      if (!roleHasAnyPermission || !scopeHasAnyPermission) {
        throw new ForbiddenError(`Insufficient permissions. Required one of: ${permissions.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Intersection Permission Validator (AND Logic)
 * Intent: Enforce high-security access requiring a user to possess every listed permission.
 * Validates against both role-based and scope-based permissions.
 * Flow:
 * 1. Evaluates the entire array of required permissions using Array.prototype.every().
 * 2. Ensures the user role supports the full set of required operations.
 * 3. If API key has scopes, also checks that all scope permissions are present.
 * 4. Strict failure if even one permission is missing from the user's role or scopes.
 */
exports.checkAllPermissions = (permissions) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role || 'guest';
      
      // Check role-based permissions
      const roleHasAllPermissions = permissions.every(permission =>
        hasPermission(userRole, permission)
      );
      
      // Check scope-based permissions (if API key has scopes)
      let scopeHasAllPermissions = true;
      if (req.apiKey && req.apiKey.scopes && Array.isArray(req.apiKey.scopes) && req.apiKey.scopes.length > 0) {
        scopeHasAllPermissions = hasAllScopes(req.apiKey.scopes, permissions);
      }

      // Both role AND scope must satisfy all permissions
      if (!roleHasAllPermissions || !scopeHasAllPermissions) {
        throw new ForbiddenError(`Insufficient permissions. Required all of: ${permissions.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Administrative Access Enforcer
 * Intent: Hard-check for the 'admin' role, bypassing granular permission checks for global access.
 * When TOTP is enabled on the API key, a valid TOTP code must be supplied via the
 * X-TOTP-Code request header (or the request body field `totpCode`).
 * Flow: Checks req.user.role strictly. Prevents 'guest' or 'user' roles from accessing management endpoints.
 */
exports.requireAdmin = () => {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role === 'guest') {
        throw new UnauthorizedError('Authentication required');
      }

      if (req.user.role !== 'admin') {
        // Audit log: Admin access denied
        AuditLogService.log({
          category: AuditLogService.CATEGORY.AUTHORIZATION,
          action: AuditLogService.ACTION.ADMIN_ACCESS_DENIED,
          severity: AuditLogService.SEVERITY.HIGH,
          result: 'FAILURE',
          userId: req.user.id,
          requestId: req.id,
          ipAddress: req.ip,
          resource: req.path,
          reason: 'Non-admin user attempted admin operation',
          details: {
            userRole: req.user.role,
            method: req.method
          }
        }).catch(() => {});

        throw new ForbiddenError('Admin access required');
      }

      // ── TOTP second-factor check ──────────────────────────────────────────
      // Only applies to DB-backed keys (not legacy env keys)
      const keyId = req.apiKey && !req.apiKey.isLegacy ? req.apiKey.id : null;
      if (keyId) {
        try {
          const TOTPService = require('../services/TOTPService');
          const totpEnabled = await TOTPService.isTotpEnabled(keyId);
          if (totpEnabled) {
            const totpCode = req.get('X-TOTP-Code') || (req.body && req.body.totpCode);
            if (!totpCode) {
              res.setHeader('X-TOTP-Required', 'true');
              return res.status(401).json({
                success: false,
                error: {
                  code: 'TOTP_REQUIRED',
                  message: 'This admin key requires a TOTP code. Supply it via the X-TOTP-Code header.',
                },
              });
            }
            const totpValid = await TOTPService.verify(keyId, String(totpCode));
            const backupValid = !totpValid && await TOTPService.verifyBackupCode(keyId, String(totpCode));
            if (!totpValid && !backupValid) {
              res.setHeader('X-TOTP-Required', 'true');
              AuditLogService.log({
                category: AuditLogService.CATEGORY.AUTHORIZATION,
                action: 'TOTP_VERIFICATION_FAILED',
                severity: AuditLogService.SEVERITY.HIGH,
                result: 'FAILURE',
                userId: req.user.id,
                requestId: req.id,
                ipAddress: req.ip,
                resource: req.path,
                reason: 'Invalid TOTP code',
              }).catch(() => {});
              return res.status(401).json({
                success: false,
                error: {
                  code: 'INVALID_TOTP',
                  message: 'Invalid or expired TOTP code',
                },
              });
            }
          }
        } catch (totpErr) {
          // Non-fatal: if TOTP columns don't exist yet, skip the check
          if (!totpErr.message || !totpErr.message.includes('no such column')) {
            throw totpErr;
          }
        }
      }
      // ── End TOTP check ────────────────────────────────────────────────────

      // Audit log: Admin access granted
      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHORIZATION,
        action: AuditLogService.ACTION.ADMIN_ACCESS_GRANTED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        details: {
          userRole: req.user.role,
          method: req.method
        }
      }).catch(() => {});

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Identity & Role Attachment Middleware
 * Intent: The central authentication hub that bridges legacy keys and modern DB keys.
 * Attaches both role and scope information to the request context.
 * Flow:
 * 1. Checks if 'req.apiKey' was already resolved by a previous middleware (optimization).
 * 2. Scans 'x-api-key' header.
 * 3. Database Lookup: Validates key, checks expiration/revocation, and identifies role and scopes.
 * 4. Deprecation Handling: If key is marked deprecated, injects 'Warning' headers into response.
 * 5. Legacy Fallback: Checks against process.env.API_KEYS if DB lookup fails.
 * 6. Context Injection: Populates req.user with a standardized identity object for downstream use.
 */
exports.attachUserRole = () => {
  return async (req, res, next) => {
    try {
      // Priority 1: Bearer JWT from Authorization header
      if (req.headers && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
        const token = req.headers.authorization.slice('Bearer '.length).trim();
        const result = verifyAccessToken(token);

        if (result.valid) {
          const payload = result.payload;
          const role = payload.role || 'user';

          req.user = {
            id: `jwt-${payload.sub || 'unknown'}`,
            role,
            name: `SEP10 User (${payload.sub || 'unknown'})`,
            subject: payload.sub,
            claims: payload,
            authMethod: 'jwt'
          };

          return next();
        }

        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired bearer token' }
        });
      }

      // Priority 2: Use context from existing apiKey middleware if present
      else if (req.apiKey) {
        const role = req.apiKey.role || 'user';
        const keyId = req.apiKey.id || 'legacy';

        req.user = {
          id: `apikey-${keyId}`,
          role: role,
          name: req.apiKey.name || `API Key User (${role})`,
          apiKeyId: req.apiKey.id,
          scopes: req.apiKey.scopes || [],
          isLegacy: req.apiKey.isLegacy || false
        };
        return next();
      }
      // Priority 3: x-api-key header lookup
      else if (req.headers && req.headers['x-api-key']) {
        const apiKey = req.headers['x-api-key'];
        const keyInfo = await validateApiKey(apiKey);

        if (keyInfo) {
          req.apiKey = keyInfo;
          req.user = {
            id: `apikey-${keyInfo.id}`,
            role: keyInfo.role || 'user',
            name: keyInfo.name || `API Key User (${keyInfo.role || 'user'})`,
            apiKeyId: keyInfo.id,
            scopes: keyInfo.scopes || [],
            isLegacy: false
          };

          // Graceful handling for keys slated for rotation
          if (keyInfo.isDeprecated) {
            res.setHeader('X-API-Key-Deprecated', 'true');
            res.setHeader('Warning', '299 - "API key is deprecated and will be revoked soon"');
          }

          // Suggest rotation when key age exceeds 80% of its grace period
          if (!keyInfo.isDeprecated && keyInfo.createdAt && keyInfo.gracePeriodDays) {
            const ageMs = Date.now() - keyInfo.createdAt;
            const thresholdMs = keyInfo.gracePeriodDays * 0.8 * 24 * 60 * 60 * 1000;
            if (ageMs >= thresholdMs) {
              res.setHeader('X-Rotation-Suggested', 'true');
            }
          }
        }
        // Priority 3: Legacy Environment variable support
        else if (legacyKeys.includes(apiKey)) {
          req.user = {
            id: `apikey-${apiKey}`,
            role: apiKey.startsWith('admin-') ? 'admin' : 'user',
            name: 'Legacy API Key User',
            scopes: [],
            isLegacy: true
          };
        }
        // Failure: No valid key found
        else {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or expired API key.'
            }
          });
        }
      }
      // Default: Unauthenticated Guest access
      else {
        req.user = { id: 'guest', role: 'guest', name: 'Guest', scopes: [] };
      }

      // Apply per-key rate limiting if a DB-backed key is present
      if (req.apiKey && !req.apiKey.isLegacy && req.apiKey.id) {
        return perKeyRateLimit(req, res, next);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Subscription Tier Gate Middleware Factory
 *
 * Returns a middleware that enforces a minimum subscription tier.
 * If the API key's tier is below the required minimum, responds with HTTP 402
 * and an X-Required-Tier header indicating the minimum tier needed.
 *
 * Admin keys bypass tier gating entirely.
 *
 * @param {string} minTier - Minimum required tier: 'free' | 'basic' | 'pro' | 'enterprise'
 * @returns {Function} Express middleware
 */
exports.requireTier = (minTier) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      // Admin role bypasses tier gating
      if (req.user.role === 'admin') {
        return next();
      }

      const keyTier = (req.apiKey && req.apiKey.tier) || req.user.tier || 'free';

      if (!tierMeetsMinimum(keyTier, minTier)) {
        res.setHeader('X-Required-Tier', minTier);
        return res.status(402).json({
          success: false,
          error: {
            code: 'TIER_REQUIRED',
            message: `This feature requires the '${minTier}' tier or higher. Your current tier: '${keyTier}'.`,
            requiredTier: minTier,
            currentTier: keyTier,
          },
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
