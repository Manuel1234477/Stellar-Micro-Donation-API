const { sanitizeForLogging } = require('./sanitizer');
const config = require('../config');

const isDebugMode = config.logging.debugMode;

/**
 * Standard log fields for structured logging
 * These fields provide consistent context across all logs
 */
const STANDARD_FIELDS = {
  SERVICE_NAME: config.app.name,
  ENVIRONMENT: config.server.env,
  VERSION: config.app.version
};

/**
 * Context storage for request-scoped data
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

function safeStringify(value) {
  try {
    // Sanitize before stringifying to prevent log injection
    const sanitized = sanitizeForLogging(value);
    return JSON.stringify(sanitized);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

/**
 * Get current request context (requestId, userId, etc.)
 * @returns {Object} Context object with request-scoped data
 */
function getContext() {
  if (!contextStorage) {
    return {};
  }
  return contextStorage.getStore() || {};
}

/**
 * Set request context for structured logging
 * @param {Object} context - Context data (requestId, userId, transactionId, etc.)
 */
function setContext(context) {
  if (!contextStorage) {
    return;
  }
  const currentContext = contextStorage.getStore() || {};
  contextStorage.enterWith({ ...currentContext, ...context });
}

/**
 * Build structured log entry with standard and custom fields
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
 * @param {string} scope - Log scope/component (e.g., 'DONATION_ROUTE', 'STELLAR_SERVICE')
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 * @returns {Object} Structured log entry
 */
function buildLogEntry(level, scope, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const context = getContext();
  
  // Sanitize scope and message to prevent log injection
  // eslint-disable-next-line no-control-regex
  const sanitizedScope = typeof scope === 'string' ? scope.replace(/[\x00-\x1F\x7F]/g, '') : scope;
  // eslint-disable-next-line no-control-regex
  const sanitizedMessage = typeof message === 'string' ? message.replace(/[\x00-\x1F\x7F]/g, '') : message;

  const logEntry = {
    timestamp,
    level,
    scope: sanitizedScope,
    message: sanitizedMessage,
    serviceName: STANDARD_FIELDS.SERVICE_NAME,
    environment: STANDARD_FIELDS.ENVIRONMENT,
    version: STANDARD_FIELDS.VERSION,
    ...context, // Include request context (requestId, userId, etc.)
    ...meta // Include additional metadata
  };

  return logEntry;
}

/**
 * Format log entry for console output
 * @param {Object} logEntry - Structured log entry
 * @returns {string} Formatted log string
 */
function formatMessage(logEntry) {
  const { timestamp, level, scope, message, requestId, transactionId, userId } = logEntry;
  
  // Build context string with available IDs
  const contextParts = [];
  if (requestId) contextParts.push(`reqId=${requestId.substring(0, 8)}`);
  if (transactionId) contextParts.push(`txId=${transactionId.substring(0, 8)}`);
  if (userId) contextParts.push(`userId=${userId}`);
  const contextStr = contextParts.length > 0 ? ` [${contextParts.join(' ')}]` : '';
  
  const base = `[${timestamp}] [${level}] [${scope}]${contextStr} ${message}`;

  // Extract metadata (exclude standard fields and context)
  const metaKeys = Object.keys(logEntry).filter(key => 
    !['timestamp', 'level', 'scope', 'message', 'serviceName', 'environment', 'version', 
      'requestId', 'transactionId', 'userId', 'walletAddress', 'sessionId'].includes(key)
  );

  if (metaKeys.length === 0) {
    return base;
  }

  const meta = {};
  metaKeys.forEach(key => {
    meta[key] = logEntry[key];
  });

  return `${base} ${safeStringify(meta)}`;
}

/**
 * Log info level message
 * @param {string} scope - Log scope/component
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 */
function info(scope, message, meta) {
  const logEntry = buildLogEntry('INFO', scope, message, meta);
  console.log(formatMessage(logEntry));
}

/**
 * Log warning level message
 * @param {string} scope - Log scope/component
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 */
function warn(scope, message, meta) {
  const logEntry = buildLogEntry('WARN', scope, message, meta);
  console.warn(formatMessage(logEntry));
}

/**
 * Log error level message
 * @param {string} scope - Log scope/component
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata (should include error details)
 */
function error(scope, message, meta) {
  const logEntry = buildLogEntry('ERROR', scope, message, meta);
  console.error(formatMessage(logEntry));
}

/**
 * Log debug level message (only in debug mode)
 * @param {string} scope - Log scope/component
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 */
function debug(scope, message, meta) {
  if (isDebugMode) {
    const logEntry = buildLogEntry('DEBUG', scope, message, meta);
    console.log(formatMessage(logEntry));
  }
}

/**
 * Create a child logger with preset context
 * Useful for maintaining context across multiple log calls
 * @param {Object} context - Context to include in all logs
 * @returns {Object} Logger instance with preset context
 */
function child(context) {
  return {
    info: (scope, message, meta) => info(scope, message, { ...context, ...meta }),
    warn: (scope, message, meta) => warn(scope, message, { ...context, ...meta }),
    error: (scope, message, meta) => error(scope, message, { ...context, ...meta }),
    debug: (scope, message, meta) => debug(scope, message, { ...context, ...meta }),
  };
}

module.exports = {
  info,
  warn,
  error,
  debug,
  child,
  setContext,
  getContext,
  isDebugMode,
  STANDARD_FIELDS,
};
