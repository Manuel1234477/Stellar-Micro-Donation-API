/**
 * Request ID Middleware Tests with Correlation ID Support
 * Tests for enhanced request ID middleware with correlation context management
 */

const request = require('supertest');
const express = require('express');
const requestIdMiddleware = require('../src/middleware/requestId');
const { getCorrelationContext, parseCorrelationHeaders } = require('../src/utils/correlation');

describe('Request ID Middleware with Correlation Support', () => {
  let app;
  
  beforeEach(() => {
    app = express();
    app.use(requestIdMiddleware);
    
    // Add test route to verify middleware behavior
    app.get('/test', (req, res) => {
      res.json({
        requestId: req.id,
        correlationContext: req.correlationContext,
        headers: {
          'X-Request-ID': res.getHeader('X-Request-ID'),
          'X-Correlation-ID': res.getHeader('X-Correlation-ID'),
          'X-Trace-ID': res.getHeader('X-Trace-ID')
        }
      });
    });
    
    // Clear correlation context before each test
    jest.clearAllMocks();
  });

  describe('Basic Request ID Functionality', () => {
    test('should generate request ID when not provided in headers', async () => {
      const response = await request(app)
        .get('/test')
        .expect(200);
      
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(response.body.headers['X-Request-ID']).toBe(response.body.requestId);
    });

    test('should use existing request ID from headers', async () => {
      const existingRequestId = 'existing-request-123';
      
      const response = await request(app)
        .get('/test')
        .set('X-Request-ID', existingRequestId)
        .expect(200);
      
      expect(response.body.requestId).toBe(existingRequestId);
      expect(response.body.headers['X-Request-ID']).toBe(existingRequestId);
    });
  });

  describe('Correlation ID Generation and Propagation', () => {
    test('should generate correlation context for new requests', async () => {
      const response = await request(app)
        .get('/test')
        .expect(200);
      
      const { correlationContext } = response.body;
      
      expect(correlationContext).toMatchObject({
        correlationId: expect.any(String),
        parentCorrelationId: null,
        operationId: expect.any(String),
        requestId: response.body.requestId,
        traceId: expect.any(String),
        metadata: expect.objectContaining({
          operationType: 'http_request',
          method: 'GET',
          path: '/test',
          initiatedAt: expect.any(String)
        })
      });
      
      // Verify correlation headers are set
      expect(response.body.headers['X-Correlation-ID']).toBe(correlationContext.correlationId);
      expect(response.body.headers['X-Trace-ID']).toBe(correlationContext.traceId);
    });

    test('should parse inbound correlation headers', async () => {
      const inboundHeaders = {
        'X-Correlation-ID': 'inbound-correlation-123',
        'X-Trace-ID': 'inbound-trace-456',
        'X-Operation-ID': 'inbound-operation-789'
      };
      
      const response = await request(app)
        .get('/test')
        .set(inboundHeaders)
        .expect(200);
      
      const { correlationContext } = response.body;
      
      expect(correlationContext.correlationId).toBe('inbound-correlation-123');
      expect(correlationContext.traceId).toBe('inbound-trace-456');
      expect(correlationContext.metadata.operationType).toBe('http_request');
    });

    test('should maintain trace ID when correlation ID is provided', async () => {
      const headers = {
        'X-Request-ID': 'req-123',
        'X-Correlation-ID': 'corr-456',
        'X-Trace-ID': 'trace-789'
      };
      
      const response = await request(app)
        .get('/test')
        .set(headers)
        .expect(200);
      
      const { correlationContext } = response.body;
      
      expect(correlationContext.requestId).toBe('req-123');
      expect(correlationContext.correlationId).toBe('corr-456');
      expect(correlationContext.traceId).toBe('trace-789');
      expect(response.body.headers['X-Trace-ID']).toBe('trace-789');
    });
  });

  describe('Context Storage and Retrieval', () => {
    test('should store correlation context in async storage', async () => {
      // Mock a route handler that checks correlation context
      app.get('/context-test', (req, res) => {
        const currentContext = getCorrelationContext();
        res.json({
          hasContext: !!currentContext.correlationId,
          correlationId: currentContext.correlationId,
          requestId: currentContext.requestId,
          operationType: currentContext.metadata.operationType
        });
      });
      
      const response = await request(app)
        .get('/context-test')
        .expect(200);
      
      expect(response.body.hasContext).toBe(true);
      expect(response.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.body.requestId).toBe(response.body.headers['X-Request-ID']);
      expect(response.body.operationType).toBe('http_request');
    });

    test('should preserve context through async operations', async () => {
      // Mock a route with async operations
      app.get('/async-test', async (req, res) => {
        const initialContext = getCorrelationContext();
        
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const afterAsyncContext = getCorrelationContext();
        
        res.json({
          contextPreserved: initialContext.correlationId === afterAsyncContext.correlationId,
          initialCorrelationId: initialContext.correlationId,
          afterAsyncCorrelationId: afterAsyncContext.correlationId
        });
      });
      
      const response = await request(app)
        .get('/async-test')
        .expect(200);
      
      expect(response.body.contextPreserved).toBe(true);
      expect(response.body.initialCorrelationId).toBe(response.body.afterAsyncCorrelationId);
    });
  });

  describe('Header Handling Edge Cases', () => {
    test('should handle empty correlation headers gracefully', async () => {
      const response = await request(app)
        .get('/test')
        .set('X-Correlation-ID', '')
        .set('X-Trace-ID', '')
        .expect(200);
      
      const { correlationContext } = response.body;
      
      // Should generate new correlation IDs when headers are empty
      expect(correlationContext.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(correlationContext.correlationId).not.toBe('');
    });

    test('should handle malformed correlation headers', async () => {
      const response = await request(app)
        .get('/test')
        .set('X-Correlation-ID', null)
        .set('X-Trace-ID', undefined)
        .expect(200);
      
      const { correlationContext } = response.body;
      
      // Should generate new correlation IDs when headers are invalid
      expect(correlationContext.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('should ignore non-standard correlation headers', async () => {
      const response = await request(app)
        .get('/test')
        .set('X-Custom-Correlation', 'should-be-ignored')
        .set('X-Random-Header', 'also-ignored')
        .expect(200);
      
      const { correlationContext } = response.body;
      
      // Should generate new correlation ID, not use custom headers
      expect(correlationContext.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(correlationContext.correlationId).not.toBe('should-be-ignored');
    });
  });

  describe('Request Metadata Integration', () => {
    test('should include request metadata in correlation context', async () => {
      const userAgent = 'Test-Agent/1.0';
      const clientIp = '127.0.0.1';
      
      const response = await request(app)
        .get('/test')
        .set('User-Agent', userAgent)
        .set('X-Forwarded-For', clientIp)
        .expect(200);
      
      const { correlationContext } = response.body;
      
      expect(correlationContext.metadata).toMatchObject({
        operationType: 'http_request',
        method: 'GET',
        path: '/test',
        userAgent: userAgent,
        ip: expect.any(String), // Express may normalize IP
        initiatedAt: expect.any(String)
      });
    });

    test('should handle different HTTP methods', async () => {
      // Add routes for different methods
      app.post('/test', (req, res) => {
        res.json({
          method: req.correlationContext.metadata.method,
          correlationId: req.correlationContext.correlationId
        });
      });
      
      app.put('/test', (req, res) => {
        res.json({
          method: req.correlationContext.metadata.method,
          correlationId: req.correlationContext.correlationId
        });
      });
      
      const postResponse = await request(app)
        .post('/test')
        .expect(200);
      
      const putResponse = await request(app)
        .put('/test')
        .expect(200);
      
      expect(postResponse.body.method).toBe('POST');
      expect(putResponse.body.method).toBe('PUT');
      expect(postResponse.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(putResponse.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle high-volume requests efficiently', async () => {
      const startTime = Date.now();
      const requestCount = 100;
      
      const promises = [];
      for (let i = 0; i < requestCount; i++) {
        promises.push(
          request(app)
            .get('/test')
            .expect(200)
        );
      }
      
      const responses = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      // All requests should have unique correlation IDs
      const correlationIds = responses.map(r => r.body.correlationContext.correlationId);
      const uniqueIds = new Set(correlationIds);
      
      expect(uniqueIds.size).toBe(requestCount);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      
      console.log(`Performance test: ${requestCount} requests completed in ${duration}ms`);
    });

    test('should have minimal overhead for correlation context creation', async () => {
      const startTime = Date.now();
      
      // Make requests with and without correlation headers
      await request(app).get('/test').expect(200);
      await request(app)
        .get('/test')
        .set('X-Correlation-ID', 'test-correlation')
        .set('X-Trace-ID', 'test-trace')
        .expect(200);
      
      const duration = Date.now() - startTime;
      
      // Should complete very quickly (less than 50ms for 2 requests)
      expect(duration).toBeLessThan(50);
    });
  });

  describe('Integration with Other Middleware', () => {
    test('should work correctly when multiple middleware are present', async () => {
      // Add additional middleware before and after request ID middleware
      app.use((req, res, next) => {
        req.preMiddlewareTime = Date.now();
        next();
      });
      
      app.use(requestIdMiddleware);
      
      app.use((req, res, next) => {
        req.postMiddlewareTime = Date.now();
        next();
      });
      
      app.get('/integration-test', (req, res) => {
        res.json({
          hasPreMiddleware: !!req.preMiddlewareTime,
          hasPostMiddleware: !!req.postMiddlewareTime,
          hasRequestId: !!req.id,
          hasCorrelationContext: !!req.correlationContext,
          middlewareOrder: req.preMiddlewareTime < req.postMiddlewareTime
        });
      });
      
      const response = await request(app)
        .get('/integration-test')
        .expect(200);
      
      expect(response.body.hasPreMiddleware).toBe(true);
      expect(response.body.hasPostMiddleware).toBe(true);
      expect(response.body.hasRequestId).toBe(true);
      expect(response.body.hasCorrelationContext).toBe(true);
      expect(response.body.middlewareOrder).toBe(true);
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle errors in correlation context creation gracefully', async () => {
      // Mock a scenario where correlation context creation might fail
      const originalCreateContext = require('../src/utils/correlation').createCorrelationContext;
      
      // Temporarily override createCorrelationContext to simulate error
      require('../src/utils/correlation').createCorrelationContext = jest.fn().mockImplementation(() => {
        throw new Error('Context creation failed');
      });
      
      // The middleware should still work even if correlation context fails
      const response = await request(app)
        .get('/test')
        .expect(200);
      
      // Should still have request ID even if correlation context fails
      expect(response.body.requestId).toBeDefined();
      expect(response.body.headers['X-Request-ID']).toBeDefined();
      
      // Restore original function
      require('../src/utils/correlation').createCorrelationContext = originalCreateContext;
    });
  });
});
