/**
 * API Gateway Integration Support Tests
 * Tests proxy trust configuration, request correlation, and security headers
 */

const request = require('supertest');
const express = require('express');
const MockStellarService = require('../src/services/MockStellarService');
const HealthCheckService = require('../src/services/HealthCheckService');

// Mock the service container to use MockStellarService
jest.mock('../src/config/serviceContainer', () => ({
  getStellarService: () => new MockStellarService(),
  getTransactionReconciliationService: () => ({}),
  getRecurringDonationScheduler: () => ({}),
  getNetworkStatusService: () => ({}),
  getFeeBumpService: () => ({})
}));

// Mock HealthCheckService to avoid real checks
jest.mock('../src/services/HealthCheckService', () => ({
  getFullHealth: jest.fn().mockResolvedValue({
    status: 'healthy',
    dependencies: {
      database: { status: 'healthy' },
      stellar: { status: 'healthy' },
      idempotency: { status: 'healthy' }
    },
    timestamp: new Date().toISOString()
  })
}));

const app = require('../src/routes/app');

describe('API Gateway Integration Support', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('Proxy Trust Configuration', () => {
    test('should correctly identify client IP from X-Forwarded-For when trust proxy is configured', async () => {
      const clientIP = '192.168.1.100';
      const proxyIP = '10.0.0.1';

      const res = await request(app)
        .get('/health')
        .set('X-Forwarded-For', `${clientIP}, ${proxyIP}`)
        .set('X-Forwarded-Proto', 'https')
        .expect(200);

      expect(res.body.clientIp).toBe(clientIP);
      expect(res.body.protocol).toBe('https');
    });

    test('should handle multiple proxies in X-Forwarded-For chain', async () => {
      const clientIP = '203.0.113.1';
      const proxy1 = '198.51.100.1';
      const proxy2 = '192.0.2.1';

      const res = await request(app)
        .get('/health')
        .set('X-Forwarded-For', `${clientIP}, ${proxy1}, ${proxy2}`)
        .set('X-Forwarded-Proto', 'http')
        .expect(200);

      expect(res.body.clientIp).toBe(clientIP);
      expect(res.body.protocol).toBe('http');
    });

    test('should default to loopback when TRUSTED_PROXIES not set', async () => {
      // Since TRUSTED_PROXIES is not set in test env, it should use 'loopback'
      const res = await request(app)
        .get('/health')
        .set('X-Forwarded-For', '192.168.1.100')
        .expect(200);

      // With loopback trust, it should trust local proxies
      expect(res.body).toHaveProperty('clientIp');
      expect(res.body).toHaveProperty('protocol');
    });
  });

  describe('Request Correlation', () => {
    test('should generate UUID when X-Request-ID header is not provided', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 format
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });

    test('should use existing X-Request-ID header when provided', async () => {
      const customRequestId = 'custom-request-id-12345';

      const res = await request(app)
        .get('/health')
        .set('X-Request-ID', customRequestId)
        .expect(200);

      expect(res.body.requestId).toBe(customRequestId);
      expect(res.headers['x-request-id']).toBe(customRequestId);
    });

    test('should propagate request ID through the response headers', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });
  });

  describe('Security and Protocol Detection', () => {
    test('should detect HTTPS protocol from X-Forwarded-Proto header', async () => {
      const res = await request(app)
        .get('/health')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);

      expect(res.body.protocol).toBe('https');
    });

    test('should detect HTTP protocol from X-Forwarded-Proto header', async () => {
      const res = await request(app)
        .get('/health')
        .set('X-Forwarded-Proto', 'http')
        .expect(200);

      expect(res.body.protocol).toBe('http');
    });

    test('should handle protocol detection with proxy chain', async () => {
      const res = await request(app)
        .get('/health')
        .set('X-Forwarded-For', '192.168.1.100, 10.0.0.1')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);

      expect(res.body.clientIp).toBe('192.168.1.100');
      expect(res.body.protocol).toBe('https');
    });
  });

  describe('Integration with Mock Services', () => {
    test('should use MockStellarService and avoid real network calls', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      // Verify that mocked health check was called
      expect(HealthCheckService.getFullHealth).toHaveBeenCalled();

      // Verify response structure includes required fields
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('clientIp');
      expect(res.body).toHaveProperty('protocol');
      expect(res.body).toHaveProperty('requestId');
      expect(res.body).toHaveProperty('dependencies');
    });
  });
});