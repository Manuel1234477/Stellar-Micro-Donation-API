/**
 * Health Check Service - Dependency Status Layer
 *
 * RESPONSIBILITY: Checks the health of all critical dependencies
 * OWNER: Backend Team
 * DEPENDENCIES: Database, StellarService, IdempotencyService
 *
 * Performs bounded-time checks against each dependency and aggregates
 * results into a structured health report used by the health endpoints.
 */

const Database = require('../utils/database');

/** Maximum time (ms) allowed for any single dependency check */
const DEPENDENCY_TIMEOUT_MS = 2000;

/**
 * Run a single dependency check with a hard 2-second timeout.
 *
 * @param {string} name - Human-readable dependency name (used in logs)
 * @param {Function} checkFn - Async function that resolves on success
 * @returns {Promise<{status: string, responseTime: number, error?: string}>}
 */
async function runCheck(name, checkFn) {
  const start = Date.now();
  try {
    await Promise.race([
      checkFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} check timed out after ${DEPENDENCY_TIMEOUT_MS}ms`)), DEPENDENCY_TIMEOUT_MS)
      ),
    ]);
    return { status: 'healthy', responseTime: Date.now() - start };
  } catch (err) {
    return { status: 'unhealthy', responseTime: Date.now() - start, error: err.message };
  }
}

/**
 * Check SQLite database connectivity by running a lightweight query.
 *
 * @returns {Promise<{status: string, responseTime: number, error?: string}>}
 */
async function checkDatabase() {
  const result = await runCheck('database', () => Database.get('SELECT 1 as ok'));
  return {
    ...result,
    pool: Database.getPoolMetrics(),
    performance: Database.getPerformanceMetrics(),
  };
}

/**
 * Check Stellar Horizon reachability.
 * Uses the stellarService instance to verify the network is reachable.
 * In mock mode this always resolves immediately.
 *
 * @param {Object} stellarService - StellarService or MockStellarService instance
 * @returns {Promise<{status: string, responseTime: number, network?: string, horizonUrl?: string, error?: string}>}
 */
async function checkStellar(stellarService) {
  const result = await runCheck('stellar', async () => {
    // Both real and mock services expose getNetwork() and getHorizonUrl()
    // For the real service we do a lightweight server root fetch via the SDK server object;
    // for the mock we just confirm the service is instantiated.
    if (stellarService.server && typeof stellarService.server.root === 'function') {
      await stellarService.server.root();
    }
    // MockStellarService has no .server.root — presence of getNetwork() is enough
  });

  return {
    ...result,
    network: stellarService.getNetwork ? stellarService.getNetwork() : undefined,
    environment: stellarService.getEnvironment ? stellarService.getEnvironment().name : undefined,
    horizonUrl: stellarService.getHorizonUrl ? stellarService.getHorizonUrl() : undefined,
  };
}

/**
 * Check idempotency service by verifying the idempotency_keys table is accessible.
 * Uses a lightweight query to avoid schema-version dependencies.
 *
 * @returns {Promise<{status: string, responseTime: number, error?: string}>}
 */
async function checkIdempotency() {
  return runCheck('idempotency', () =>
    Database.get('SELECT COUNT(*) as count FROM idempotency_keys')
  );
}

/**
 * Check network status via NetworkStatusService
 * @param {Object} networkStatusService - NetworkStatusService instance
 * @returns {Promise<{status: string, responseTime: number, networkStatus?: string, error?: string}>}
 */
async function checkNetworkStatus(networkStatusService) {
  const result = await runCheck('network', async () => {
    if (networkStatusService && typeof networkStatusService.getStatus === 'function') {
      const status = networkStatusService.getStatus();
      // Network status is informational, not critical
      return status;
    }
  });

  return {
    ...result,
    networkStatus: result.status === 'healthy' ? 'unknown' : undefined,
  };
}

/**
 * Aggregate all dependency checks and compute an overall status.
 *
 * Overall rules:
 *  - "healthy"   → all dependencies healthy
 *  - "degraded"  → some dependencies unhealthy (non-critical)
 *  - "unhealthy" → database is unhealthy (critical dependency)
 *
 * @param {Object} stellarService - StellarService or MockStellarService instance
 * @param {Object} [networkStatusService] - Optional NetworkStatusService instance
 * @returns {Promise<{status: string, dependencies: Object, timestamp: string}>}
 */
async function getFullHealth(stellarService, networkStatusService) {
  // Call through module.exports so Jest spies can intercept individual checks
  const self = module.exports;
  const checks = [
    self.checkDatabase(),
    self.checkStellar(stellarService),
    self.checkIdempotency(),
  ];

  if (networkStatusService) {
    checks.push(self.checkNetworkStatus(networkStatusService));
  }

  const [database, stellar, idempotency, network] = await Promise.all(checks);

  const dependencies = { database, stellar, idempotency };
  if (network) {
    dependencies.network = network;
  }

  let status;
  if (database.status === 'unhealthy') {
    status = 'unhealthy';
  } else if (stellar.status === 'unhealthy' || idempotency.status === 'unhealthy') {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return { status, dependencies, timestamp: new Date().toISOString() };
}

/**
 * Liveness check — confirms the process is alive.
 * Never checks external dependencies; always returns healthy.
 *
 * @returns {{status: string, timestamp: string}}
 */
function getLiveness() {
  return { status: 'alive', timestamp: new Date().toISOString() };
}

/**
 * Readiness check — confirms all dependencies are reachable.
 * Returns the same shape as getFullHealth but is used specifically
 * to signal whether the instance should receive traffic.
 *
 * @param {Object} stellarService
 * @param {Object} [networkStatusService] - Optional NetworkStatusService instance
 * @returns {Promise<{ready: boolean, status: string, dependencies: Object, timestamp: string}>}
 */
async function getReadiness(stellarService, networkStatusService) {
  const health = await getFullHealth(stellarService, networkStatusService);
  const ready = health.status === 'healthy';
  return { ready, ...health };
}

module.exports = {
  checkDatabase,
  checkStellar,
  checkIdempotency,
  checkNetworkStatus,
  getFullHealth,
  getLiveness,
  getReadiness,
  DEPENDENCY_TIMEOUT_MS,
};
