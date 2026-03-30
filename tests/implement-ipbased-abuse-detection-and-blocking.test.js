/**
 * Tests for IP-based Abuse Detection and Auto-Blocking
 * 
 * Covers service logic, middleware integration, admin endpoints
 * Uses no live Stellar network (service only)
 */

const AbuseDetectionService = require('../src/services/AbuseDetectionService');
const blockCheck = require('../src/middleware/blockCheck');
const request = require('supertest');
const express = require('express');
const app = express();

describe('AbuseDetectionService', () => {
  let service;

  beforeEach(() => {
    service = new AbuseDetectionService();
    // Clear state
    service.suspiciousCounts.clear();
    service.blockedIps = [];
    service.saveBlocked = jest.fn();
    service.loadBlocked = jest.fn(() => []);
  });

  test('should track suspicious events and count within window', () => {
    const ip = '192.168.1.100';
    
    expect(service.trackSuspicious(ip)).toBe(false);
    expect(service.suspiciousCounts.get(ip).count).toBe(1);

    // Multiple tracks
    service.trackSuspicious(ip);
    expect(service.suspiciousCounts.get(ip).count).toBe(2);
  });

  test('should reset window when expired', () => {
    const ip = '192.168.1.101';
    service.config.windowMs = 100; // Short window for test

    service.trackSuspicious(ip);
    expect(service.suspiciousCounts.get(ip).count).toBe(1);

    // Fast forward past window
    service.suspiciousCounts.get(ip).windowStart -= service.config.windowMs + 1;
    service.trackSuspicious(ip);
    expect(service.suspiciousCounts.get(ip).count).toBe(1); // Reset
  });

  test('should auto-block on threshold exceed', () => {
    const ip = '192.168.1.102';
    service.config.suspiciousThreshold = 2;

    service.trackSuspicious(ip);
    expect(service.isBlocked(ip)).toBe(false);

    service.trackSuspicious(ip);
    expect(service.isBlocked(ip)).toBe(true);
    expect(service.blockedIps.some(b => b.ip === ip)).toBe(true);
  });

  test('should not re-block existing block', () => {
    const ip = '192.168.1.103';
    service.blockedIps = [{ ip, blockedAt: Date.now(), expiresAt: Date.now() + 1000000 }];
    
    const blocked = service.autoBlock(ip, 'test');
    expect(blocked).toBe(true); // Already blocked
    expect(service.blockedIps.length).toBe(1);
  });

  test('should check block expiry', () => {
    const ip = '192.168.1.104';
    const expiredBlock = {
      ip,
      blockedAt: Date.now() - 2 * 24 * 3600000,
      expiresAt: Date.now() - 3600000 // Expired
    };
    service.blockedIps = [expiredBlock];

    expect(service.isBlocked(ip)).toBe(false); // Expired
  });

  test('getBlocked returns only active', () => {
    const active = { ip: '1.1.1.1', expiresAt: Date.now() + 10000 };
    const expired = { ip: '2.2.2.2', expiresAt: Date.now() - 10000 };
    service.blockedIps = [active, expired];

    const activeList = service.getBlocked();
    expect(activeList.length).toBe(1);
    expect(activeList[0].ip).toBe('1.1.1.1');
  });

  test('unblock removes block', () => {
    const ip = '192.168.1.105';
    service.blockedIps = [{ ip, expiresAt: Date.now() + 10000 }];
    
    const unblocked = service.unblock(ip);
    expect(unblocked).toBe(true);
    expect(service.blockedIps.length).toBe(0);
  });

  test('unblock non-blocked returns false', () => {
    const unblocked = service.unblock('nonexistent');
    expect(unblocked).toBe(false);
  });
});

describe('BlockCheck Middleware', () => {
  test('should block blocked IP with 403', (done) => {
    const service = new AbuseDetectionService();
    service.blockedIps = [{
      ip: 'blocked.ip.test',
      blockedAt: Date.now(),
      expiresAt: Date.now() + 3600000
    }];

    const testApp = express();
    testApp.use((req, res, next) => {
      req.ip = req.headers['x-forwarded-for'] || 'blocked.ip.test';
      next();
    });
    testApp.use(blockCheck);
    testApp.get('/test', (req, res) => res.json({ ok: true }));

    request(testApp)
      .get('/test')
      .set('X-Forwarded-For', 'blocked.ip.test')
      .expect(403)
      .end((err, res) => {
        expect(res.body.error.code).toBe('BLOCKED_IP');
        done(err);
      });
  });

  test('should allow non-blocked IP', (done) => {
    const testApp = express();
    testApp.use(blockCheck);
    testApp.get('/test', (req, res) => res.json({ ok: true }));

    request(testApp)
      .get('/test')
      .expect(200)
      .end((err) => done(err));
  });
});

describe('Integration - Service + Middleware + Endpoints', () => {
  let testApp;

  beforeEach(() => {
    const express = require('express');
    testApp = express();

    // Mock rbac
    testApp.use((req, res, next) => {
      req.user = { role: 'admin' };
      next();
    });

    testApp.use('/admin', (req, res, next) => next()); // Skip rbac for test

    // Add full app routes for test
    const appRoutes = require('../src/routes/app');
    testApp.use('/admin/blocked-ips', appRoutes._router || appRoutes); // Mock
  });

  test('admin endpoints work', async () => {
    const service = require('../src/services/AbuseDetectionService');
    
    // Block an IP
    service.autoBlock('test.blocked.ip', 'test');

    // GET list
    const getRes = await request(testApp)
      .get('/admin/blocked-ips')
      .expect(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data.length).toBeGreaterThan(0);

    // DELETE unblock
    await request(testApp)
      .delete('/admin/blocked-ips/test.blocked.ip')
      .expect(200);

    // Verify unblocked
    const finalList = await request(testApp)
      .get('/admin/blocked-ips')
      .expect(200);
    expect(finalList.body.data.length).toBe(0);
  });
});

afterAll(() => {
  const service = require('../src/services/AbuseDetectionService');
  service.stop();
});

