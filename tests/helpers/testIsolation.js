/**
 * Test Isolation Utilities
 * Ensures tests are fully isolated and independent
 */

const Transaction = require('../../src/routes/models/transaction');
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
 * Clear all database tables used in tests
 */
async function clearDatabaseTables() {
  try {
    await Database.run('DELETE FROM idempotency_keys');
  } catch (error) {
    // Table may not exist in some test contexts
  }
  
  try {
    await Database.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  } catch (error) {
    // Table may not exist in some test contexts
  }
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
