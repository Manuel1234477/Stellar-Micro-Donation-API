/**
 * Input Sanitization Utility
 * Sanitizes user-provided metadata to prevent injection attacks and logging issues
 * 
 * Security Considerations:
 * - Prevents log injection (newlines, control characters)
 * - Prevents SQL injection (handled by parameterized queries, but adds defense in depth)
 * - Prevents XSS if data is displayed in web interfaces
 * - Removes potentially dangerous characters
 */

/**
 * Sanitize general text input
 * Removes control characters, null bytes, and trims whitespace
 * @param {string} input - The input to sanitize
 * @param {Object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeText(input, options = {}) {
  const {
    maxLength = 255,
    allowNewlines = false,
    allowSpecialChars = true
  } = options;

  // Handle non-string inputs
  if (input === null || input === undefined) {
    return '';
  }

  if (typeof input !== 'string') {
    return '';
  }

  // Trim whitespace
  let sanitized = input.trim();

  // Remove ANSI escape sequences early so control-char stripping
  // cannot leave fragments like "[31m" behind.
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '');

  // Remove null bytes (security risk)
  sanitized = sanitized.replace(/\0/g, '');

  // Remove or replace control characters
  if (!allowNewlines) {
    // Remove all control characters including newlines
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  } else {
    // Keep newlines but remove other control characters
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  }

  // Optionally restrict to safe characters
  if (!allowSpecialChars) {
    // Allow only alphanumeric, spaces, and basic punctuation.
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_.@]/g, '');
  }

  // Truncate to maximum length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize memo field for Stellar transactions
 * @param {string} memo - The memo to sanitize
 * @returns {string} Sanitized memo
 */
function sanitizeMemo(memo) {
  return sanitizeText(memo, {
    maxLength: 28, // Stellar MEMO_TEXT limit
    allowNewlines: false,
    allowSpecialChars: true
  });
}

/**
 * Sanitize wallet label
 * @param {string} label - The label to sanitize
 * @returns {string} Sanitized label
 */
function sanitizeLabel(label) {
  return sanitizeText(label, {
    maxLength: 100,
    allowNewlines: false,
    allowSpecialChars: true
  });
}

/**
 * Sanitize owner name
 * @param {string} name - The name to sanitize
 * @returns {string} Sanitized name
 */
function sanitizeName(name) {
  return sanitizeText(name, {
    maxLength: 100,
    allowNewlines: false,
    allowSpecialChars: true
  });
}

/**
 * Sanitize identifier (donor/recipient)
 * @param {string} identifier - The identifier to sanitize
 * @returns {string} Sanitized identifier
 */
function sanitizeIdentifier(identifier) {
  return sanitizeText(identifier, {
    maxLength: 100,
    allowNewlines: false,
    allowSpecialChars: false // Strict for identifiers
  }).replace(/@/g, '');
}

/**
 * Sanitize for logging
 * Ensures data is safe to log without breaking log parsers
 * @param {any} data - The data to sanitize for logging
 * @returns {any} Sanitized data
 */
function sanitizeForLogging(data) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeText(data, {
      maxLength: 1000,
      allowNewlines: false,
      allowSpecialChars: true
    });
  }

  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      return data.map(item => sanitizeForLogging(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      // Sanitize both keys and values
      const sanitizedKey = sanitizeText(key, {
        maxLength: 100,
        allowNewlines: false,
        allowSpecialChars: false
      });
      sanitized[sanitizedKey] = sanitizeForLogging(value);
    }
    return sanitized;
  }

  return data;
}

/**
 * Validate and sanitize all user inputs in a request body
 * @param {Object} body - Request body
 * @param {Object} fieldConfig - Configuration for each field
 * @returns {Object} Sanitized body
 */
function sanitizeRequestBody(body, fieldConfig = {}) {
  const sanitized = {};

  for (const [key, value] of Object.entries(body)) {
    const config = fieldConfig[key] || {};
    const type = config.type || 'text';

    switch (type) {
      case 'memo':
        sanitized[key] = sanitizeMemo(value);
        break;
      case 'label':
        sanitized[key] = sanitizeLabel(value);
        break;
      case 'name':
        sanitized[key] = sanitizeName(value);
        break;
      case 'identifier':
        sanitized[key] = sanitizeIdentifier(value);
        break;
      case 'number':
        sanitized[key] = value; // Numbers don't need text sanitization
        break;
      case 'text':
      default:
        sanitized[key] = sanitizeText(value, config.options || {});
        break;
    }
  }

  return sanitized;
}

module.exports = {
  sanitizeText,
  sanitizeMemo,
  sanitizeLabel,
  sanitizeName,
  sanitizeIdentifier,
  sanitizeForLogging,
  sanitizeRequestBody
};
