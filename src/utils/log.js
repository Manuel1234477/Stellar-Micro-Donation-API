function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function formatMessage(level, scope, message, meta) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level}] [${scope}] ${message}`;

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

module.exports = {
  info,
  warn,
  error,
};
