/**
 * Feature Flags Middleware - Feature Flag Enforcement Layer
 * 
 * RESPONSIBILITY: Feature flag checking and route protection
 * OWNER: Platform Team
 * DEPENDENCIES: Feature flags utility, logging, error handling
 * 
 * Provides middleware for protecting routes behind feature flags and
 * attaching flag state to requests for downstream use.
 */

const featureFlagsUtil = require('../utils/featureFlags');
const { ForbiddenError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const AuditLogService = require('../services/AuditLogService');

/**
 * Middleware to check if a feature flag is enabled
 * 
 * Evaluates the flag with the following scope priority:
 * 1. API key-specific flag (if API key present)
 * 2. Environment-specific flag
 * 3. Global flag
 * 
 * If flag is disabled, returns 403 Forbidden.
 * If flag is not found, uses defaultValue (default: false).
 * 
 * @param {string} flagName - Name of the feature flag to check
 * @param {Object} options - Configuration options
 * @param {boolean} options.defaultValue - Default value if flag not found (default: false)
 * @param {string} options.environment - Environment name for scope evaluation
 * @returns {Function} - Express middleware function
 */
exports.checkFeatureFlag = (flagName, options = {}) => {
  const { defaultValue = false, environment = process.env.NODE_ENV || 'development' } = options;

  return async (req, res, next) => {
    try {
      if (!flagName || typeof flagName !== 'string') {
        log.error('FEATURE_FLAGS', 'Invalid flag name in middleware', { flagName });
        throw new ForbiddenError('Feature flag configuration error');
      }

      // Extract API key ID if available
      const apiKeyId = req.apiKey?.id;

      // Evaluate the flag
      const isEnabled = await featureFlagsUtil.isFeatureEnabled(flagName, {
        apiKeyId,
        environment,
        defaultValue
      });

      // Attach flag state to request for downstream use
      if (!req.flags) {
        req.flags = {};
      }
      req.flags[flagName] = isEnabled;

      if (!isEnabled) {
        // Audit log: Feature flag denied
        AuditLogService.log({
          category: AuditLogService.CATEGORY.AUTHORIZATION,
          action: AuditLogService.ACTION.FEATURE_FLAG_DENIED,
          severity: AuditLogService.SEVERITY.MEDIUM,
          result: 'FAILURE',
          userId: req.user?.id,
          apiKeyId,
          requestId: req.id,
          ipAddress: req.ip,
          resource: req.path,
          reason: `Feature flag disabled: ${flagName}`,
          details: {
            flagName,
            method: req.method,
            environment
          }
        }).catch(() => {});

        throw new ForbiddenError(
          `Feature not available. Flag: ${flagName}`,
          { flagName }
        );
      }

      // Audit log: Feature flag allowed
      AuditLogService.log({
        category: AuditLogService.CATEGORY.AUTHORIZATION,
        action: AuditLogService.ACTION.FEATURE_FLAG_ALLOWED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: req.user?.id,
        apiKeyId,
        requestId: req.id,
        ipAddress: req.ip,
        resource: req.path,
        details: {
          flagName,
          method: req.method,
          environment
        }
      }).catch(() => {});

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to attach all feature flags to request
 * 
 * Evaluates all flags and attaches them to req.flags for conditional logic.
 * Does not block requests - flags are available for downstream use.
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.environment - Environment name for scope evaluation
 * @returns {Function} - Express middleware function
 */
exports.attachFeatureFlags = (options = {}) => {
  const { environment = process.env.NODE_ENV || 'development' } = options;

  return async (req, res, next) => {
    try {
      const apiKeyId = req.apiKey?.id;

      // Get all flags
      const allFlags = await featureFlagsUtil.getAllFlags();

      // Evaluate each flag and attach to request
      req.flags = {};
      for (const flag of allFlags) {
        const isEnabled = await featureFlagsUtil.isFeatureEnabled(flag.name, {
          apiKeyId,
          environment,
          defaultValue: false
        });
        req.flags[flag.name] = isEnabled;
      }

      log.debug('FEATURE_FLAGS', 'Flags attached to request', {
        flagCount: Object.keys(req.flags).length,
        apiKeyId
      });

      next();
    } catch (error) {
      log.error('FEATURE_FLAGS', 'Error attaching feature flags', {
        error: error.message
      });
      // Don't block request on error - continue with empty flags
      req.flags = {};
      next();
    }
  };
};

/**
 * Conditional middleware - only applies if flag is enabled
 * 
 * Useful for applying middleware conditionally based on feature flags.
 * If flag is disabled, middleware is skipped.
 * 
 * @param {string} flagName - Name of the feature flag
 * @param {Function} middleware - Middleware to apply conditionally
 * @param {Object} options - Configuration options
 * @param {string} options.environment - Environment name for scope evaluation
 * @returns {Function} - Express middleware function
 */
exports.conditionalMiddleware = (flagName, middleware, options = {}) => {
  const { environment = process.env.NODE_ENV || 'development' } = options;

  return async (req, res, next) => {
    try {
      const apiKeyId = req.apiKey?.id;

      const isEnabled = await featureFlagsUtil.isFeatureEnabled(flagName, {
        apiKeyId,
        environment,
        defaultValue: false
      });

      if (isEnabled) {
        log.debug('FEATURE_FLAGS', 'Conditional middleware enabled', { flagName });
        return middleware(req, res, next);
      }

      log.debug('FEATURE_FLAGS', 'Conditional middleware skipped', { flagName });
      next();
    } catch (error) {
      log.error('FEATURE_FLAGS', 'Error in conditional middleware', {
        flagName,
        error: error.message
      });
      next(error);
    }
  };
};

/**
 * Conditional route handler - only executes if flag is enabled
 * 
 * Useful for conditional logic within route handlers.
 * 
 * @param {string} flagName - Name of the feature flag
 * @param {Function} handler - Handler to execute if flag is enabled
 * @param {Function} fallbackHandler - Optional fallback handler if flag is disabled
 * @param {Object} options - Configuration options
 * @param {string} options.environment - Environment name for scope evaluation
 * @returns {Function} - Express route handler
 */
exports.conditionalHandler = (flagName, handler, fallbackHandler = null, options = {}) => {
  const { environment = process.env.NODE_ENV || 'development' } = options;

  return async (req, res, next) => {
    try {
      const apiKeyId = req.apiKey?.id;

      const isEnabled = await featureFlagsUtil.isFeatureEnabled(flagName, {
        apiKeyId,
        environment,
        defaultValue: false
      });

      if (isEnabled) {
        log.debug('FEATURE_FLAGS', 'Conditional handler enabled', { flagName });
        return handler(req, res, next);
      }

      if (fallbackHandler) {
        log.debug('FEATURE_FLAGS', 'Conditional handler using fallback', { flagName });
        return fallbackHandler(req, res, next);
      }

      log.debug('FEATURE_FLAGS', 'Conditional handler skipped', { flagName });
      throw new ForbiddenError(`Feature not available. Flag: ${flagName}`);
    } catch (error) {
      next(error);
    }
  };
};
