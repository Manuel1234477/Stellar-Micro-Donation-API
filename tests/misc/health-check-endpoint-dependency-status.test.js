/**
 * Tests: Enhanced Health Check Endpoints
 *
 * Covers GET /health, GET /health/live, GET /health/ready
 * Uses MockStellarService — no live Stellar network required.
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const HealthCheckService = require('../../src/services/HealthCheckService');
const Database = require('../../src/utils/database');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Make Database.get reject to simulate a DB outage */
function breakDatabase() {
  jest.spyOn(Database, 'get').mockRejectedValue(new Error('SQLITE_CANTOPEN: unable to open database file'));
}

/** Restore all mocks */
function restoreAll() {
  jest.restoreAllMocks();
}

// ─── GET /health ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  afterEach(restoreAll);

  it('returns 200 with status "healthy" when all dependencies are up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('dependencies');
  });

  it('includes database, stellar, and idempotency in dependencies', async () => {
    const res = await request(app).get('/health');

    const { dependencies } = res.body;
    expect(dependencies).toHaveProperty('database');
    expect(dependencies).toHaveProperty('stellar');
    expect(dependencies).toHaveProperty('idempotency');
  });

  it('each dependency entry has status and responseTime', async () => {
    const res = await request(app).get('/health');

    for (const dep of Object.values(res.body.dependencies)) {
      expect(dep).toHaveProperty('status');
      expect(dep).toHaveProperty('responseTime');
      expect(typeof dep.responseTime).toBe('number');
    }
  });

  it('returns 503 with status "unhealthy" when database is down', async () => {
    breakDatabase();

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.dependencies.database.status).toBe('unhealthy');
    expect(res.body.dependencies.database).toHaveProperty('error');
  });

  it('returns 200 with status "degraded" when only stellar is unhealthy', async () => {
    // Spy on checkStellar to simulate Horizon being unreachable
    jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValue({
      status: 'unhealthy',
      responseTime: 2001,
      error: 'stellar check timed out after 2000ms',
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.stellar.status).toBe('unhealthy');
  });

  it('returns 200 with status "degraded" when only idempotency is unhealthy', async () => {
    jest.spyOn(HealthCheckService, 'checkIdempotency').mockResolvedValue({
      status: 'unhealthy',
      responseTime: 50,
      error: 'idempotency table missing',
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.idempotency.status).toBe('unhealthy');
  });

  it('stellar dependency includes network and horizonUrl fields', async () => {
    const res = await request(app).get('/health');

    const { stellar } = res.body.dependencies;
    expect(stellar).toHaveProperty('network');
    expect(stellar).toHaveProperty('horizonUrl');
  });
});

// ─── GET /health/live ────────────────────────────────────────────────────────

describe('GET /health/live', () => {
  it('returns 200 with status "alive"', async () => {
    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('returns 200 even when database is down', async () => {
    breakDatabase();

    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');

    restoreAll();
  });
});

// ─── GET /health/ready ───────────────────────────────────────────────────────

describe('GET /health/ready', () => {
  afterEach(restoreAll);

  it('returns 200 with ready:true when all dependencies are healthy', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.status).toBe('healthy');
  });

  it('returns 503 with ready:false when database is down', async () => {
    breakDatabase();

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
  });

  it('returns 503 with ready:false when status is degraded', async () => {
    jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValue({
      status: 'unhealthy',
      responseTime: 2001,
      error: 'timed out',
    });

    const res = await request(app).get('/health/ready');

    // degraded means not ready
    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
  });

  it('includes dependencies in readiness response', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.body).toHaveProperty('dependencies');
    expect(res.body.dependencies).toHaveProperty('database');
    expect(res.body.dependencies).toHaveProperty('stellar');
    expect(res.body.dependencies).toHaveProperty('idempotency');
  });
});

// ─── HealthCheckService unit tests ───────────────────────────────────────────

describe('HealthCheckService unit tests', () => {
  afterEach(restoreAll);

  describe('checkDatabase', () => {
    it('returns healthy when DB responds', async () => {
      const result = await HealthCheckService.checkDatabase();
      expect(result.status).toBe('healthy');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy when DB throws', async () => {
      jest.spyOn(Database, 'get').mockRejectedValue(new Error('DB down'));
      const result = await HealthCheckService.checkDatabase();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('DB down');
    });
  });

  describe('checkStellar', () => {
    it('returns healthy for MockStellarService', async () => {
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.checkStellar(mock);
      expect(result.status).toBe('healthy');
      expect(result.network).toBe('testnet');
      expect(result.horizonUrl).toBeDefined();
    });

    it('returns unhealthy when stellar check times out', async () => {
      const slowService = {
        getNetwork: () => 'testnet',
        getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
        server: {
          root: () => new Promise(resolve => setTimeout(resolve, 5000)), // 5s > 2s limit
        },
      };
      const result = await HealthCheckService.checkStellar(slowService);
      expect(result.status).toBe('unhealthy');
      expect(result.error).toMatch(/timed out/i);
    }, 10000);
  });

  describe('checkIdempotency', () => {
    it('returns healthy when idempotency table is accessible', async () => {
      const result = await HealthCheckService.checkIdempotency();
      expect(result.status).toBe('healthy');
    });

    it('returns unhealthy when idempotency table query fails', async () => {
      jest.spyOn(Database, 'get').mockRejectedValue(new Error('table missing'));
      const result = await HealthCheckService.checkIdempotency();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('table missing');
    });
  });

  describe('getLiveness', () => {
    it('always returns alive with a timestamp', () => {
      const result = HealthCheckService.getLiveness();
      expect(result.status).toBe('alive');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getFullHealth', () => {
    it('returns healthy when all checks pass', async () => {
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.getFullHealth(mock);
      expect(result.status).toBe('healthy');
    });

    it('returns unhealthy when database is down', async () => {
      jest.spyOn(Database, 'get').mockRejectedValue(new Error('DB down'));
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.getFullHealth(mock);
      expect(result.status).toBe('unhealthy');
    });

    it('returns degraded when stellar is down but DB is up', async () => {
      jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValue({
        status: 'unhealthy', responseTime: 2001, error: 'timed out',
      });
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.getFullHealth(mock);
      expect(result.status).toBe('degraded');
    });
  });

  describe('getReadiness', () => {
    it('returns ready:true when healthy', async () => {
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.getReadiness(mock);
      expect(result.ready).toBe(true);
    });

    it('returns ready:false when unhealthy', async () => {
      jest.spyOn(Database, 'get').mockRejectedValue(new Error('DB down'));
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.getReadiness(mock);
      expect(result.ready).toBe(false);
    });

    it('returns ready:false when degraded', async () => {
      jest.spyOn(HealthCheckService, 'checkStellar').mockResolvedValue({
        status: 'unhealthy', responseTime: 50, error: 'timed out',
      });
      const MockStellarService = require('../../src/services/MockStellarService');
      const mock = new MockStellarService();
      const result = await HealthCheckService.getReadiness(mock);
      expect(result.ready).toBe(false);
    });
  });

  describe('DEPENDENCY_TIMEOUT_MS', () => {
    it('is set to 2000ms', () => {
      expect(HealthCheckService.DEPENDENCY_TIMEOUT_MS).toBe(2000);
    });
  });
});
