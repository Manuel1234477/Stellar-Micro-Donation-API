const request = require('supertest');
const express = require('express');
const { Logger } = require('../src/middleware/logger');

describe('Logger Middleware Integration Tests', () => {
  let app;
  let logger;
  let consoleLogSpy;

  beforeEach(() => {
    // Create test app
    app = express();
    app.use(express.json());

    // Create logger instance
    logger = new Logger({ logToFile: false });
    
    // Spy on console.log
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    // Apply logging middleware
    app.use(logger.middleware());

    // Test routes
    app.get('/test', (req, res) => {
      res.json({ message: 'success' });
    });

    app.post('/test-post', (req, res) => {
      res.json({ received: req.body });
    });

    app.get('/test-error', (req, res) => {
      res.status(500).json({ error: 'Internal error' });
    });

    app.post('/test-sensitive', (req, res) => {
      res.json({ status: 'processed' });
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Request Logging', () => {
    test('should log GET request with timestamp, method, and endpoint', async () => {
      await request(app)
        .get('/test')
        .expect(200);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      
      expect(logOutput).toContain('GET');
      expect(logOutput).toContain('/test');
      expect(logOutput).toContain('200');
      expect(logOutput).toMatch(/\d+ms/); // Duration in milliseconds
    });

    test('should log POST request with body', async () => {
      await request(app)
        .post('/test-post')
        .send({ name: 'test', value: 123 })
        .expect(200);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      
      expect(logOutput).toContain('POST');
      expect(logOutput).toContain('/test-post');
      expect(logOutput).toContain('200');
    });

    test('should log request with query parameters', async () => {
      await request(app)
        .get('/test?page=1&limit=10')
        .expect(200);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      
      expect(logOutput).toContain('GET');
      expect(logOutput).toContain('/test');
    });

    test('should log error responses', async () => {
      await request(app)
        .get('/test-error')
        .expect(500);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      
      expect(logOutput).toContain('GET');
      expect(logOutput).toContain('/test-error');
      expect(logOutput).toContain('500');
    });

    test('should log 404 responses', async () => {
      await request(app)
        .get('/non-existent')
        .expect(404);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      
      expect(logOutput).toContain('GET');
      expect(logOutput).toContain('/non-existent');
      expect(logOutput).toContain('404');
    });
  });

  describe('Sensitive Data Filtering', () => {
    test('should redact password in request body', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .post('/test-sensitive')
        .send({ username: 'testuser', password: 'secret123' })
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.body.username).toBe('testuser');
      expect(logData.request.body.password).toBe('[REDACTED]');
    });

    test('should redact authorization header', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .set('Authorization', 'Bearer secret-token')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.headers.authorization).toBe('[REDACTED]');
    });

    test('should redact API keys in headers', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .set('X-API-Key', 'secret-api-key')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.headers['x-api-key']).toBe('[REDACTED]');
    });

    test('should redact secret keys in request body', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .post('/test-sensitive')
        .send({ 
          publicKey: 'GXXXXXXXXXXXXXXX',
          secretKey: 'SXXXXXXXXXXXXXXX'
        })
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.body.publicKey).toBe('GXXXXXXXXXXXXXXX');
      expect(logData.request.body.secretKey).toBe('[REDACTED]');
    });

    test('should redact nested sensitive data', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .post('/test-sensitive')
        .send({ 
          user: {
            name: 'John',
            credentials: {
              password: 'secret',
              token: 'abc123'
            }
          }
        })
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.body.user.name).toBe('John');
      expect(logData.request.body.user.credentials.password).toBe('[REDACTED]');
      expect(logData.request.body.user.credentials.token).toBe('[REDACTED]');
    });
  });

  describe('Response Logging', () => {
    test('should capture and log response body', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.response.body).toEqual({ message: 'success' });
    });

    test('should include status code in response log', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.response.statusCode).toBe(200);
      expect(logData.statusCode).toBe(200);
    });
  });

  describe('Performance Metrics', () => {
    test('should include request duration in logs', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.duration).toBeGreaterThanOrEqual(0);
      expect(typeof logData.duration).toBe('number');
    });

    test('should include timestamp in ISO format', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('Request Metadata', () => {
    test('should log request IP address', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.ip).toBeDefined();
    });

    test('should log request headers', async () => {
      const logToConsoleSpy = jest.spyOn(logger, 'logToConsole');

      await request(app)
        .get('/test')
        .set('User-Agent', 'test-agent')
        .expect(200);

      expect(logToConsoleSpy).toHaveBeenCalled();
      const logData = logToConsoleSpy.mock.calls[0][0];
      
      expect(logData.request.headers).toBeDefined();
      expect(logData.request.headers['user-agent']).toBe('test-agent');
    });
  });
});
