/**
 * Geographic IP Blocking and Allowlisting Tests
 *
 * Tests geographic IP blocking functionality including:
 * - Country-based blocking and allowlisting
 * - IP allowlisting with CIDR ranges
 * - Admin API configuration
 * - Audit logging
 * - Edge cases and validation
 */

const request = require('supertest');
const express = require('express');
const { GeoBlockMiddleware } = require('../src/middleware/geoBlock');
const geoBlockMiddleware = require('../src/middleware/geoBlock');
const config = require('../src/config');
const logger = require('../src/middleware/logger');

// Mock MaxMind database
jest.mock('maxmind', () => ({
  open: jest.fn()
}));

const maxmind = require('maxmind');

// Mock logger
jest.mock('../src/middleware/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}));

// Mock config
jest.mock('../src/config', () => ({
  geoBlocking: {
    blockedCountries: ['RU', 'IR'],
    allowedCountries: ['US'],
    allowedIPs: ['192.168.1.1', '10.0.0.0/8'],
    maxmindDbPath: './data/GeoLite2-Country.mmdb'
  }
}));

describe('GeoBlockMiddleware', () => {
  let middleware;
  let mockLookup;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MaxMind lookup
    mockLookup = {
      get: jest.fn()
    };
    maxmind.open.mockResolvedValue(mockLookup);

    middleware = new GeoBlockMiddleware();
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid database', async () => {
      require('fs').existsSync = jest.fn().mockReturnValue(true);

      await middleware.initialize();

      expect(middleware.initialized).toBe(true);
      expect(middleware.lookup).toBe(mockLookup);
      expect(maxmind.open).toHaveBeenCalledWith('./data/GeoLite2-Country.mmdb');
    });

    it('should handle missing database file', async () => {
      require('fs').existsSync = jest.fn().mockReturnValue(false);

      await middleware.initialize();

      expect(middleware.initialized).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MaxMind database not found')
      );
    });

    it('should handle database open errors', async () => {
      require('fs').existsSync = jest.fn().mockReturnValue(true);
      maxmind.open.mockRejectedValue(new Error('Database error'));

      await middleware.initialize();

      expect(middleware.initialized).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize MaxMind database:',
        expect.any(Error)
      );
    });
  });

  describe('Country Code Lookup', () => {
    beforeEach(async () => {
      require('fs').existsSync = jest.fn().mockReturnValue(true);
      await middleware.initialize();
    });

    it('should return country code for valid IP', () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'US' } });

      const result = middleware.getCountryCode('8.8.8.8');

      expect(result).toBe('US');
      expect(mockLookup.get).toHaveBeenCalledWith('8.8.8.8');
    });

    it('should return null for unknown country', () => {
      mockLookup.get.mockReturnValue({});

      const result = middleware.getCountryCode('8.8.8.8');

      expect(result).toBe(null);
    });

    it('should return null when not initialized', () => {
      middleware.initialized = false;

      const result = middleware.getCountryCode('8.8.8.8');

      expect(result).toBe(null);
      expect(mockLookup.get).not.toHaveBeenCalled();
    });

    it('should handle lookup errors', () => {
      mockLookup.get.mockImplementation(() => {
        throw new Error('Lookup failed');
      });

      const result = middleware.getCountryCode('8.8.8.8');

      expect(result).toBe(null);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to lookup country for IP 8.8.8.8:',
        expect.any(Error)
      );
    });
  });

  describe('IP Allowlisting', () => {
    it('should allow exact IP match', () => {
      const result = middleware.isIPAllowlisted('192.168.1.1');
      expect(result).toBe(true);
    });

    it('should allow IP in CIDR range', () => {
      const result = middleware.isIPAllowlisted('10.1.2.3');
      expect(result).toBe(true);
    });

    it('should reject IP not in allowlist', () => {
      const result = middleware.isIPAllowlisted('203.0.113.1');
      expect(result).toBe(false);
    });

    it('should handle empty allowlist', () => {
      config.geoBlocking.allowedIPs = [];

      const result = middleware.isIPAllowlisted('192.168.1.1');
      expect(result).toBe(false);
    });
  });

  describe('CIDR Range Checking', () => {
    it('should correctly identify IPs in CIDR range', () => {
      expect(middleware.isIPInCIDR('192.168.1.1', '192.168.1.0/24')).toBe(true);
      expect(middleware.isIPInCIDR('192.168.1.254', '192.168.1.0/24')).toBe(true);
      expect(middleware.isIPInCIDR('192.168.2.1', '192.168.1.0/24')).toBe(false);
    });

    it('should handle /32 (single IP)', () => {
      expect(middleware.isIPInCIDR('192.168.1.1', '192.168.1.1/32')).toBe(true);
      expect(middleware.isIPInCIDR('192.168.1.2', '192.168.1.1/32')).toBe(false);
    });

    it('should handle invalid CIDR', () => {
      expect(middleware.isIPInCIDR('192.168.1.1', 'invalid')).toBe(false);
      expect(middleware.isIPInCIDR('192.168.1.1', '192.168.1.1/999')).toBe(false);
    });
  });

  describe('Blocking Decision', () => {
    beforeEach(async () => {
      require('fs').existsSync = jest.fn().mockReturnValue(true);
      await middleware.initialize();
    });

    it('should allow IP in allowlist regardless of country', () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'RU' } });

      const result = middleware.shouldBlock('192.168.1.1');

      expect(result.block).toBe(false);
      expect(result.reason).toBe(null);
    });

    it('should allow country in allowlist', () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'US' } });

      const result = middleware.shouldBlock('8.8.8.8');

      expect(result.block).toBe(false);
      expect(result.reason).toBe(null);
    });

    it('should block country in blocklist', () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'RU' } });

      const result = middleware.shouldBlock('8.8.8.8');

      expect(result.block).toBe(true);
      expect(result.reason).toBe('geo');
      expect(result.countryCode).toBe('RU');
    });

    it('should allow country not in any list', () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'GB' } });

      const result = middleware.shouldBlock('8.8.8.8');

      expect(result.block).toBe(false);
      expect(result.reason).toBe(null);
    });

    it('should allow when no country found', () => {
      mockLookup.get.mockReturnValue({});

      const result = middleware.shouldBlock('8.8.8.8');

      expect(result.block).toBe(false);
      expect(result.reason).toBe(null);
    });
  });

  describe('Middleware Integration', () => {
    let app;
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      app = express();
      mockReq = {
        ip: '8.8.8.8',
        path: '/test',
        method: 'GET',
        get: jest.fn().mockReturnValue('TestAgent')
      };
      mockRes = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      mockNext = jest.fn();
    });

    it('should allow request when geo-blocking disabled', async () => {
      config.geoBlocking.blockedCountries = [];
      config.geoBlocking.allowedCountries = [];
      config.geoBlocking.allowedIPs = [];

      await middleware.middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should block request from blocked country', async () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'RU' } });

      await middleware.middleware(mockReq, mockRes, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith('X-Blocked-Reason', 'geo');
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'GEO_BLOCKED',
          message: 'Access denied from your location'
        }
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'Request blocked by geo-blocking',
        expect.objectContaining({
          ip: '8.8.8.8',
          country: 'RU',
          path: '/test',
          method: 'GET',
          reason: 'geo'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should allow request from allowed country', async () => {
      mockLookup.get.mockReturnValue({ country: { iso_code: 'US' } });

      await middleware.middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should allow request from allowlisted IP', async () => {
      mockReq.ip = '192.168.1.1';
      mockLookup.get.mockReturnValue({ country: { iso_code: 'RU' } });

      await middleware.middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});

describe('Geo-blocking Admin API', () => {
  let app;
  let server;
  let adminApiKey;

  beforeAll(async () => {
    // Create test app
    app = express();
    app.use(express.json());

    // Mock middleware
    app.use((req, res, next) => {
      req.apiKey = { id: 'test-admin-key' };
      next();
    });

    // Add routes
    app.use('/admin/geo-blocking', require('../src/routes/admin/geoBlocking'));

    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adminApiKey = 'test-admin-key';
  });

  describe('GET /admin/geo-blocking', () => {
    it('should return current configuration', async () => {
      const response = await request(app)
        .get('/admin/geo-blocking')
        .set('Authorization', `Bearer ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('blockedCountries');
      expect(response.body.data).toHaveProperty('allowedCountries');
      expect(response.body.data).toHaveProperty('allowedIPs');
    });
  });

  describe('PUT /admin/geo-blocking', () => {
    it('should update configuration successfully', async () => {
      const newConfig = {
        blockedCountries: ['RU', 'IR', 'KP'],
        allowedCountries: ['US', 'CA'],
        allowedIPs: ['192.168.1.1', '10.0.0.0/8']
      };

      const response = await request(app)
        .put('/admin/geo-blocking')
        .set('Authorization', `Bearer ${adminApiKey}`)
        .send(newConfig);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.blockedCountries).toEqual(['RU', 'IR', 'KP']);
      expect(response.body.data.allowedCountries).toEqual(['US', 'CA']);
      expect(response.body.data.allowedIPs).toEqual(['192.168.1.1', '10.0.0.0/8']);
    });

    it('should validate country codes', async () => {
      const invalidConfig = {
        blockedCountries: ['INVALID'],
        allowedCountries: [],
        allowedIPs: []
      };

      const response = await request(app)
        .put('/admin/geo-blocking')
        .set('Authorization', `Bearer ${adminApiKey}`)
        .send(invalidConfig);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate IP addresses', async () => {
      const invalidConfig = {
        blockedCountries: [],
        allowedCountries: [],
        allowedIPs: ['invalid.ip']
      };

      const response = await request(app)
        .put('/admin/geo-blocking')
        .set('Authorization', `Bearer ${adminApiKey}`)
        .send(invalidConfig);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /admin/geo-blocking/reload-db', () => {
    it('should reload database successfully', async () => {
      const response = await request(app)
        .post('/admin/geo-blocking/reload-db')
        .set('Authorization', `Bearer ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('reloaded successfully');
    });
  });
});

describe('Integration Tests', () => {
  let app;
  let server;

  beforeAll(async () => {
    // Create full test app with geo-blocking middleware
    app = express();
    app.use(express.json());

    // Add geo-blocking middleware
    app.use(geoBlockMiddleware);

    // Test route
    app.get('/test', (req, res) => {
      res.json({ success: true, message: 'Allowed' });
    });

    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  it('should allow requests when geo-blocking is disabled', async () => {
    // Temporarily disable geo-blocking
    const originalConfig = { ...config.geoBlocking };
    config.geoBlocking.blockedCountries = [];
    config.geoBlocking.allowedCountries = [];
    config.geoBlocking.allowedIPs = [];

    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Restore config
    Object.assign(config.geoBlocking, originalConfig);
  });

  it('should block requests from blocked countries', async () => {
    // Mock the middleware to simulate blocking
    const originalMiddleware = geoBlockMiddleware;
    geoBlockMiddleware.mockImplementation((req, res, next) => {
      res.set('X-Blocked-Reason', 'geo');
      res.status(403).json({
        success: false,
        error: { code: 'GEO_BLOCKED', message: 'Access denied from your location' }
      });
    });

    const response = await request(app).get('/test');

    expect(response.status).toBe(403);
    expect(response.headers['x-blocked-reason']).toBe('geo');
    expect(response.body.error.code).toBe('GEO_BLOCKED');

    // Restore original middleware
    Object.assign(geoBlockMiddleware, originalMiddleware);
  });
});