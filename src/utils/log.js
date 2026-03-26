/**
 * Logging Utility - Observability Layer
 * 
 * RESPONSIBILITY: Structured logging with correlation tracking and sensitive data masking
 * OWNER: Platform Team
 * DEPENDENCIES: Sanitizer, config, correlation utilities
 * 
 * Provides centralized logging infrastructure with automatic sensitive data masking,
 * request correlation, structured JSON output, log levels, file rotation, and sampling.
 */

const { sanitizeForLogging } = require('./sanitizer');
const { maskSensitiveData } = require('./dataMasker');
const config = require('../config');
const fs = require('fs');
const path = require('path');

const isDebugMode = config.logging.debugMode;

const LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

const LOG_LEVEL = config.logging.level ? config.logging.level.toUpperCase() : 'INFO';
const CURRENT_LEVEL = LEVELS[LOG_LEVEL] || LEVELS.INFO;
const LOG_FORMAT = config.logging.format || 'text'; // json | text
const SAMPLE_RATE = typeof config.logging.sampleRate === 'number' ? config.logging.sampleRate : 1.0;

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

// File Logging Setup
let logStream = null;
let currentLogDate = null;
let currentLogSize = 0;
const MAX_LOG_SIZE = parseInt(process.env.LOG_MAX_SIZE, 10) || 10 * 1024 * 1024; // 10MB
let logRotations = 0;

function ensureLogDirectory() {
  if (config.logging.toFile) {
    if (!fs.existsSync(config.logging.directory)) {
      fs.mkdirSync(config.logging.directory, { recursive: true });
    }
  }
}

function rotateLogStream(forceSizeRotate = false) {
  if (!config.logging.toFile) return;

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  if (logStream) {
    if (!forceSizeRotate && currentLogDate === dateStr) {
      return; // Still valid
    }
    logStream.end();
    logStream = null;
  }

  ensureLogDirectory();
  currentLogDate = dateStr;
  
  if (forceSizeRotate) {
    logRotations++;
  } else {
    logRotations = 0;
  }

  const filename = logRotations > 0 
    ? `app-${dateStr}.${logRotations}.log`
    : `app-${dateStr}.log`;
  
  const filepath = path.join(config.logging.directory, filename);
  
  // Initialize size tracker
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    currentLogSize = stats.size;
  } else {
    currentLogSize = 0;
  }

  logStream = fs.createWriteStream(filepath, { flags: 'a' });
}

function writeToFile(output) {
  if (!config.logging.toFile) return;
  
  const msg = output + '\n';
  const size = Buffer.byteLength(msg, 'utf8');

  // Time-based rotation check
  const today = new Date().toISOString().split('T')[0];
  if (currentLogDate !== today) {
    rotateLogStream();
  } else if (currentLogSize + size > MAX_LOG_SIZE) {
    // Size-based rotation
    rotateLogStream(true);
  }

  if (!logStream) {
    rotateLogStream();
  }

  if (logStream) {
    logStream.write(msg);
    currentLogSize += size;
  }
}

function safeStringify(value) {
  try {
    const sanitized = sanitizeForLogging(value);
    return JSON.stringify(sanitized);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

/**
 * Get current request context (requestId, userId, etc.)
 */
function getContext() {
  if (!contextStorage) {
    return {};
  }
  return contextStorage.getStore() || {};
}

/**
 * Set request context for structured logging
 */
function setContext(context) {
  if (!contextStorage) {
    return;
  }
  const currentContext = contextStorage.getStore() || {};
  contextStorage.enterWith({ ...currentContext, ...context });
}

/**
 * Run a function with an isolated request context
 */
function runWithContext(context, callback) {
  if (!contextStorage) {
    return callback();
  }
  const currentContext = contextStorage.getStore() || {};
  return contextStorage.run({ ...currentContext, ...context }, callback);
}

/**
 * Build structured log entry with standard and custom fields
 */
function buildLogEntry(level, scope, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const context = getContext();

  // eslint-disable-next-line no-control-regex
  const sanitizedScope = typeof scope === 'string' ? scope.replace(/[\x00-\x1F\x7F]/g, '') : scope;
  // eslint-disable-next-line no-control-regex
  const sanitizedMessage = typeof message === 'string' ? message.replace(/[\x00-\x1F\x7F]/g, '') : message;

  return {
    timestamp,
    level,
    service: STANDARD_FIELDS.SERVICE_NAME,
    environment: STANDARD_FIELDS.ENVIRONMENT,
    version: STANDARD_FIELDS.VERSION,
    scope: sanitizedScope,
    message: sanitizedMessage,
    ...context,
    ...maskSensitiveData(meta)
  };
}

/**
 * Format log entry as structured JSON
 */
function formatJson(logEntry) {
  return safeStringify(logEntry);
}

/**
 * Format log entry for human-readable text output
 */
function formatText(logEntry) {
  const { timestamp, level, scope, message, requestId, transactionId, userId, ...metaData } = logEntry;

  const contextParts = [];
  if (requestId) contextParts.push(`reqId=${requestId.substring(0, 8)}`);
  if (transactionId) contextParts.push(`txId=${transactionId.substring(0, 8)}`);
  if (userId) contextParts.push(`userId=${userId}`);
  const contextStr = contextParts.length > 0 ? ` [${contextParts.join(' ')}]` : '';

  const base = `[${timestamp}] [${level}] [${scope}]${contextStr} ${message}`;

  const metaKeys = Object.keys(metaData).filter(key =>
    !['walletAddress', 'sessionId'].includes(key)
  );

  if (metaKeys.length === 0) {
    return base;
  }

  const meta = {};
  metaKeys.forEach(key => {
    meta[key] = metaData[key];
  });

  return `${base} ${safeStringify(meta)}`;
}

/**
 * Process and dispatch a log event globally
 */
function dispatchLog(levelsKey, scope, message, meta) {
  const targetLevelValue = LEVELS[levelsKey];
  if (targetLevelValue < CURRENT_LEVEL && !(levelsKey === 'DEBUG' && isDebugMode)) {
    return; // Filter out below current level
  }

  // Sampling for debug logs
  if (levelsKey === 'DEBUG' && SAMPLE_RATE < 1.0) {
    if (Math.random() > SAMPLE_RATE) {
      return; // Drop based on sample rate
    }
  }

  const logEntry = buildLogEntry(levelsKey, scope, message, meta);
  
  let formattedOutput;
  if (LOG_FORMAT.toLowerCase() === 'json') {
    formattedOutput = formatJson(logEntry);
  } else {
    formattedOutput = formatText(logEntry);
  }

  // Output conditionally to console
  if (levelsKey === 'ERROR') {
    console.error(formattedOutput);
  } else if (levelsKey === 'WARN') {
    console.warn(formattedOutput);
  } else {
    console.log(formattedOutput);
  }

  // File logging
  if (config.logging.toFile) {
    writeToFile(formattedOutput);
  }
}

/**
 * Log info level message
 */
function info(scope, message, meta) {
  dispatchLog('INFO', scope, message, meta);
}

/**
 * Log warning level message
 */
function warn(scope, message, meta) {
  dispatchLog('WARN', scope, message, meta);
}

/**
 * Log error level message
 */
function error(scope, message, meta) {
  dispatchLog('ERROR', scope, message, meta);
}

/**
 * Log debug level message
 */
function debug(scope, message, meta) {
  dispatchLog('DEBUG', scope, message, meta);
}

/**
 * Create a child logger with preset context
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
  runWithContext,
  isDebugMode,
  STANDARD_FIELDS,
  formatJson,
  formatText
};
