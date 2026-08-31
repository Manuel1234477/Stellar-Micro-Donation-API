/**
 * Test Isolation Utilities
 * Ensures tests are fully isolated and independent
 */

const Transaction = require('../../src/models/transaction');
const Database = require('../../src/utils/database');

/**
 * Reset all shared state between tests
 */
async function resetAllState() {
  // Clear transaction model data
  Transaction._clearAllData();
  
  // Clear database tables
  await clearDatabaseTables();
  
  // Clear environment variables that may leak between tests
  clearTestEnvironmentVariables();
  
  // Clear module cache for modules that maintain state
  clearModuleCache();
}

/**
 * Clear all database tables used in tests.
 * Covers core tables plus velocity/dedup tables added by issues #1580 and #1587.
 */
async function clearDatabaseTables() {
  const tables = [
    'idempotency_keys',
    'donations_store',
    'donation_velocity',
    'velocity_log',
    'request_dedup_cache',
    'dedup_cache',
    'transactions',
    'recurring_donations',
    'api_keys',
  ];

  for (const table of tables) {
    try {
      await Database.run(`DELETE FROM ${table}`);
    } catch (_) {
      // Table may not exist in all test contexts — safe to ignore
    }
  }

  // Clear users added by tests (but not seed rows seeded by globalSetup)
  try {
    await Database.run(`DELETE FROM users WHERE created_by = 'test-suite' OR publicKey LIKE 'GTEST%'`);
  } catch (_) {}
}

/**
 * Clear test-specific environment variables
 */
function clearTestEnvironmentVariables() {
  const testEnvVars = [
    'DEBUG_MODE',
    'MOCK_STELLAR',
    'API_KEYS',
    'NODE_ENV'
  ];
  
  // Store original values
  const originalValues = {};
  testEnvVars.forEach(key => {
    originalValues[key] = process.env[key];
  });
  
  return originalValues;
}

/**
 * Clear module cache for stateful modules
 */
function clearModuleCache() {
  const statefulModules = [
    '../src/utils/log',
    '../src/config/stellar',
    '../src/services/MockStellarService',
    '../src/config/envValidation'
  ];
  
  statefulModules.forEach(modulePath => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (error) {
      // Module may not be loaded
    }
  });
}

/**
 * Reset MockStellarService state
 * @param {MockStellarService} service - Service instance to reset
 */
function resetMockStellarService(service) {
  if (service && typeof service._clearAllData === 'function') {
    service._clearAllData();
  }
  if (service && typeof service.disableFailureSimulation === 'function') {
    service.disableFailureSimulation();
  }
}

/**
 * Create isolated test environment
 * Returns cleanup function
 */
function createIsolatedEnvironment(envOverrides = {}) {
  const originalEnv = {};
  
  // Store original environment
  Object.keys(envOverrides).forEach(key => {
    originalEnv[key] = process.env[key];
    process.env[key] = envOverrides[key];
  });
  
  // Return cleanup function
  return () => {
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  };
}

/**
 * Setup test isolation for a test suite
 * Use in beforeEach/afterEach hooks
 */
function setupTestIsolation() {
  let cleanup = null;
  
  return {
    beforeEach: async (envOverrides = {}) => {
      await resetAllState();
      cleanup = createIsolatedEnvironment(envOverrides);
    },
    afterEach: async () => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      await resetAllState();
    }
  };
}

module.exports = {
  resetAllState,
  clearDatabaseTables,
  clearTestEnvironmentVariables,
  clearModuleCache,
  resetMockStellarService,
  createIsolatedEnvironment,
  setupTestIsolation
};
