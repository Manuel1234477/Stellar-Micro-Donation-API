/**
 * Critical Path Tests: HealthCheckService
 * Issue #708 — raise coverage thresholds to 60%+
 */

const HealthCheckService = require('../../src/services/HealthCheckService');

jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  getPoolMetrics: jest.fn().mockReturnValue({ active: 0, idle: 1 }),
  getPerformanceMetrics: jest.fn().mockReturnValue({ avgQueryTime: 1 }),
}));

const Database = require('../../src/utils/database');

describe('HealthCheckService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── checkDatabase ──────────────────────────────────────────────────────────

  describe('checkDatabase', () => {
    it('returns healthy when DB query succeeds', async () => {
      Database.get.mockResolvedValue({ ok: 1 });
      const result = await HealthCheckService.checkDatabase();
      expect(result.status).toBe('healthy');
      expect(result).toHaveProperty('pool');
      expect(result).toHaveProperty('performance');
    });

    it('returns unhealthy when DB query throws', async () => {
      Database.get.mockRejectedValue(new Error('DB down'));
      const result = await HealthCheckService.checkDatabase();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toMatch('DB down');
    });
  });

  // ── checkStellar ───────────────────────────────────────────────────────────

  describe('checkStellar', () => {
    it('returns healthy for mock service (no server.root)', async () => {
      const mockService = {
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };
      const result = await HealthCheckService.checkStellar(mockService);
      expect(result.status).toBe('healthy');
      expect(result.network).toBe('testnet');
    });

    it('returns healthy when server.root() resolves', async () => {
      const mockService = {
        server: { root: jest.fn().mockResolvedValue({}) },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };
      const result = await HealthCheckService.checkStellar(mockService);
      expect(result.status).toBe('healthy');
    });

    it('returns unhealthy when server.root() rejects', async () => {
      const mockService = {
        server: { root: jest.fn().mockRejectedValue(new Error('Horizon unreachable')) },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };
      const result = await HealthCheckService.checkStellar(mockService);
      expect(result.status).toBe('unhealthy');
      expect(result.error).toMatch('Horizon unreachable');
    });

    it('includes circuitBreaker status when present', async () => {
      const mockService = {
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        circuitBreaker: { getStatus: () => ({ state: 'closed' }) },
      };
      const result = await HealthCheckService.checkStellar(mockService);
      expect(result.circuitBreaker).toEqual({ state: 'closed' });
    });
  });

  // ── checkIdempotency ───────────────────────────────────────────────────────

  describe('checkIdempotency', () => {
    it('returns healthy when idempotency_keys table is accessible', async () => {
      Database.get.mockResolvedValue({ count: 0 });
      const result = await HealthCheckService.checkIdempotency();
      expect(result.status).toBe('healthy');
    });

    it('returns unhealthy when idempotency_keys table query fails', async () => {
      Database.get.mockRejectedValue(new Error('no such table'));
      const result = await HealthCheckService.checkIdempotency();
      expect(result.status).toBe('unhealthy');
    });
  });

  // ── checkNetworkStatus ─────────────────────────────────────────────────────

  describe('checkNetworkStatus', () => {
    it('returns healthy when networkStatusService.getStatus() resolves', async () => {
      const svc = { getStatus: jest.fn().mockReturnValue({ status: 'ok' }) };
      const result = await HealthCheckService.checkNetworkStatus(svc);
      expect(result.status).toBe('healthy');
    });

    it('returns healthy when no networkStatusService provided', async () => {
      const result = await HealthCheckService.checkNetworkStatus(null);
      expect(result.status).toBe('healthy');
    });
  });

  // ── getLiveness ────────────────────────────────────────────────────────────

  describe('getLiveness', () => {
    it('always returns alive', () => {
      const result = HealthCheckService.getLiveness();
      expect(result.status).toBe('alive');
      expect(result).toHaveProperty('timestamp');
    });
  });

  // ── getFullHealth ──────────────────────────────────────────────────────────

  describe('getFullHealth', () => {
    const healthyMockService = {
      getNetwork: () => 'testnet',
      getEnvironment: () => ({ name: 'testnet' }),
      getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
    };

    beforeEach(() => {
      Database.get.mockResolvedValue({ ok: 1, count: 0 });
    });

    it('returns healthy when all checks pass', async () => {
      const result = await HealthCheckService.getFullHealth(healthyMockService);
      expect(result.status).toBe('healthy');
      expect(result.dependencies).toHaveProperty('database');
      expect(result.dependencies).toHaveProperty('stellar');
      expect(result.dependencies).toHaveProperty('idempotency');
    });

    it('returns unhealthy when database is down', async () => {
      jest.spyOn(HealthCheckService, 'checkDatabase').mockResolvedValueOnce({ status: 'unhealthy', error: 'DB down' });
      jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValueOnce({ status: 'healthy' });
      jest.spyOn(HealthCheckService, 'checkIdempotency').mockResolvedValueOnce({ status: 'healthy' });

      const result = await HealthCheckService.getFullHealth(healthyMockService);
      expect(result.status).toBe('unhealthy');
    });

    it('returns unhealthy when stellar is down', async () => {
      jest.spyOn(HealthCheckService, 'checkDatabase').mockResolvedValueOnce({ status: 'healthy' });
      jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValueOnce({ status: 'unhealthy', error: 'Horizon down' });
      jest.spyOn(HealthCheckService, 'checkIdempotency').mockResolvedValueOnce({ status: 'healthy' });

      const result = await HealthCheckService.getFullHealth(healthyMockService);
      expect(result.status).toBe('unhealthy');
    });

    it('returns degraded when only idempotency is down', async () => {
      jest.spyOn(HealthCheckService, 'checkDatabase').mockResolvedValueOnce({ status: 'healthy' });
      jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValueOnce({ status: 'healthy' });
      jest.spyOn(HealthCheckService, 'checkIdempotency').mockResolvedValueOnce({ status: 'unhealthy', error: 'table missing' });

      const result = await HealthCheckService.getFullHealth(healthyMockService);
      expect(result.status).toBe('degraded');
    });

    it('includes network dependency when networkStatusService provided', async () => {
      const networkSvc = { getStatus: jest.fn().mockReturnValue({ status: 'ok' }) };
      const result = await HealthCheckService.getFullHealth(healthyMockService, networkSvc);
      expect(result.dependencies).toHaveProperty('network');
    });
  });

  // ── getReadiness ───────────────────────────────────────────────────────────

  describe('getReadiness', () => {
    it('returns ready=true when healthy', async () => {
      jest.spyOn(HealthCheckService, 'getFullHealth').mockResolvedValueOnce({
        status: 'healthy',
        dependencies: {},
        timestamp: new Date().toISOString(),
      });
      const result = await HealthCheckService.getReadiness({});
      expect(result.ready).toBe(true);
    });

    it('returns ready=false when unhealthy', async () => {
      // getReadiness calls getFullHealth directly (not via module.exports),
      // so we mock the individual checks to produce an unhealthy result.
      Database.get.mockRejectedValue(new Error('DB down'));
      const brokenService = {
        server: { root: jest.fn().mockRejectedValue(new Error('Horizon down')) },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      };
      const result = await HealthCheckService.getReadiness(brokenService);
      expect(result.ready).toBe(false);
    });
  });

  // ── DEPENDENCY_TIMEOUT_MS constant ────────────────────────────────────────

  it('exports DEPENDENCY_TIMEOUT_MS as 2000', () => {
    expect(HealthCheckService.DEPENDENCY_TIMEOUT_MS).toBe(2000);
  });
});
