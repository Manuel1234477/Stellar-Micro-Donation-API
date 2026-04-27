/**
 * Bug Condition Exploration Test: Health Check Timeout
 * Spec: fix-health-check-timeout
 *
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

const HealthCheckService = require('../../src/services/HealthCheckService');

jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  getPoolMetrics: jest.fn().mockReturnValue({ active: 0, idle: 1 }),
  getPerformanceMetrics: jest.fn().mockReturnValue({ avgQueryTime: 1 }),
}));

const Database = require('../../src/utils/database');

describe('Bug Condition Exploration: Health Check Timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: database and idempotency checks succeed quickly
    Database.get.mockResolvedValue({ ok: 1 });
  });

  /**
   * Property 1: Bug Condition - Health Endpoint Response Time
   *
   * **Validates: Requirements 1.1, 1.2, 1.3**
   *
   * This test demonstrates the bug: when a dependency check (Stellar, database, or idempotency)
   * takes longer than 500ms, the health endpoint should respond within 500ms by timing out
   * the slow check. On UNFIXED code, this test will FAIL because DEPENDENCY_TIMEOUT_MS = 2000ms.
   *
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test FAILS (elapsed time ~2000ms instead of ≤500ms)
   * **EXPECTED OUTCOME AFTER FIX**: Test PASSES (elapsed time ≤500ms)
   */
  describe('Property 1: Bug Condition - Health Endpoint Response Time', () => {
    it('should respond within 500ms when Stellar check is slow (2500ms delay)', async () => {
      // Mock Stellar service with a slow server.root() call (2500ms delay)
      const slowStellarService = {
        server: {
          root: jest.fn().mockImplementation(
            () =>
              new Promise((resolve) => {
                setTimeout(() => resolve({}), 2500);
              })
          ),
        },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };

      const start = Date.now();
      const result = await HealthCheckService.getFullHealth(slowStellarService);
      const elapsed = Date.now() - start;

      // CRITICAL ASSERTION: Health endpoint must respond within 500ms
      // On UNFIXED code (DEPENDENCY_TIMEOUT_MS = 2000), this will FAIL with elapsed ~2000ms
      // After fix (DEPENDENCY_TIMEOUT_MS = 500), this will PASS with elapsed ~500ms
      // Allow 10ms tolerance for JavaScript timing overhead
      expect(elapsed).toBeLessThanOrEqual(510);

      // The slow Stellar check should be marked as unhealthy due to timeout
      expect(result.dependencies.stellar.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy'); // Stellar is critical
    });

    it('should respond within 500ms when database check is slow (2500ms delay)', async () => {
      // Mock database with a slow query (2500ms delay)
      Database.get.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: 1 }), 2500);
          })
      );

      const mockStellarService = {
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };

      const start = Date.now();
      const result = await HealthCheckService.getFullHealth(mockStellarService);
      const elapsed = Date.now() - start;

      // CRITICAL ASSERTION: Health endpoint must respond within 500ms
      // Allow 10ms tolerance for JavaScript timing overhead
      expect(elapsed).toBeLessThanOrEqual(510);

      // The slow database check should be marked as unhealthy due to timeout
      expect(result.dependencies.database.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy'); // Database is critical
    });

    it('should respond within 500ms when idempotency check is slow (2500ms delay)', async () => {
      // Mock idempotency check with a slow query (2500ms delay)
      // First call is for checkDatabase (fast), second call is for checkIdempotency (slow)
      Database.get
        .mockResolvedValueOnce({ ok: 1 }) // checkDatabase - fast
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ count: 0 }), 2500);
            })
        ); // checkIdempotency - slow

      const mockStellarService = {
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };

      const start = Date.now();
      const result = await HealthCheckService.getFullHealth(mockStellarService);
      const elapsed = Date.now() - start;

      // CRITICAL ASSERTION: Health endpoint must respond within 500ms
      // Allow 10ms tolerance for JavaScript timing overhead
      expect(elapsed).toBeLessThanOrEqual(510);

      // The slow idempotency check should be marked as unhealthy due to timeout
      expect(result.dependencies.idempotency.status).toBe('unhealthy');
      expect(result.status).toBe('degraded'); // Idempotency is non-critical
    });

    it('should respond within 500ms when all checks are slow (2500ms delay)', async () => {
      // Mock all checks to be slow
      Database.get.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: 1 }), 2500);
          })
      );

      const slowStellarService = {
        server: {
          root: jest.fn().mockImplementation(
            () =>
              new Promise((resolve) => {
                setTimeout(() => resolve({}), 2500);
              })
          ),
        },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };

      const start = Date.now();
      const result = await HealthCheckService.getFullHealth(slowStellarService);
      const elapsed = Date.now() - start;

      // CRITICAL ASSERTION: Health endpoint must respond within 500ms
      // Even when ALL checks are slow, the endpoint should timeout all of them at 500ms
      // Allow 10ms tolerance for JavaScript timing overhead
      expect(elapsed).toBeLessThanOrEqual(510);

      // All checks should be marked as unhealthy due to timeout
      expect(result.dependencies.database.status).toBe('unhealthy');
      expect(result.dependencies.stellar.status).toBe('unhealthy');
      expect(result.dependencies.idempotency.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });

    it('should respond within 500ms when Stellar check is at boundary (501ms delay)', async () => {
      // Mock Stellar service with a delay just over the 500ms budget
      const slowStellarService = {
        server: {
          root: jest.fn().mockImplementation(
            () =>
              new Promise((resolve) => {
                setTimeout(() => resolve({}), 501);
              })
          ),
        },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };

      const start = Date.now();
      const result = await HealthCheckService.getFullHealth(slowStellarService);
      const elapsed = Date.now() - start;

      // CRITICAL ASSERTION: Health endpoint must respond within 500ms
      // On UNFIXED code (DEPENDENCY_TIMEOUT_MS = 2000), this will take ~501ms and PASS incorrectly
      // After fix (DEPENDENCY_TIMEOUT_MS = 500), this will timeout at 500ms and PASS correctly
      // Allow 10ms tolerance for JavaScript timing overhead
      expect(elapsed).toBeLessThanOrEqual(510);

      // The Stellar check should be marked as unhealthy due to timeout
      expect(result.dependencies.stellar.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });
  });

  /**
   * Property 2: Preservation - Health Status Classification Unchanged
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
   *
   * These tests verify that when all dependency checks complete within 500ms (fast responses),
   * the health status classification logic remains unchanged. This ensures the fix doesn't
   * introduce regressions in the core health check logic.
   *
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Tests PASS (baseline behavior)
   * **EXPECTED OUTCOME AFTER FIX**: Tests PASS (behavior preserved)
   */
  describe('Property 2: Preservation - Health Status Classification Unchanged', () => {
    describe('Fast dependency responses - status classification', () => {
      it('should return status "healthy" when all dependencies are healthy and fast', async () => {
        // Mock all dependencies to respond quickly and successfully
        Database.get.mockResolvedValue({ ok: 1 });

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Validates: Requirement 3.1 - all dependencies healthy returns "healthy"
        expect(result.status).toBe('healthy');
        expect(result.dependencies.database.status).toBe('healthy');
        expect(result.dependencies.stellar.status).toBe('healthy');
        expect(result.dependencies.idempotency.status).toBe('healthy');
      });

      it('should return status "unhealthy" when database is unhealthy (fast failure)', async () => {
        // Mock database to fail quickly
        Database.get.mockRejectedValueOnce(new Error('Database connection failed'));
        Database.get.mockResolvedValue({ count: 0 }); // idempotency check succeeds

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Validates: Requirement 3.2 - database unhealthy returns "unhealthy"
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.database.status).toBe('unhealthy');
        expect(result.dependencies.database.error).toContain('Database connection failed');
      });

      it('should return status "unhealthy" when Stellar is unhealthy (fast failure)', async () => {
        // Mock Stellar to fail quickly
        Database.get.mockResolvedValue({ ok: 1 });

        const mockStellarService = {
          server: {
            root: jest.fn().mockRejectedValue(new Error('Stellar network unreachable')),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Validates: Requirement 3.3 - Stellar unhealthy returns "unhealthy"
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.stellar.status).toBe('unhealthy');
        expect(result.dependencies.stellar.error).toContain('Stellar network unreachable');
      });

      it('should return status "degraded" when idempotency is unhealthy (fast failure)', async () => {
        // Mock idempotency to fail quickly
        Database.get
          .mockResolvedValueOnce({ ok: 1 }) // checkDatabase succeeds
          .mockRejectedValueOnce(new Error('Idempotency table not accessible')); // checkIdempotency fails

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Validates: Requirement 3.4 - idempotency unhealthy returns "degraded"
        expect(result.status).toBe('degraded');
        expect(result.dependencies.idempotency.status).toBe('unhealthy');
        expect(result.dependencies.idempotency.error).toContain('Idempotency table not accessible');
      });

      it('should return status "unhealthy" when both database and Stellar are unhealthy', async () => {
        // Mock both database and Stellar to fail quickly
        Database.get.mockRejectedValue(new Error('Database connection failed'));

        const mockStellarService = {
          server: {
            root: jest.fn().mockRejectedValue(new Error('Stellar network unreachable')),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Database failure takes precedence (critical dependency)
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.database.status).toBe('unhealthy');
        expect(result.dependencies.stellar.status).toBe('unhealthy');
      });

      it('should return status "unhealthy" when database and idempotency are unhealthy', async () => {
        // Mock database and idempotency to fail quickly
        Database.get.mockRejectedValue(new Error('Database connection failed'));

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Database failure takes precedence
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.database.status).toBe('unhealthy');
      });

      it('should return status "unhealthy" when Stellar and idempotency are unhealthy', async () => {
        // Mock Stellar and idempotency to fail quickly
        Database.get
          .mockResolvedValueOnce({ ok: 1 }) // checkDatabase succeeds
          .mockRejectedValueOnce(new Error('Idempotency table not accessible')); // checkIdempotency fails

        const mockStellarService = {
          server: {
            root: jest.fn().mockRejectedValue(new Error('Stellar network unreachable')),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Stellar failure takes precedence over idempotency (Stellar is critical)
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.stellar.status).toBe('unhealthy');
        expect(result.dependencies.idempotency.status).toBe('unhealthy');
      });

      it('should return status "unhealthy" when all dependencies are unhealthy', async () => {
        // Mock all dependencies to fail quickly
        Database.get.mockRejectedValue(new Error('Database connection failed'));

        const mockStellarService = {
          server: {
            root: jest.fn().mockRejectedValue(new Error('Stellar network unreachable')),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getFullHealth(mockStellarService);

        // Database failure takes precedence
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.database.status).toBe('unhealthy');
        expect(result.dependencies.stellar.status).toBe('unhealthy');
        expect(result.dependencies.idempotency.status).toBe('unhealthy');
      });
    });

    describe('Liveness endpoint - always returns alive', () => {
      it('should always return status "alive" regardless of dependency state', () => {
        // Validates: Requirement 3.5 - GET /health/live always returns "alive"
        const result = HealthCheckService.getLiveness();

        expect(result.status).toBe('alive');
        expect(result.timestamp).toBeDefined();
        expect(typeof result.timestamp).toBe('string');
      });

      it('should return alive without checking any dependencies', () => {
        // getLiveness should not call any dependency checks
        const result = HealthCheckService.getLiveness();

        expect(result.status).toBe('alive');
        // Verify no database calls were made
        expect(Database.get).not.toHaveBeenCalled();
      });
    });

    describe('Readiness endpoint - returns correct ready boolean', () => {
      it('should return ready: true when all dependencies are healthy', async () => {
        // Mock all dependencies to respond quickly and successfully
        Database.get.mockResolvedValue({ ok: 1 });

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getReadiness(mockStellarService);

        // Validates: Requirement 3.6 - all dependencies healthy returns ready: true
        expect(result.ready).toBe(true);
        expect(result.status).toBe('healthy');
        expect(result.dependencies.database.status).toBe('healthy');
        expect(result.dependencies.stellar.status).toBe('healthy');
        expect(result.dependencies.idempotency.status).toBe('healthy');
      });

      it('should return ready: false when database is unhealthy', async () => {
        // Mock database to fail quickly
        Database.get.mockRejectedValueOnce(new Error('Database connection failed'));
        Database.get.mockResolvedValue({ count: 0 }); // idempotency check succeeds

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getReadiness(mockStellarService);

        // Validates: Requirement 3.7 - unhealthy dependencies return ready: false
        expect(result.ready).toBe(false);
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.database.status).toBe('unhealthy');
      });

      it('should return ready: false when Stellar is unhealthy', async () => {
        // Mock Stellar to fail quickly
        Database.get.mockResolvedValue({ ok: 1 });

        const mockStellarService = {
          server: {
            root: jest.fn().mockRejectedValue(new Error('Stellar network unreachable')),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getReadiness(mockStellarService);

        // Validates: Requirement 3.7 - unhealthy dependencies return ready: false
        expect(result.ready).toBe(false);
        expect(result.status).toBe('unhealthy');
        expect(result.dependencies.stellar.status).toBe('unhealthy');
      });

      it('should return ready: false when idempotency is unhealthy (degraded)', async () => {
        // Mock idempotency to fail quickly
        Database.get
          .mockResolvedValueOnce({ ok: 1 }) // checkDatabase succeeds
          .mockRejectedValueOnce(new Error('Idempotency table not accessible')); // checkIdempotency fails

        const mockStellarService = {
          server: {
            root: jest.fn().mockResolvedValue({}),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const result = await HealthCheckService.getReadiness(mockStellarService);

        // Validates: Requirement 3.7 - unhealthy dependencies return ready: false
        // Even degraded status means not ready
        expect(result.ready).toBe(false);
        expect(result.status).toBe('degraded');
        expect(result.dependencies.idempotency.status).toBe('unhealthy');
      });
    });

    describe('Response time verification - fast dependencies', () => {
      it('should complete within reasonable time when all dependencies respond in <100ms', async () => {
        // Mock all dependencies to respond very quickly
        Database.get.mockImplementation(() => Promise.resolve({ ok: 1 }));

        const mockStellarService = {
          server: {
            root: jest.fn().mockImplementation(() => Promise.resolve({})),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const start = Date.now();
        const result = await HealthCheckService.getFullHealth(mockStellarService);
        const elapsed = Date.now() - start;

        // Fast dependencies should complete well under 500ms (typically <50ms)
        expect(elapsed).toBeLessThan(200);
        expect(result.status).toBe('healthy');
      });

      it('should complete successfully when dependencies respond in 100-400ms range', async () => {
        // Mock dependencies to respond within acceptable range but not instant
        Database.get.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ ok: 1 }), 100);
            })
        );

        const mockStellarService = {
          server: {
            root: jest.fn().mockImplementation(
              () =>
                new Promise((resolve) => {
                  setTimeout(() => resolve({}), 150);
                })
            ),
          },
          getNetwork: () => 'testnet',
          getEnvironment: () => ({ name: 'testnet' }),
          getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        };

        const start = Date.now();
        const result = await HealthCheckService.getFullHealth(mockStellarService);
        const elapsed = Date.now() - start;

        // Should complete successfully within reasonable time
        expect(elapsed).toBeLessThan(500);
        expect(result.status).toBe('healthy');
        expect(result.dependencies.database.status).toBe('healthy');
        expect(result.dependencies.stellar.status).toBe('healthy');
        expect(result.dependencies.idempotency.status).toBe('healthy');
      });
    });
  });
});
