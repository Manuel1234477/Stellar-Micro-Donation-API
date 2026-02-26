/**
 * Suspicious Pattern Middleware Integration Tests
 * 
 * Tests middleware integration without blocking legitimate requests
 */

const express = require('express');
const request = require('supertest');
const suspiciousPatternMiddleware = require('../src/middleware/suspiciousPatternDetection');
const suspiciousPatternDetector = require('../src/utils/suspiciousPatternDetector');
const log = require('../src/utils/log');

jest.mock('../src/utils/log');

describe('Suspicious Pattern Middleware Integration', () => {
  let app;

  beforeEach(() => {
    // Clear state
    suspiciousPatternDetector.velocityTracking.clear();
    suspiciousPatternDetector.amountPatterns.clear();
    suspiciousPatternDetector.recipientPatterns.clear();
    suspiciousPatternDetector.sequentialFailures.clear();
    suspiciousPatternDetector.timePatterns.clear();
    
    jest.clearAllMocks();

    // Create test app
    app = express();
    app.use(express.json());
    app.use(suspiciousPatternMiddleware);

    // Mock donation endpoint
    app.post('/donations/send', (req, res) => {
      res.json({ success: true, data: { id: 1 } });
    });

    // Mock error endpoint
    app.post('/donations/fail', (req, res) => {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR' } });
    });
  });

  afterAll(() => {
    suspiciousPatternDetector.stop();
  });

  describe('Request Processing', () => {
    it('should not block successful requests', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({ amount: 10, senderId: 'SENDER', receiverId: 'RECEIVER' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should not block failed requests', async () => {
      const response = await request(app)
        .post('/donations/fail')
        .send({ amount: 10 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should track donation patterns on success', async () => {
      await request(app)
        .post('/donations/send')
        .send({ amount: 10, senderId: 'SENDER', receiverId: 'RECEIVER' });

      const metrics = suspiciousPatternDetector.getMetrics();
      expect(metrics.velocityTracking).toBeGreaterThan(0);
    });

    it('should track failures', async () => {
      await request(app)
        .post('/donations/fail')
        .send({ amount: 10 });

      const metrics = suspiciousPatternDetector.getMetrics();
      expect(metrics.sequentialFailures).toBeGreaterThan(0);
    });
  });

  describe('Pattern Detection Integration', () => {
    it('should detect high velocity through middleware', async () => {
      // Simulate rapid requests
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/donations/send')
          .send({ amount: 10, senderId: 'SENDER', receiverId: 'RECEIVER' });
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('high_velocity_donations'),
        expect.any(Object)
      );
    });

    it('should detect identical amounts through middleware', async () => {
      // Same amount multiple times
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/donations/send')
          .send({ amount: 5.5, senderId: 'SENDER', receiverId: 'RECEIVER' });
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('identical_amount_pattern'),
        expect.any(Object)
      );
    });

    it('should detect recipient diversity through middleware', async () => {
      // Many different recipients
      for (let i = 0; i < 11; i++) {
        await request(app)
          .post('/donations/send')
          .send({ amount: 10, senderId: 'DONOR1', receiverId: `RECIPIENT_${i}` });
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('high_recipient_diversity'),
        expect.any(Object)
      );
    });

    it('should detect sequential failures through middleware', async () => {
      // Multiple failures
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/donations/fail')
          .send({ amount: 10 });
      }

      expect(log.warn).toHaveBeenCalledWith(
        'SUSPICIOUS_PATTERN',
        expect.stringContaining('sequential_failures'),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should not crash on malformed request body', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({ invalid: 'data' });

      expect(response.status).toBe(200);
    });

    it('should handle missing request body', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send();

      expect(response.status).toBe(200);
    });

    it('should handle missing IP address', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({ amount: 10 });

      expect(response.status).toBe(200);
    });
  });

  describe('Non-Blocking Guarantee', () => {
    it('should never block requests even with detection errors', async () => {
      // Force an error in pattern detection by corrupting state
      suspiciousPatternDetector.velocityTracking.set('test', null);

      const response = await request(app)
        .post('/donations/send')
        .send({ amount: 10, senderId: 'SENDER', receiverId: 'RECEIVER' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should process requests even with extreme patterns', async () => {
      // Extreme velocity
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .post('/donations/send')
            .send({ amount: 10, senderId: 'SENDER', receiverId: 'RECEIVER' })
        );
      }

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('Success Resets Failure Counter', () => {
    it('should reset failure counter after successful request', async () => {
      // Failures
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/donations/fail')
          .send({ amount: 10 });
      }

      expect(suspiciousPatternDetector.sequentialFailures.size).toBeGreaterThan(0);

      // Success
      await request(app)
        .post('/donations/send')
        .send({ amount: 10, senderId: 'SENDER', receiverId: 'RECEIVER' });

      expect(suspiciousPatternDetector.sequentialFailures.size).toBe(0);
    });
  });
});
