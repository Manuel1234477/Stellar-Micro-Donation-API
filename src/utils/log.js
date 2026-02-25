const { sanitizeForLogging } = require('./sanitizer');

const isDebugMode = process.env.DEBUG_MODE === 'true';

function safeStringify(value) {
  try {
    // Sanitize before stringifying to prevent log injection
    const sanitized = sanitizeForLogging(value);
    return JSON.stringify(sanitized);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function formatMessage(level, scope, message, meta) {
  const timestamp = new Date().toISOString();
  // Sanitize scope and message to prevent log injection
  // eslint-disable-next-line no-control-regex
  const sanitizedScope = typeof scope === 'string' ? scope.replace(/[\x00-\x1F\x7F]/g, '') : scope;
  // eslint-disable-next-line no-control-regex
  const sanitizedMessage = typeof message === 'string' ? message.replace(/[\x00-\x1F\x7F]/g, '') : message;
  const base = `[${timestamp}] [${level}] [${sanitizedScope}] ${sanitizedMessage}`;

  if (meta === undefined) {
    return base;
  }

  return `${base} ${safeStringify(meta)}`;
}

function info(scope, message, meta) {
  console.log(formatMessage('INFO', scope, message, meta));
}

function warn(scope, message, meta) {
  console.warn(formatMessage('WARN', scope, message, meta));
}

function error(scope, message, meta) {
  console.error(formatMessage('ERROR', scope, message, meta));
}

function debug(scope, message, meta) {
  if (isDebugMode) {
    console.log(formatMessage('DEBUG', scope, message, meta));
  }
}

module.exports = {
  info,
  warn,
  error,
  debug,
  isDebugMode,
};
