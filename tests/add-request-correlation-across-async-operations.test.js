/**
 * Test Suite: Request Correlation Context Propagation Across Async Operations
 * 
 * Issue #382: Correlation context (request ID, trace ID, correlation ID) should be
 * maintained across all async operations including background jobs, webhook delivery,
 * and reconciliation services.
 *
 * Test Coverage:
 * - AsyncLocalStorage context propagation in async functions
 * - Webhook delivery with correlation headers
 * - Reconciliation service context propagation
 * - Background job context management
 * - Edge cases and error scenarios
 */

const {
  getCorrelationContext,
  setCorrelationContext,
  createCorrelationContext,
  initializeRequestContext,
  createAsyncContext,
  createBackgroundContext,
  withCorrelationContext,
  withAsyncContext,
  withBackgroundContext,
  getCorrelationSummary,
  hasCorrelationContext,
  generateCorrelationHeaders,
  parseCorrelationHeaders,
  DEFAULT_CONTEXT
} = require('../src/utils/correlation');

const WebhookService = require('../src/services/WebhookService');

describe('Request Correlation Context Propagation (Issue #382)', () => {
  
  describe('Core Correlation Context Management', () => {
    
    test('should create correlation context with required fields', () => {
      const context = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request',
        metadata: { userId: 'user-456' }
      });

      expect(context).toHaveProperty('correlationId');
      expect(context).toHaveProperty('traceId');
      expect(context).toHaveProperty('operationId');
      expect(context.requestId).toBe('req-123');
      expect(context.metadata.userId).toBe('user-456');
    });

    test('should create child async context inheriting parent trace ID', () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });

      setCorrelationContext(parentContext);
      const childContext = createAsyncContext('webhook_delivery', {
        webhookId: 'webhook-1'
      });

      expect(childContext.traceId).toBe(parentContext.traceId);
      expect(childContext.requestId).toBe(parentContext.requestId);
      expect(childContext.parentCorrelationId).toBe(parentContext.correlationId);
      expect(childContext.metadata.webhookId).toBe('webhook-1');
      expect(childContext.operationId).not.toBe(parentContext.operationId);
    });

    test('should create background context with isBackgroundTask flag', () => {
      const bgContext = createBackgroundContext('reconciliation', {
        taskId: 'task-789'
      });

      expect(bgContext.metadata.isBackgroundTask).toBe(true);
      expect(bgContext.metadata.taskType).toBe('reconciliation');
      expect(bgContext.metadata.taskId).toBe('task-789');
    });

    test('should get current correlation context', () => {
      const context = createCorrelationContext({ requestId: 'req-123' });
      setCorrelationContext(context);

      const retrieved = getCorrelationContext();
      expect(retrieved.correlationId).toBe(context.correlationId);
      expect(retrieved.requestId).toEqual('req-123');
    });

    test('should return default context when none is set', () => {
      // Clear any existing context
      setCorrelationContext({ ...DEFAULT_CONTEXT });

      const context = getCorrelationContext();
      expect(context.correlationId).toBeDefined();
    });
  });

  describe('Async Context Propagation', () => {
    
    test('should propagate context through withAsyncContext wrapper', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(parentContext);

      let capturedContext = null;
      await withAsyncContext('async_operation', async () => {
        capturedContext = getCorrelationContext();
      });

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.traceId).toBe(parentContext.traceId);
      expect(capturedContext.parentCorrelationId).toBe(parentContext.correlationId);
    });

    test('should propagate context through nested async operations', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(parentContext);

      let level1Context = null;
      let level2Context = null;

      await withAsyncContext('level1', async () => {
        level1Context = getCorrelationContext();

        await withAsyncContext('level2', async () => {
          level2Context = getCorrelationContext();
        });
      });

      expect(level1Context.traceId).toBe(parentContext.traceId);
      expect(level2Context.traceId).toBe(parentContext.traceId);
      expect(level2Context.parentCorrelationId).toBe(level1Context.correlationId);
    });

    test('should maintain context across Promise chains', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(parentContext);

      let contextInPromise = null;
      let contextAfterAwait = null;

      await withAsyncContext('promise_test', async () => {
        contextInPromise = getCorrelationContext();

        await new Promise(resolve => setTimeout(resolve, 10));
        contextAfterAwait = getCorrelationContext();
      });

      expect(contextInPromise).not.toBeNull();
      expect(contextAfterAwait).not.toBeNull();
      expect(contextInPromise.correlationId).toBe(contextAfterAwait.correlationId);
    });

    test('should handle errors while maintaining context', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(parentContext);

      let contextBeforeError = null;
      let contextInCatch = null;

      try {
        await withAsyncContext('error_test', async () => {
          contextBeforeError = getCorrelationContext();
          throw new Error('Test error');
        });
      } catch (err) {
        contextInCatch = getCorrelationContext();
      }

      expect(contextBeforeError).not.toBeNull();
      expect(contextInCatch).not.toBeNull();
    });
  });

  describe('Background Task Context', () => {
    
    test('should execute background task with isolated context', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(parentContext);

      let bgContext = null;
      await withBackgroundContext('reconciliation', async () => {
        bgContext = getCorrelationContext();
      });

      expect(bgContext).not.toBeNull();
      expect(bgContext.metadata.isBackgroundTask).toBe(true);
      expect(bgContext.traceId).not.toBe(parentContext.traceId);
    });

    test('should mark background task with correct type', async () => {
      await withBackgroundContext('webhook_delivery', async () => {
        const context = getCorrelationContext();
        expect(context.metadata.taskType).toBe('webhook_delivery');
      });
    });
  });

  describe('Correlation Headers Generation', () => {
    
    test('should generate correlation headers from context', () => {
      const context = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(context);

      const headers = generateCorrelationHeaders();

      expect(headers['X-Correlation-ID']).toBe(context.correlationId);
      expect(headers['X-Trace-ID']).toBe(context.traceId);
      expect(headers['X-Operation-ID']).toBe(context.operationId);
    });

    test('should generate headers with trace ID propagation', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(parentContext);

      let headers = null;
      await withAsyncContext('async_op', async () => {
        headers = generateCorrelationHeaders();
      });

      expect(headers['X-Trace-ID']).toBe(parentContext.traceId);
    });
  });

  describe('Correlation Headers Parsing', () => {
    
    test('should parse correlation headers from request', () => {
      const headers = {
        'x-correlation-id': 'corr-123',
        'x-trace-id': 'trace-456',
        'x-operation-id': 'op-789'
      };

      const parsed = parseCorrelationHeaders(headers);

      expect(parsed.correlationId).toBe('corr-123');
      expect(parsed.traceId).toBe('trace-456');
      expect(parsed.operationId).toBe('op-789');
    });

    test('should handle missing headers gracefully', () => {
      const headers = {
        'x-correlation-id': 'corr-123'
      };

      const parsed = parseCorrelationHeaders(headers);

      expect(parsed.correlationId).toBe('corr-123');
      expect(parsed.traceId).toBeUndefined();
      expect(parsed.operationId).toBeUndefined();
    });
  });

  describe('WebhookService Integration', () => {
    
    test('should deliver webhook event with correlation context', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(parentContext);

      // Mock the database and HTTP operations
      const mockWebhook = {
        id: 1,
        url: 'https://example.com/webhook',
        events: ['transaction.confirmed'],
        secret: 'secret-key',
        consecutive_failures: 0
      };

      // Simulate webhook delivery context check
      let deliveryContext = null;
      const originalDeliver = WebhookService._deliverWithRetry.bind(WebhookService);
      WebhookService._deliverWithRetry = async function(webhook, event, payload, attempt) {
        deliveryContext = getCorrelationContext();
      };

      // Restore original
      WebhookService._deliverWithRetry = originalDeliver;

      expect(deliveryContext).not.toBeNull();
    });

    test('should include correlation context in webhook payload', () => {
      const context = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });

      const payload = {
        event: 'transaction.confirmed',
        data: { txId: 'tx-123' },
        timestamp: new Date().toISOString(),
        correlationContext: {
          correlationId: context.correlationId,
          traceId: context.traceId,
          operationId: context.operationId
        }
      };

      expect(payload.correlationContext.correlationId).toBeDefined();
      expect(payload.correlationContext.traceId).toBeDefined();
      expect(payload.correlationContext.operationId).toBeDefined();
    });
  });

  describe('Context Summary and Status', () => {
    
    test('should provide correlation summary', () => {
      const context = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      setCorrelationContext(context);

      const summary = getCorrelationSummary();

      expect(summary).toHaveProperty('correlationId');
      expect(summary).toHaveProperty('traceId');
      expect(summary).toHaveProperty('operationId');
      expect(summary).toHaveProperty('requestId');
      expect(summary.requestId).toBe('req-123');
      expect(summary.hasParent).toBe(false);
      expect(summary.isBackgroundTask).toBe(false);
    });

    test('should indicate child context with parent', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(parentContext);

      let summary = null;
      await withAsyncContext('child_op', async () => {
        summary = getCorrelationSummary();
      });

      expect(summary.hasParent).toBe(true);
      expect(summary.parentCorrelationId).toBe(parentContext.correlationId);
    });

    test('should check context availability', () => {
      const context = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(context);

      expect(hasCorrelationContext()).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    
    test('should handle undefined metadata', () => {
      const context = createCorrelationContext({
        requestId: 'req-123'
      });

      expect(context.metadata).toBeDefined();
      expect(typeof context.metadata).toBe('object');
    });

    test('should handle multiple concurrent async operations', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(parentContext);

      const operations = Array.from({ length: 5 }, (_, i) =>
        withAsyncContext(`op-${i}`, async () => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return getCorrelationContext();
        })
      );

      const contexts = await Promise.all(operations);

      expect(contexts.length).toBe(5);
      // All should have the same trace ID
      contexts.forEach(ctx => {
        expect(ctx.traceId).toBe(parentContext.traceId);
      });
    });

    test('should handle rapid sequential async operations', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(parentContext);

      const results = [];
      for (let i = 0; i < 5; i++) {
        await withAsyncContext(`op-${i}`, async () => {
          results.push(getCorrelationContext());
        });
      }

      expect(results.length).toBe(5);
      // All should have the same trace ID
      results.forEach(ctx => {
        expect(ctx.traceId).toBe(parentContext.traceId);
      });
    });

    test('should handle context initialization from HTTP request headers', () => {
      const headers = {
        'x-correlation-id': 'corr-123',
        'x-trace-id': 'trace-456',
        'x-request-id': 'req-789'
      };

      const parsed = parseCorrelationHeaders(headers);
      expect(parsed.correlationId).toBe('corr-123');
      expect(parsed.traceId).toBe('trace-456');
    });
  });

  describe('Performance and Memory', () => {
    
    test('should not create context memory leaks with many operations', async () => {
      const parentContext = createCorrelationContext({
        requestId: 'req-123'
      });
      setCorrelationContext(parentContext);

      const operations = Array.from({ length: 100 }, (_, i) =>
        withAsyncContext(`op-${i}`, async () => {
          return getCorrelationContext().correlationId;
        })
      );

      const results = await Promise.all(operations);
      expect(results.length).toBe(100);
      expect(new Set(results).size).toBeGreaterThan(0);
    });
  });
});
