/**
 * Feature Flags Public Routes - Public Feature Flag Endpoint
 * 
 * RESPONSIBILITY: Public endpoint for clients to query their feature flags
 * OWNER: Platform Team
 * DEPENDENCIES: Feature flags utility, API key middleware
 * 
 * Provides:
 * - GET /feature-flags - Returns enabled flags for authenticated API key
 */

'use strict';

const express = require('express');
const router = express.Router();
const featureFlagsUtil = require('../utils/featureFlags');
const requireApiKey = require('../middleware/apiKey');
const log = require('../utils/log');

/**
 * GET /feature-flags
 * Returns the list of enabled feature flags for the current API key
 * 
 * Takes into account the flag evaluation hierarchy:
 * 1. API key-specific overrides (highest priority)
 * 2. Global flags (lowest priority)
 * 
 * Response includes cache information for debugging
 * 
 * Query parameters:
 * - environment: Optional environment name for evaluation
 */
router.get('/', requireApiKey, async (req, res, next) => {
  try {
    // Get the current API key ID from middleware
    const apiKeyId = req.apiKey?.id;
    const environment = req.query.environment || process.env.NODE_ENV || 'production';

    if (!apiKeyId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key is required'
        }
      });
    }

    // Get effective flags for this API key
    const effectiveFlags = await featureFlagsUtil.getEffectiveFlagsForKey(
      apiKeyId,
      environment
    );

    // Filter to only enabled flags
    const enabledFlags = Object.entries(effectiveFlags)
      .filter(([_, enabled]) => enabled === true)
      .map(([name, _]) => name);

    // Get cache statistics for debugging
    const cacheStats = featureFlagsUtil.getCacheStats();

    log.debug('FEATURE_FLAGS_PUBLIC', 'Feature flags retrieved', {
      apiKeyId: apiKeyId.substring(0, 8) + '...',
      enabledCount: enabledFlags.length,
      totalFlags: Object.keys(effectiveFlags).length,
      environment,
      cacheAgeMs: cacheStats.cacheAgeMs
    });

    res.json({
      success: true,
      data: {
        enabled: enabledFlags,
        /**
         * Full flag map for clients that need to check disabled flags too
         */
        flags: effectiveFlags,
        metadata: {
          apiKeyId: apiKeyId.substring(0, 12) + '...', // Hide most of the key
          environment,
          timestamp: new Date().toISOString(),
          cacheAgeMs: cacheStats.cacheAgeMs,
          cacheTtlMs: cacheStats.ttlMs
        }
      }
    });
  } catch (error) {
    log.error('FEATURE_FLAGS_PUBLIC', 'Error retrieving feature flags', {
      error: error.message,
      apiKeyId: req.apiKey?.id?.substring(0, 8) + '...'
    });
    next(error);
  }
});

/**
 * GET /feature-flags/:flag
 * Check if a specific flag is enabled for the current API key
 * 
 * Query parameters:
 * - environment: Optional environment name for evaluation
 * 
 * Returns:
 * {
 *   success: true,
 *   data: {
 *     flag: string,
 *     enabled: boolean,
 *     environment: string,
 *     cacheAgeMs: number
 *   }
 * }
 */
router.get('/:flag', requireApiKey, async (req, res, next) => {
  try {
    const { flag } = req.params;
    const apiKeyId = req.apiKey?.id;
    const environment = req.query.environment || process.env.NODE_ENV || 'production';

    if (!flag || typeof flag !== 'string' || flag.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FLAG_NAME',
          message: 'Flag name is required'
        }
      });
    }

    if (!apiKeyId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key is required'
        }
      });
    }

    // Check if the flag is enabled for this API key
    const isEnabled = await featureFlagsUtil.isFeatureEnabled(flag, {
      apiKeyId,
      environment,
      defaultValue: false
    });

    // Get cache statistics for debugging
    const cacheStats = featureFlagsUtil.getCacheStats();

    log.debug('FEATURE_FLAGS_PUBLIC', 'Flag checked', {
      flag,
      apiKeyId: apiKeyId.substring(0, 8) + '...',
      enabled: isEnabled,
      environment,
      cacheAgeMs: cacheStats.cacheAgeMs
    });

    res.json({
      success: true,
      data: {
        flag,
        enabled: isEnabled,
        environment,
        timestamp: new Date().toISOString(),
        cacheAgeMs: cacheStats.cacheAgeMs
      }
    });
  } catch (error) {
    log.error('FEATURE_FLAGS_PUBLIC', 'Error checking flag', {
      flag: req.params.flag,
      error: error.message,
      apiKeyId: req.apiKey?.id?.substring(0, 8) + '...'
    });
    next(error);
  }
});

module.exports = router;
