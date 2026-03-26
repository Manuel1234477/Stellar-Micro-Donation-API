/**
 * Tests for Payload Size Limit Middleware
 * Validates that oversized payloads are rejected and normal requests pass through
 */

const request = require('supertest');
const express = require('express');
const { createPayloadSizeLimiter, formatBytes, DEFAULT_LIMITS } = require('../src/middleware/payloadSizeLimit');

describe('Payload Size Limit Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
  });

  describe('formatBytes utility', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(500)).toBe('500 bytes');
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
      expect(formatBytes(1536)).toBe('1.50 KB');
    });
  });

  describe('JSON payload limits', () => {
    beforeEach(() => {
      app.use((req, res, next) => {
        req.id = 'test-request-id';
        next();
      });
      app.use(createPayloadSizeLimiter({ json: 1024 })); // 1KB limit
      app.use(express.json());
      app.post('/test', (req, res) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should accept payloads within size limit', async () => {
      const smallPayload = { message: 'Hello World' };
      
      const response = await request(app)
        .post('/test')
        .send(smallPayload)
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(smallPayload);
    });

    it('should reject oversized JSON payloads', async () => {
      // Create a payload larger than 1KB
      const largePayload = { data: 'x'.repeat(2000) };
      
      const response = await request(app)
        .post('/test')
        .send(largePayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(response.body.error.message).toContain('Request payload too large');
      expect(response.body.error.details).toHaveProperty('receivedSize');
      expect(response.body.error.details).toHaveProperty('maxSize');
      expect(response.body.error.details.payloadType).toBe('JSON');
    });

    it('should include request ID in error response', async () => {
      const largePayload = { data: 'x'.repeat(2000) };
      
      const response = await request(app)
        .post('/test')
        .send(largePayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.error.requestId).toBe('test-request-id');
      expect(response.body.error.timestamp).toBeDefined();
    });
  });

  describe('URL-encoded payload limits', () => {
    beforeEach(() => {
      app.use((req, res, next) => {
        req.id = 'test-request-id';
        next();
      });
      app.use(createPayloadSizeLimiter({ urlencoded: 512 })); // 512 bytes limit
      app.use(express.urlencoded({ extended: true }));
      app.post('/test', (req, res) => {
        res.json({ success: true, data: req.body });
      });
    });

    it('should accept URL-encoded payloads within limit', async () => {
      const response = await request(app)
        .post('/test')
        .send('name=John&email=john@example.com')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject oversized URL-encoded payloads', async () => {
      const largeData = 'data=' + 'x'.repeat(1000);
      
      const response = await request(app)
        .post('/test')
        .send(largeData)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(413);

      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(response.body.error.details.payloadType).toBe('URL-encoded');
    });
  });

  describe('Default limits', () => {
    beforeEach(() => {
      app.use((req, res, next) => {
        req.id = 'test-request-id';
        next();
      });
      app.use(createPayloadSizeLimiter()); // Use default limits
      app.use(express.json());
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should use default JSON limit of 100KB', async () => {
      // Create payload just under 100KB
      const acceptablePayload = { data: 'x'.repeat(90 * 1024) };
      
      const response = await request(app)
        .post('/test')
        .send(acceptablePayload)
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject payloads exceeding default 100KB limit', async () => {
      // Create payload larger than 100KB
      const largePayload = { data: 'x'.repeat(110 * 1024) };
      
      const response = await request(app)
        .post('/test')
        .send(largePayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('Content-Length header handling', () => {
    beforeEach(() => {
      app.use((req, res, next) => {
        req.id = 'test-request-id';
        next();
      });
      app.use(createPayloadSizeLimiter({ json: 1024 }));
      app.use(express.json());
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should handle missing Content-Length header', async () => {
      const response = await request(app)
        .post('/test')
        .send({ message: 'test' })
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should validate based on Content-Length header', async () => {
      const payload = { data: 'x'.repeat(2000) };
      
      const response = await request(app)
        .post('/test')
        .send(payload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('Different content types', () => {
    beforeEach(() => {
      app.use((req, res, next) => {
        req.id = 'test-request-id';
        next();
      });
      app.use(createPayloadSizeLimiter({
        json: 1024,
        text: 512,
        raw: 2048
      }));
      app.use(express.json());
      app.use(express.text());
      app.use(express.raw());
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should apply text limit for text/plain content', async () => {
      const largeText = 'x'.repeat(1000);
      
      const response = await request(app)
        .post('/test')
        .send(largeText)
        .set('Content-Type', 'text/plain')
        .expect(413);

      expect(response.body.error.details.payloadType).toBe('text');
    });

    it('should apply raw limit for octet-stream content', async () => {
      const buffer = Buffer.alloc(3000);
      
      const response = await request(app)
        .post('/test')
        .send(buffer)
        .set('Content-Type', 'application/octet-stream')
        .expect(413);

      expect(response.body.error.details.payloadType).toBe('raw');
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      app.use((req, res, next) => {
        req.id = 'test-request-id';
        next();
      });
      app.use(createPayloadSizeLimiter({ json: 1024 }));
      app.use(express.json());
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should handle GET requests without body', async () => {
      app.get('/get-test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/get-test')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle empty POST requests', async () => {
      const response = await request(app)
        .post('/test')
        .send({})
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle requests at exact size limit', async () => {
      // Create payload exactly at 1KB limit
      const exactPayload = { data: 'x'.repeat(1000) };
      
      const response = await request(app)
        .post('/test')
        .send(exactPayload)
        .set('Content-Type', 'application/json')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DEFAULT_LIMITS constant', () => {
    it('should export default limits', () => {
      expect(DEFAULT_LIMITS).toBeDefined();
      expect(DEFAULT_LIMITS.json).toBe(100 * 1024);
      expect(DEFAULT_LIMITS.urlencoded).toBe(100 * 1024);
      expect(DEFAULT_LIMITS.raw).toBe(1 * 1024 * 1024);
      expect(DEFAULT_LIMITS.text).toBe(100 * 1024);
    });
  });
});
