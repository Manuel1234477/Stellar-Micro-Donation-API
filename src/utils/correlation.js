/**
 * Correlation Context Manager
 * Manages correlation ID propagation across async operations and background tasks
 * 
 * Features:
 * - Automatic correlation ID generation and propagation
 * - AsyncLocalStorage-based context management
 * - Background task correlation with parent request IDs
 * - Performance-optimized context handling
 */

const { v4: uuidv4 } = require('uuid');
const log = require('./log');

/**
 * Context storage for correlation IDs
 * Uses AsyncLocalStorage for thread-safe context management
 */
let contextStorage;
try {
  const { AsyncLocalStorage } = require('async_hooks');
  contextStorage = new AsyncLocalStorage();
} catch (error) {
  // Fallback for older Node versions
  contextStorage = null;
}

/**
 * Correlation context structure
 * @typedef {Object} CorrelationContext
 * @property {string} correlationId - Primary correlation ID
 * @property {string} parentCorrelationId - Parent correlation ID (for background tasks)
 * @property {string} operationId - Unique ID for current operation
 * @property {string} requestId - Original HTTP request ID (if applicable)
 * @property {string} traceId - End-to-end trace ID
 * @property {Object} metadata - Additional correlation metadata
 */

/**
 * Default correlation context
 */
const DEFAULT_CONTEXT = {
  correlationId: null,
  parentCorrelationId: null,
  operationId: null,
  requestId: null,
  traceId: null,
  metadata: {}
};

/**
 * Get current correlation context
 * @returns {CorrelationContext} Current correlation context
 */
function getCorrelationContext() {
  if (!contextStorage) {
    return { ...DEFAULT_CONTEXT };
  }
  return contextStorage.getStore() || { ...DEFAULT_CONTEXT };
}

/**
 * Set correlation context
 * @param {CorrelationContext} context - Correlation context to set
 */
function setCorrelationContext(context) {
  if (!contextStorage) {
    return;
  }
  const currentContext = contextStorage.getStore() || { ...DEFAULT_CONTEXT };
  contextStorage.enterWith({ ...currentContext, ...context });
}

/**
 * Create a new correlation context
 * @param {Object} options - Context creation options
 * @param {string} [options.correlationId] - Custom correlation ID
 * @param {string} [options.parentCorrelationId] - Parent correlation ID
 * @param {string} [options.requestId] - HTTP request ID
 * @param {string} [options.operationType] - Type of operation
 * @param {Object} [options.metadata] - Additional metadata
 * @returns {CorrelationContext} New correlation context
 */
function createCorrelationContext(options = {}) {
  const correlationId = options.correlationId || uuidv4();
  const traceId = options.traceId || correlationId;
  const operationId = uuidv4();
  
  const context = {
    correlationId,
    parentCorrelationId: options.parentCorrelationId || null,
    operationId,
    requestId: options.requestId || null,
    traceId,
    metadata: options.metadata || {}
  };

  // Add operation type to metadata
  if (options.operationType) {
    context.metadata.operationType = options.operationType;
  }

  return context;
}

/**
 * Initialize correlation context for HTTP requests
 * @param {string} requestId - HTTP request ID
 * @param {Object} [metadata] - Additional metadata
 * @returns {CorrelationContext} Created correlation context
 */
function initializeRequestContext(requestId, metadata = {}) {
  const context = createCorrelationContext({
    requestId,
    operationType: 'http_request',
    metadata: {
      ...metadata,
      initiatedAt: new Date().toISOString()
    }
  });

  setCorrelationContext(context);
  
  // Update logging context with correlation IDs
  log.setContext({
    correlationId: context.correlationId,
    traceId: context.traceId,
    operationId: context.operationId,
    requestId: context.requestId
  });

  log.debug('CORRELATION', 'Request correlation context initialized', {
    correlationId: context.correlationId,
    traceId: context.traceId,
    requestId
  });

  return context;
}

/**
 * Create child correlation context for async operations
 * @param {string} [operationType] - Type of async operation
 * @param {Object} [metadata] - Additional metadata
 * @returns {CorrelationContext} Child correlation context
 */
function createAsyncContext(operationType, metadata = {}) {
  const parentContext = getCorrelationContext();
  
  const childContext = createCorrelationContext({
    parentCorrelationId: parentContext.correlationId,
    requestId: parentContext.requestId,
    traceId: parentContext.traceId, // Inherit trace ID
    operationType,
    metadata: {
      ...metadata,
      parentOperationId: parentContext.operationId,
      createdAt: new Date().toISOString()
    }
  });

  setCorrelationContext(childContext);
  
  // Update logging context with new correlation IDs
  log.setContext({
    correlationId: childContext.correlationId,
    parentCorrelationId: childContext.parentCorrelationId,
    traceId: childContext.traceId,
    operationId: childContext.operationId,
    requestId: childContext.requestId
  });

  log.debug('CORRELATION', 'Async correlation context created', {
    correlationId: childContext.correlationId,
    parentCorrelationId: childContext.parentCorrelationId,
    operationType,
    traceId: childContext.traceId
  });

  return childContext;
}

/**
 * Create background task correlation context
 * @param {string} [taskType] - Type of background task
 * @param {Object} [metadata] - Additional metadata
 * @returns {CorrelationContext} Background task correlation context
 */
function createBackgroundContext(taskType, metadata = {}) {
  const context = createCorrelationContext({
    operationType: taskType || 'background_task',
    metadata: {
      ...metadata,
      taskType,
      initiatedAt: new Date().toISOString(),
      isBackgroundTask: true
    }
  });

  setCorrelationContext(context);
  
  // Update logging context with correlation IDs
  log.setContext({
    correlationId: context.correlationId,
    traceId: context.traceId,
    operationId: context.operationId
  });

  log.debug('CORRELATION', 'Background correlation context created', {
    correlationId: context.correlationId,
    taskType,
    traceId: context.traceId
  });

  return context;
}

/**
 * Execute function with correlation context
 * @param {CorrelationContext} context - Correlation context to use
 * @param {Function} fn - Function to execute
 * @returns {*} Function result
 */
function withCorrelationContext(context, fn) {
  if (!contextStorage) {
    return fn();
  }

  return contextStorage.run(context, fn);
}

/**
 * Execute function with new async context
 * @param {string} operationType - Type of operation
 * @param {Function} fn - Function to execute
 * @param {Object} [metadata] - Additional metadata
 * @returns {*} Function result
 */
function withAsyncContext(operationType, fn, metadata = {}) {
  const context = createAsyncContext(operationType, metadata);
  return withCorrelationContext(context, fn);
}

/**
 * Execute function with background context
 * @param {string} taskType - Type of background task
 * @param {Function} fn - Function to execute
 * @param {Object} [metadata] - Additional metadata
 * @returns {*} Function result
 */
function withBackgroundContext(taskType, fn, metadata = {}) {
  const context = createBackgroundContext(taskType, metadata);
  return withCorrelationContext(context, fn);
}

/**
 * Get correlation summary for logging
 * @returns {Object} Correlation summary
 */
function getCorrelationSummary() {
  const context = getCorrelationContext();
  
  return {
    correlationId: context.correlationId,
    parentCorrelationId: context.parentCorrelationId,
    traceId: context.traceId,
    operationId: context.operationId,
    requestId: context.requestId,
    hasParent: !!context.parentCorrelationId,
    isBackgroundTask: context.metadata.isBackgroundTask || false,
    operationType: context.metadata.operationType
  };
}

/**
 * Check if correlation context is available
 * @returns {boolean} True if correlation context is available
 */
function hasCorrelationContext() {
  const context = getCorrelationContext();
  return !!context.correlationId;
}

/**
 * Generate correlation headers for outbound requests
 * @returns {Object} Headers object with correlation IDs
 */
function generateCorrelationHeaders() {
  const context = getCorrelationContext();
  const headers = {};

  if (context.correlationId) {
    headers['X-Correlation-ID'] = context.correlationId;
  }
  
  if (context.traceId) {
    headers['X-Trace-ID'] = context.traceId;
  }
  
  if (context.operationId) {
    headers['X-Operation-ID'] = context.operationId;
  }

  return headers;
}

/**
 * Parse correlation headers from inbound request
 * @param {Object} headers - Request headers
 * @returns {Object} Parsed correlation IDs
 */
function parseCorrelationHeaders(headers) {
  const parsed = {};

  if (headers['x-correlation-id']) {
    parsed.correlationId = headers['x-correlation-id'];
  }
  
  if (headers['x-trace-id']) {
    parsed.traceId = headers['x-trace-id'];
  }
  
  if (headers['x-operation-id']) {
    parsed.operationId = headers['x-operation-id'];
  }

  return parsed;
}

module.exports = {
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
};
