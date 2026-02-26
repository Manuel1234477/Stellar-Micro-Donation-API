/**
 * Correlation ID Propagation Tests
 * Tests for end-to-end correlation ID propagation across async operations
 */

const {
  getCorrelationContext,
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
} = require('../../../src/utils/correlation');

describe('Correlation ID Propagation', () => {
  beforeEach(() => {
    // Clear any existing context before each test
    jest.clearAllMocks();
  });

  describe('Correlation Context Management', () => {
    test('should create correlation context with default values', () => {
      const context = createCorrelationContext();
      
      expect(context).toMatchObject({
        correlationId: expect.any(String),
        parentCorrelationId: null,
        operationId: expect.any(String),
        requestId: null,
        traceId: expect.any(String),
        metadata: {}
      });
      
      expect(context.correlationId).toBe(context.traceId);
      expect(context.correlationId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    test('should create correlation context with custom values', () => {
      const customContext = {
        correlationId: 'custom-correlation-id',
        parentCorrelationId: 'parent-id',
        requestId: 'request-123',
        operationType: 'test_operation'
      };
      
      const context = createCorrelationContext(customContext);
      
      expect(context.correlationId).toBe('custom-correlation-id');
      expect(context.parentCorrelationId).toBe('parent-id');
      expect(context.requestId).toBe('request-123');
      expect(context.metadata.operationType).toBe('test_operation');
    });

    test('should initialize request context properly', () => {
      const requestId = 'req-123';
      const metadata = { userId: 'user-456' };
      
      const context = initializeRequestContext(requestId, metadata);
      
      expect(context.requestId).toBe(requestId);
      expect(context.metadata.operationType).toBe('http_request');
      expect(context.metadata.userId).toBe('user-456');
      expect(context.metadata.initiatedAt).toBeDefined();
    });

    test('should create async context with parent correlation', () => {
      // First create a parent context
      const parentContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'parent_operation'
      });
      
      withCorrelationContext(parentContext, () => {
        const asyncContext = createAsyncContext('child_operation');
        
        expect(asyncContext.parentCorrelationId).toBe(parentContext.correlationId);
        expect(asyncContext.requestId).toBe('req-123');
        expect(asyncContext.traceId).toBe(parentContext.traceId);
        expect(asyncContext.metadata.operationType).toBe('child_operation');
        expect(asyncContext.metadata.parentOperationId).toBe(parentContext.operationId);
      });
    });

    test('should create background context independently', () => {
      const backgroundContext = createBackgroundContext('scheduler_task');
      
      expect(backgroundContext.parentCorrelationId).toBeNull();
      expect(backgroundContext.metadata.operationType).toBe('scheduler_task');
      expect(backgroundContext.metadata.isBackgroundTask).toBe(true);
      expect(backgroundContext.metadata.taskType).toBe('scheduler_task');
    });
  });

  describe('Context Execution Wrappers', () => {
    test('should execute function with correlation context', () => {
      const context = createCorrelationContext({ operationType: 'test' });
      let capturedContext = null;
      
      withCorrelationContext(context, () => {
        capturedContext = getCorrelationContext();
      });
      
      expect(capturedContext.correlationId).toBe(context.correlationId);
      expect(capturedContext.metadata.operationType).toBe('test');
    });

    test('should execute async function with correlation context', async () => {
      const result = await withAsyncContext('async_test', async () => {
        const context = getCorrelationContext();
        await new Promise(resolve => setTimeout(resolve, 10));
        return context.correlationId;
      });
      
      expect(result).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('should execute background function with correlation context', async () => {
      const result = await withBackgroundContext('background_test', async () => {
        const context = getCorrelationContext();
        return {
          correlationId: context.correlationId,
          isBackground: context.metadata.isBackgroundTask
        };
      });
      
      expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.isBackground).toBe(true);
    });
  });

  describe('Correlation Header Management', () => {
    test('should generate correlation headers from context', () => {
      const context = createCorrelationContext({
        correlationId: 'corr-123',
        traceId: 'trace-456',
        operationId: 'op-789'
      });
      
      withCorrelationContext(context, () => {
        const headers = generateCorrelationHeaders();
        
        expect(headers).toEqual({
          'X-Correlation-ID': 'corr-123',
          'X-Trace-ID': 'trace-456',
          'X-Operation-ID': 'op-789'
        });
      });
    });

    test('should parse correlation headers from request', () => {
      const headers = {
        'x-correlation-id': 'incoming-corr-123',
        'x-trace-id': 'incoming-trace-456',
        'x-operation-id': 'incoming-op-789',
        'other-header': 'should-be-ignored'
      };
      
      const parsed = parseCorrelationHeaders(headers);
      
      expect(parsed).toEqual({
        correlationId: 'incoming-corr-123',
        traceId: 'incoming-trace-456',
        operationId: 'incoming-op-789'
      });
    });

    test('should handle empty headers gracefully', () => {
      const parsed = parseCorrelationHeaders({});
      expect(parsed).toEqual({});
      
      const headers = generateCorrelationHeaders();
      expect(headers).toEqual({});
    });
  });

  describe('Context Summary and Utilities', () => {
    test('should provide correlation summary', () => {
      const context = createCorrelationContext({
        parentCorrelationId: 'parent-123',
        requestId: 'req-456',
        operationType: 'test_operation'
      });
      
      withCorrelationContext(context, () => {
        const summary = getCorrelationSummary();
        
        expect(summary).toMatchObject({
          correlationId: context.correlationId,
          parentCorrelationId: 'parent-123',
          traceId: context.traceId,
          operationId: context.operationId,
          requestId: 'req-456',
          hasParent: true,
          isBackgroundTask: false,
          operationType: 'test_operation'
        });
      });
    });

    test('should detect correlation context availability', () => {
      expect(hasCorrelationContext()).toBe(false);
      
      const context = createCorrelationContext();
      withCorrelationContext(context, () => {
        expect(hasCorrelationContext()).toBe(true);
      });
      
      expect(hasCorrelationContext()).toBe(false); // Should be back to false outside context
    });
  });

  describe('Async Context Propagation', () => {
    test('should propagate context through nested async operations', async () => {
      const outerContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'outer_operation'
      });
      
      const results = await withCorrelationContext(outerContext, async () => {
        const outerCorrelation = getCorrelationContext();
        
        // First level async operation
        const result1 = await withAsyncContext('inner_operation_1', async () => {
          const inner1Correlation = getCorrelationContext();
          
          // Second level async operation
          const result2 = await withAsyncContext('inner_operation_2', async () => {
            const inner2Correlation = getCorrelationContext();
            
            return {
              outerCorrelationId: outerCorrelation.correlationId,
              inner1CorrelationId: inner1Correlation.correlationId,
              inner2CorrelationId: inner2Correlation.correlationId,
              inner1ParentId: inner1Correlation.parentCorrelationId,
              inner2ParentId: inner2Correlation.parentCorrelationId,
              traceId: inner2Correlation.traceId
            };
          });
          
          return result2;
        });
        
        return result1;
      });
      
      // Verify context propagation
      expect(results.inner1ParentId).toBe(results.outerCorrelationId);
      expect(results.inner2ParentId).toBe(results.inner1CorrelationId);
      expect(results.traceId).toBe(results.outerCorrelationId); // Trace ID should be consistent
    });

    test('should handle concurrent async operations with separate contexts', async () => {
      const baseContext = createCorrelationContext({
        requestId: 'req-concurrent',
        operationType: 'concurrent_test'
      });
      
      const results = await withCorrelationContext(baseContext, async () => {
        const promises = [];
        
        // Create multiple concurrent async operations
        for (let i = 0; i < 3; i++) {
          const promise = withAsyncContext(`concurrent_op_${i}`, async () => {
            const context = getCorrelationContext();
            await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
            return {
              index: i,
              correlationId: context.correlationId,
              parentCorrelationId: context.parentCorrelationId,
              operationType: context.metadata.operationType
            };
          });
          
          promises.push(promise);
        }
        
        return Promise.all(promises);
      });
      
      // Verify each operation has its own correlation ID but same parent
      expect(results).toHaveLength(3);
      
      const correlationIds = results.map(r => r.correlationId);
      const uniqueIds = new Set(correlationIds);
      
      expect(uniqueIds.size).toBe(3); // All should be unique
      
      results.forEach((result, index) => {
        expect(result.parentCorrelationId).toBe(baseContext.correlationId);
        expect(result.operationType).toBe(`concurrent_op_${index}`);
      });
    });
  });

  describe('Background Task Context', () => {
    test('should handle background tasks independently', async () => {
      const result = await withBackgroundContext('test_background_task', async () => {
        const context = getCorrelationContext();
        
        // Simulate background work
        await new Promise(resolve => setTimeout(resolve, 5));
        
        return {
          correlationId: context.correlationId,
          isBackgroundTask: context.metadata.isBackgroundTask,
          taskType: context.metadata.taskType,
          hasParent: !!context.parentCorrelationId
        };
      });
      
      expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.isBackgroundTask).toBe(true);
      expect(result.taskType).toBe('test_background_task');
      expect(result.hasParent).toBe(false);
    });

    test('should not interfere with request contexts', async () => {
      const requestContext = createCorrelationContext({
        requestId: 'req-123',
        operationType: 'http_request'
      });
      
      const requestResult = await withCorrelationContext(requestContext, async () => {
        // Start a background task
        const backgroundResult = await withBackgroundContext('background_from_request', async () => {
          const bgContext = getCorrelationContext();
          return {
            correlationId: bgContext.correlationId,
            hasParent: !!bgContext.parentCorrelationId,
            isBackground: bgContext.metadata.isBackgroundTask
          };
        });
        
        // Get request context after background task
        const currentContext = getCorrelationContext();
        
        return {
          requestCorrelationId: currentContext.correlationId,
          backgroundResult
        };
      });
      
      expect(requestResult.requestCorrelationId).toBe(requestContext.correlationId);
      expect(requestResult.backgroundResult.hasParent).toBe(false);
      expect(requestResult.backgroundResult.isBackground).toBe(true);
    });
  });

  describe('Performance Considerations', () => {
    test('should handle high-frequency context operations efficiently', async () => {
      const startTime = Date.now();
      const iterations = 1000;
      
      for (let i = 0; i < iterations; i++) {
        await withAsyncContext(`perf_test_${i}`, async () => {
          const context = getCorrelationContext();
          expect(context.correlationId).toBeDefined();
        });
      }
      
      const duration = Date.now() - startTime;
      
      // Should complete 1000 operations in reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);
      console.log(`Performance test: ${iterations} operations completed in ${duration}ms`);
    });

    test('should have minimal memory overhead for context storage', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create many contexts
      const contexts = [];
      for (let i = 0; i < 100; i++) {
        contexts.push(createCorrelationContext({
          operationType: `memory_test_${i}`,
          metadata: { index: i, data: 'test'.repeat(10) }
        }));
      }
      
      const afterCreationMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = afterCreationMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 1MB for 100 contexts)
      expect(memoryIncrease).toBeLessThan(1024 * 1024);
      
      console.log(`Memory test: 100 contexts used ${(memoryIncrease / 1024).toFixed(2)}KB`);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing AsyncLocalStorage gracefully', () => {
      // Mock the scenario where AsyncLocalStorage is not available
      const originalAsyncHooks = require('async_hooks');
      jest.doMock('async_hooks', () => {
        throw new Error('AsyncLocalStorage not available');
      });
      
      // Re-require the correlation module to test fallback
      delete require.cache[require.resolve('../../../src/utils/correlation')];
      const correlationFallback = require('../../../src/utils/correlation');
      
      expect(() => {
        correlationFallback.createCorrelationContext();
        correlationFallback.getCorrelationContext();
      }).not.toThrow();
      
      // Restore original module
      jest.doMock('async_hooks', () => originalAsyncHooks);
    });

    test('should handle malformed context data gracefully', () => {
      expect(() => {
        createCorrelationContext({
          correlationId: null,
          parentCorrelationId: undefined,
          metadata: null
        });
      }).not.toThrow();
      
      expect(() => {
        parseCorrelationHeaders({
          'x-correlation-id': '',
          'x-trace-id': null,
          'x-operation-id': undefined
        });
      }).not.toThrow();
    });

    test('should preserve context through promise rejections', async () => {
      const context = createCorrelationContext({
        operationType: 'error_test'
      });
      
      try {
        await withCorrelationContext(context, async () => {
          await withAsyncContext('failing_operation', async () => {
            throw new Error('Test error');
          });
        });
      } catch (error) {
        // Context should still be available even after error
        const currentContext = getCorrelationContext();
        expect(currentContext.correlationId).toBe(context.correlationId);
      }
    });
  });
});
