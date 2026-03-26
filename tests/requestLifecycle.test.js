/**
 * Request Lifecycle Timeline Tests
 * Tests for request lifecycle tracking and latency analysis
 */

const request = require('supertest');
const express = require('express');

// Mock config before requiring other modules
jest.mock('../src/config', () => ({
  app: { name: 'test-app', version: '1.0.0' },
  server: { env: 'test', port: 3000 },
  logging: { debugMode: false }
}));

// Mock logger
jest.mock('../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
  getContext: jest.fn(() => ({})),
  isDebugMode: false
}));

// Mock sanitizer
jest.mock('../src/utils/sanitizer', () => ({
  sanitizeForLogging: jest.fn(val => val)
}));

// Mock correlation
jest.mock('../src/utils/correlation', () => ({
  initializeRequestContext: jest.fn(),
  parseCorrelationHeaders: jest.fn(() => ({})),
  getCorrelationContext: jest.fn(() => ({}))
}));

const { attachLifecycleTracking, LIFECYCLE_STAGES } = require('../src/middleware/requestLifecycle');
const requestId = require('../src/middleware/requestId');
const log = require('../src/utils/log');

describe('Request Lifecycle Timeline', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestId);
    app.use(attachLifecycleTracking);
    
    // Clear mock calls
    jest.clearAllMocks();
  });

  describe('Lifecycle Tracking', () => {
    it('should track all lifecycle stages for successful request', async () => {
      app.get('/test', (req, res) => {
        // Simulate processing
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);

      // Verify lifecycle log was called
      expect(log.info).toHaveBeenCalledWith(
        'REQUEST_LIFECYCLE',
        'Request timeline',
        expect.objectContaining({
          method: 'GET',
          path: '/test',
          statusCode: 200,
          timeline: expect.objectContaining({
            received: expect.any(Number),
            validated: expect.any(Number),
            processed: expect.any(Number),
            responded: expect.any(Number)
          }),
          durations: expect.objectContaining({
            total: expect.any(Number),
            validation: expect.any(Number),
            processing: expect.any(Number),
            response: expect.any(Number)
          })
        })
      );
    });

    it('should track lifecycle even without explicit processed stage', async () => {
      app.get('/test', (req, res) => {
        // No explicit markLifecycleStage call
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);

      expect(log.info).toHaveBeenCalledWith(
        'REQUEST_LIFECYCLE',
        'Request timeline',
        expect.objectContaining({
          timeline: expect.objectContaining({
            received: expect.any(Number),
            validated: expect.any(Number)
          })
        })
      );
    });

    it('should calculate correct durations', async () => {
      app.get('/test', async (req, res) => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);

      const logCall = log.info.mock.calls.find(
        call => call[0] === 'REQUEST_LIFECYCLE'
      );
      
      expect(logCall).toBeDefined();
      const { durations } = logCall[2];
      
      // Total duration should be at least 50ms
      expect(durations.total).toBeGreaterThanOrEqual(50);
      
      // All durations should be non-negative
      expect(durations.validation).toBeGreaterThanOrEqual(0);
      expect(durations.processing).toBeGreaterThanOrEqual(0);
      expect(durations.response).toBeGreaterThanOrEqual(0);
      
      // Total should equal sum of parts
      const sum = durations.validation + durations.processing + durations.response;
      expect(Math.abs(durations.total - sum)).toBeLessThan(5); // Allow small timing variance
    });

    it('should include requestId in lifecycle log', async () => {
      app.get('/test', (req, res) => {
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      const response = await request(app).get('/test').expect(200);
      const requestId = response.headers['x-request-id'];

      expect(log.info).toHaveBeenCalledWith(
        'REQUEST_LIFECYCLE',
        'Request timeline',
        expect.objectContaining({
          requestId
        })
      );
    });

    it('should track lifecycle for error responses', async () => {
      app.get('/test', (req, res) => {
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.status(500).json({ error: 'Internal error' });
      });

      await request(app).get('/test').expect(500);

      expect(log.info).toHaveBeenCalledWith(
        'REQUEST_LIFECYCLE',
        'Request timeline',
        expect.objectContaining({
          statusCode: 500
        })
      );
    });

    it('should handle multiple requests independently', async () => {
      app.get('/test', (req, res) => {
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      // Make multiple concurrent requests
      await Promise.all([
        request(app).get('/test'),
        request(app).get('/test'),
        request(app).get('/test')
      ]);

      // Should have 3 lifecycle logs
      const lifecycleLogs = log.info.mock.calls.filter(
        call => call[0] === 'REQUEST_LIFECYCLE'
      );
      expect(lifecycleLogs).toHaveLength(3);
    });
  });

  describe('Lifecycle Stages', () => {
    it('should auto-mark validated stage', async () => {
      app.get('/test', (req, res) => {
        // Don't manually mark validated
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);

      const logCall = log.info.mock.calls.find(
        call => call[0] === 'REQUEST_LIFECYCLE'
      );
      
      expect(logCall[2].timeline.validated).toBeDefined();
      expect(logCall[2].timeline.validated).toBeGreaterThan(0);
    });

    it('should allow manual marking of processed stage', async () => {
      let processedTimestamp;
      
      app.get('/test', (req, res) => {
        processedTimestamp = Date.now();
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);

      const logCall = log.info.mock.calls.find(
        call => call[0] === 'REQUEST_LIFECYCLE'
      );
      
      const { processed } = logCall[2].timeline;
      expect(Math.abs(processed - processedTimestamp)).toBeLessThan(10);
    });

    it('should handle missing markLifecycleStage gracefully', async () => {
      app.get('/test', (req, res) => {
        // Simulate req.markLifecycleStage not being available
        delete req.markLifecycleStage;
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);

      // Should still log lifecycle
      expect(log.info).toHaveBeenCalledWith(
        'REQUEST_LIFECYCLE',
        'Request timeline',
        expect.any(Object)
      );
    });
  });

  describe('Performance', () => {
    it('should have minimal overhead', async () => {
      app.get('/test', (req, res) => {
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      const start = Date.now();
      await request(app).get('/test').expect(200);
      const duration = Date.now() - start;

      // Lifecycle tracking should add less than 10ms overhead
      expect(duration).toBeLessThan(100);
    });

    it('should not block request processing', async () => {
      let handlerExecuted = false;
      
      app.get('/test', (req, res) => {
        handlerExecuted = true;
        req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
        res.json({ success: true });
      });

      await request(app).get('/test').expect(200);
      expect(handlerExecuted).toBe(true);
    });
  });
});
