/**
 * Feature Flags Utility - Feature Flag Evaluation Engine
 * 
 * RESPONSIBILITY: Feature flag evaluation with multi-level scope support
 * OWNER: Platform Team
 * DEPENDENCIES: Database, logging
 * 
 * Provides efficient flag evaluation with support for global, per-environment,
 * and per-API-key scopes. Implements caching for performance and audit logging
 * for compliance.
 */

const Database = require('./database');
const log = require('./log');

/**
 * Feature flag scopes - determines where a flag applies
 */
const FLAG_SCOPES = {
  GLOBAL: 'global',           // Applies to all users/environments
  ENVIRONMENT: 'environment', // Applies to specific environment (dev, staging, prod)
  API_KEY: 'api_key'          // Applies to specific API key
};

/**
 * Feature flag cache - in-memory cache for performance
 * Structure: { flagName: { scope: value, ... }, ... }
 * TTL: 10 seconds for real-time flag updates during runtime changes
 */
const flagCache = new Map();
const CACHE_TTL_MS = 10000; // 10 second cache TTL for runtime responsiveness
let lastCacheRefresh = 0;

/**
 * Initialize feature flags table
 * Called during database initialization
 */
async function initializeFeatureFlagsTable() {
  try {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 0,
        scope TEXT NOT NULL CHECK(scope IN ('global', 'environment', 'api_key')),
        scope_value TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT,
        UNIQUE(name, scope, scope_value)
      )
    `);

    // Create index for efficient lookups
    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_feature_flags_name_scope 
      ON feature_flags(name, scope, scope_value)
    `);

    log.info('FEATURE_FLAGS', 'Feature flags table initialized');
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Failed to initialize feature flags table', { error: error.message });
    throw error;
  }
}

/**
 * Refresh cache if TTL expired
 */
async function refreshCacheIfNeeded() {
  const now = Date.now();
  if (now - lastCacheRefresh > CACHE_TTL_MS) {
    await refreshCache();
  }
}

/**
 * Refresh entire flag cache from database
 */
async function refreshCache() {
  try {
    flagCache.clear();
    const flags = await Database.query('SELECT * FROM feature_flags', []);
    
    flags.forEach(flag => {
      if (!flagCache.has(flag.name)) {
        flagCache.set(flag.name, {});
      }
      
      const scopeKey = flag.scope_value ? `${flag.scope}:${flag.scope_value}` : flag.scope;
      flagCache.get(flag.name)[scopeKey] = flag.enabled;
    });

    lastCacheRefresh = Date.now();
    log.debug('FEATURE_FLAGS', 'Cache refreshed', { flagCount: flagCache.size });
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Failed to refresh flag cache', { error: error.message });
    // Don't throw - allow graceful degradation with empty cache
  }
}

/**
 * Evaluate a feature flag with multi-level scope support
 * 
 * Evaluation order (highest to lowest priority):
 * 1. API key-specific flag (if apiKeyId provided)
 * 2. Environment-specific flag (if environment provided)
 * 3. Global flag
 * 
 * @param {string} flagName - Name of the feature flag
 * @param {Object} options - Evaluation options
 * @param {string} options.apiKeyId - API key ID for per-key scope
 * @param {string} options.environment - Environment name for per-environment scope
 * @param {boolean} options.defaultValue - Default value if flag not found (default: false)
 * @returns {Promise<boolean>} - Whether the flag is enabled
 */
async function isFeatureEnabled(flagName, options = {}) {
  const { apiKeyId, environment, defaultValue = false } = options;

  if (!flagName || typeof flagName !== 'string') {
    log.warn('FEATURE_FLAGS', 'Invalid flag name', { flagName });
    return defaultValue;
  }

  try {
    await refreshCacheIfNeeded();

    const flagScopes = flagCache.get(flagName);
    if (!flagScopes) {
      log.debug('FEATURE_FLAGS', 'Flag not found in cache', { flagName });
      return defaultValue;
    }

    // Check API key-specific flag (highest priority)
    if (apiKeyId) {
      const apiKeyScopeKey = `${FLAG_SCOPES.API_KEY}:${apiKeyId}`;
      if (apiKeyScopeKey in flagScopes) {
        const enabled = flagScopes[apiKeyScopeKey];
        log.debug('FEATURE_FLAGS', 'Flag evaluated at API key scope', {
          flagName,
          apiKeyId,
          enabled
        });
        return enabled;
      }
    }

    // Check environment-specific flag (medium priority)
    if (environment) {
      const envScopeKey = `${FLAG_SCOPES.ENVIRONMENT}:${environment}`;
      if (envScopeKey in flagScopes) {
        const enabled = flagScopes[envScopeKey];
        log.debug('FEATURE_FLAGS', 'Flag evaluated at environment scope', {
          flagName,
          environment,
          enabled
        });
        return enabled;
      }
    }

    // Check global flag (lowest priority)
    if (FLAG_SCOPES.GLOBAL in flagScopes) {
      const enabled = flagScopes[FLAG_SCOPES.GLOBAL];
      log.debug('FEATURE_FLAGS', 'Flag evaluated at global scope', {
        flagName,
        enabled
      });
      return enabled;
    }

    log.debug('FEATURE_FLAGS', 'No matching flag scope found', { flagName });
    return defaultValue;
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error evaluating feature flag', {
      flagName,
      error: error.message
    });
    return defaultValue;
  }
}

/**
 * Get all flags for a specific scope
 * 
 * @param {string} scope - Scope to query (global, environment, api_key)
 * @param {string} scopeValue - Value for non-global scopes (environment name or API key ID)
 * @returns {Promise<Array>} - Array of flag objects
 */
async function getFlagsByScope(scope, scopeValue = null) {
  try {
    let query = 'SELECT * FROM feature_flags WHERE scope = ?';
    const params = [scope];

    if (scopeValue) {
      query += ' AND scope_value = ?';
      params.push(scopeValue);
    }

    query += ' ORDER BY name ASC';
    return await Database.query(query, params);
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error fetching flags by scope', {
      scope,
      scopeValue,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get all flags
 * 
 * @returns {Promise<Array>} - Array of all flag objects
 */
async function getAllFlags() {
  try {
    return await Database.query(
      'SELECT * FROM feature_flags ORDER BY name ASC, scope ASC, scope_value ASC',
      []
    );
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error fetching all flags', { error: error.message });
    throw error;
  }
}

/**
 * Get a specific flag by name and scope
 * 
 * @param {string} flagName - Name of the flag
 * @param {string} scope - Scope (global, environment, api_key)
 * @param {string} scopeValue - Value for non-global scopes
 * @returns {Promise<Object|null>} - Flag object or null if not found
 */
async function getFlag(flagName, scope, scopeValue = null) {
  try {
    let query = 'SELECT * FROM feature_flags WHERE name = ? AND scope = ?';
    const params = [flagName, scope];

    if (scopeValue) {
      query += ' AND scope_value = ?';
      params.push(scopeValue);
    } else {
      query += ' AND scope_value IS NULL';
    }

    return await Database.get(query, params);
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error fetching flag', {
      flagName,
      scope,
      scopeValue,
      error: error.message
    });
    throw error;
  }
}

/**
 * Create or update a feature flag
 * 
 * @param {string} flagName - Name of the flag
 * @param {boolean} enabled - Whether the flag is enabled
 * @param {string} scope - Scope (global, environment, api_key)
 * @param {string} scopeValue - Value for non-global scopes
 * @param {Object} options - Additional options
 * @param {string} options.description - Flag description
 * @param {string} options.updatedBy - User/system that updated the flag
 * @returns {Promise<Object>} - Updated flag object
 */
async function setFlag(flagName, enabled, scope, scopeValue = null, options = {}) {
  const { description, updatedBy = 'system' } = options;

  try {
    // Validate scope
    if (!Object.values(FLAG_SCOPES).includes(scope)) {
      throw new Error(`Invalid scope: ${scope}`);
    }

    // Validate scope_value requirement
    if (scope !== FLAG_SCOPES.GLOBAL && !scopeValue) {
      throw new Error(`scope_value required for scope: ${scope}`);
    }

    // Check if flag exists
    const existing = await getFlag(flagName, scope, scopeValue);

    if (existing) {
      // Update existing flag
      await Database.run(
        `UPDATE feature_flags 
         SET enabled = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
         WHERE id = ?`,
        [enabled ? 1 : 0, description || existing.description, updatedBy, existing.id]
      );
    } else {
      // Create new flag
      await Database.run(
        `INSERT INTO feature_flags (name, enabled, scope, scope_value, description, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [flagName, enabled ? 1 : 0, scope, scopeValue, description, updatedBy]
      );
    }

    // Invalidate cache
    flagCache.delete(flagName);
    lastCacheRefresh = 0;

    log.info('FEATURE_FLAGS', 'Flag updated', {
      flagName,
      enabled,
      scope,
      scopeValue,
      updatedBy
    });

    return getFlag(flagName, scope, scopeValue);
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error setting flag', {
      flagName,
      scope,
      scopeValue,
      error: error.message
    });
    throw error;
  }
}

/**
 * Delete a feature flag
 * 
 * @param {string} flagName - Name of the flag
 * @param {string} scope - Scope (global, environment, api_key)
 * @param {string} scopeValue - Value for non-global scopes
 * @param {string} deletedBy - User/system that deleted the flag
 * @returns {Promise<boolean>} - Whether deletion was successful
 */
async function deleteFlag(flagName, scope, scopeValue = null, deletedBy = 'system') {
  try {
    const flag = await getFlag(flagName, scope, scopeValue);
    if (!flag) {
      return false;
    }

    await Database.run(
      'DELETE FROM feature_flags WHERE id = ?',
      [flag.id]
    );

    // Invalidate cache
    flagCache.delete(flagName);
    lastCacheRefresh = 0;

    log.info('FEATURE_FLAGS', 'Flag deleted', {
      flagName,
      scope,
      scopeValue,
      deletedBy
    });

    return true;
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error deleting flag', {
      flagName,
      scope,
      scopeValue,
      error: error.message
    });
    throw error;
  }
}

/**
 * Bulk set flags from environment variables
 * Format: FEATURE_ONE=on|off,FEATURE_TWO=on
 * 
 * @param {string} envVarValue - Comma-separated flag definitions
 * @returns {Promise<void>}
 */
async function loadFlagsFromEnv(envVarValue) {
  if (!envVarValue) {
    return;
  }

  try {
    const flagDefs = envVarValue.split(',').map(f => f.trim()).filter(f => f);

    for (const flagDef of flagDefs) {
      const [flagName, enabledStr] = flagDef.split('=').map(s => s.trim());
      if (!flagName) continue;

      const enabled = enabledStr === 'true';
      await setFlag(flagName, enabled, FLAG_SCOPES.GLOBAL, null, {
        description: 'Loaded from environment variable',
        updatedBy: 'env-loader'
      });
    }

    log.info('FEATURE_FLAGS', 'Flags loaded from environment', { count: flagDefs.length });
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error loading flags from environment', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Clear all flags (useful for testing)
 * 
 * @returns {Promise<void>}
 */
async function clearAllFlags() {
  try {
    await Database.run('DELETE FROM feature_flags', []);
    flagCache.clear();
    lastCacheRefresh = 0;
    log.info('FEATURE_FLAGS', 'All flags cleared');
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error clearing flags', { error: error.message });
    throw error;
  }
}

/**
 * Get all effective flags for an API key
 * Returns the enabled state of all flags for this specific key,
 * applying precedence: api_key > environment > global
 * 
 * @param {string} apiKeyId - API key ID for evaluation
 * @param {string} environment - Environment name for evaluation
 * @returns {Promise<Object>} - Object mapping flag names to enabled status
 */
async function getEffectiveFlagsForKey(apiKeyId, environment = null) {
  try {
    await refreshCacheIfNeeded();

    const effectiveFlags = {};
    
    // Iterate through all flags and evaluate for this key
    for (const [flagName, flagScopes] of flagCache) {
      // Check API key-specific flag (highest priority)
      if (apiKeyId) {
        const apiKeyScopeKey = `${FLAG_SCOPES.API_KEY}:${apiKeyId}`;
        if (apiKeyScopeKey in flagScopes) {
          effectiveFlags[flagName] = flagScopes[apiKeyScopeKey];
          continue;
        }
      }

      // Check environment-specific flag (medium priority)
      if (environment) {
        const envScopeKey = `${FLAG_SCOPES.ENVIRONMENT}:${environment}`;
        if (envScopeKey in flagScopes) {
          effectiveFlags[flagName] = flagScopes[envScopeKey];
          continue;
        }
      }

      // Check global flag (lowest priority)
      if (FLAG_SCOPES.GLOBAL in flagScopes) {
        effectiveFlags[flagName] = flagScopes[FLAG_SCOPES.GLOBAL];
      }
    }

    return effectiveFlags;
  } catch (error) {
    log.error('FEATURE_FLAGS', 'Error getting effective flags for key', {
      apiKeyId,
      environment,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get flag override for a specific API key
 * Returns the override value or null if not set
 * 
 * @param {string} flagName - Name of the flag
 * @param {string} apiKeyId - API key ID
 * @returns {Promise<Object|null>} - Flag record or null
 */
async function getFlagOverrideForKey(flagName, apiKeyId) {
  return getFlag(flagName, FLAG_SCOPES.API_KEY, apiKeyId);
}

/**
 * Set flag override for a specific API key
 * This allows per-key testing and beta features
 * 
 * @param {string} flagName - Name of the flag
 * @param {boolean} enabled - Whether to enable for this key
 * @param {string} apiKeyId - API key ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Updated flag record
 */
async function setFlagOverrideForKey(flagName, enabled, apiKeyId, options = {}) {
  return setFlag(
    flagName,
    enabled,
    FLAG_SCOPES.API_KEY,
    apiKeyId,
    { ...options, updatedBy: options.updatedBy || 'api-override' }
  );
}

/**
 * Clear flag override for a specific API key
 * 
 * @param {string} flagName - Name of the flag
 * @param {string} apiKeyId - API key ID
 * @returns {Promise<boolean>} - Whether deletion was successful
 */
async function clearFlagOverrideForKey(flagName, apiKeyId) {
  return deleteFlag(flagName, FLAG_SCOPES.API_KEY, apiKeyId, 'system');
}

/**
 * Get cache statistics for monitoring
 * 
 * @returns {Object} - Cache statistics
 */
function getCacheStats() {
  return {
    cacheSize: flagCache.size,
    lastRefreshTime: new Date(lastCacheRefresh),
    cacheAgeMs: Date.now() - lastCacheRefresh,
    ttlMs: CACHE_TTL_MS,
    needsRefresh: Date.now() - lastCacheRefresh > CACHE_TTL_MS
  };
}

module.exports = {
  // Constants
  FLAG_SCOPES,

  // Initialization
  initializeFeatureFlagsTable,

  // Evaluation
  isFeatureEnabled,

  // Query
  getFlagsByScope,
  getAllFlags,
  getFlag,
  getEffectiveFlagsForKey,

  // Mutation
  setFlag,
  deleteFlag,
  loadFlagsFromEnv,

  // Per-key overrides
  getFlagOverrideForKey,
  setFlagOverrideForKey,
  clearFlagOverrideForKey,

  // Testing & Monitoring
  clearAllFlags,
  refreshCache,
  getCacheStats
};
