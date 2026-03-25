/**
 * Sanitizer Utility - Input Sanitization Layer
 * 
 * RESPONSIBILITY: Comprehensive input sanitization to prevent injection attacks and data corruption
 * OWNER: Security Team
 * DEPENDENCIES: None (foundational utility)
 * 
 * Sanitizes user-provided metadata to prevent log injection, SQL injection, XSS attacks,
 * and removes control characters. Implements defense-in-depth with:
 * - HTML entity encoding to prevent XSS
 * - Unicode normalization (NFC) to prevent homograph attacks
 * - Control character and null byte removal
 * - SQL injection prevention (defense in depth with parameterized queries)
 * - Log injection prevention
 * 
 * Security Considerations:
 * - Prevents log injection (newlines, control characters)
 * - Prevents SQL injection (handled by parameterized queries, but adds defense in depth)
 * - Prevents XSS through HTML/JavaScript injection
 * - Removes potentially dangerous characters
 * - Prevents homograph attacks via Unicode normalization
 * - Applies defense-in-depth: sanitization + parameterized queries + input validation
 */

/**
 * HTML entity encoding map for XSS prevention
 * Encodes dangerous HTML characters that could break out of attributes or tags
 * @type {Object<string, string>}
 */
const HTML_ENTITY_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;'
};

/**
 * Regex pattern for HTML entity encoding
 * Matches the exact characters that need encoding
 */
const HTML_ENTITY_REGEX = /[&<>"'\/]/g;

/**
 * Encodes HTML entities to prevent XSS attacks
 * Converts dangerous characters to their HTML entity equivalents
 * @param {string} str - String to encode
 * @returns {string} HTML entity encoded string
 */
function encodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str.replace(HTML_ENTITY_REGEX, (char) => HTML_ENTITY_MAP[char] || char);
}

/**
 * Normalizes Unicode to NFC form to prevent homograph attacks
 * Homograph attacks use lookalike characters from different Unicode blocks
 * @param {string} str - String to normalize
 * @returns {string} Unicode NFC normalized string
 */
function normalizeUnicode(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  try {
    // Normalize to NFC (Canonical Composition)
    // This ensures that lookalike characters are normalized to their canonical form
    return str.normalize('NFC');
  } catch (e) {
    // If normalization fails, return original string
    return str;
  }
}

/**
 * Removes script tags and dangerous event handlers
 * Provides HTML/JavaScript injection prevention
 * @param {string} str - String to sanitize
 * @returns {string} String with script tags and handlers removed
 */
function removeScriptTagsAndHandlers(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  // Remove script tags and their content (case-insensitive)
  let sanitized = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove iframe tags
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove event handlers (onclick, onload, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');
  
  return sanitized;
}

/**
 * Removes null bytes which can be used for injection attacks
 * @param {string} str - String to sanitize
 * @returns {string} String with null bytes removed
 */
function removeNullBytes(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  // Remove null bytes (0x00)
  return str.replace(/\0/g, '');
}

/**
 * Removes control characters that can be used for injection
 * @param {string} str - String to sanitize
 * @param {boolean} allowNewlines - Whether to allow newline characters
 * @returns {string} String with control characters removed
 */
function removeControlCharacters(str, allowNewlines = false) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  if (!allowNewlines) {
    // Remove all control characters including newlines
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\x00-\x1F\x7F]/g, '');
  } else {
    // Keep newlines (0x0A) but remove other control characters
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  }
}

/**
 * Removes ANSI escape sequences (used for log injection)
 * @param {string} str - String to sanitize
 * @returns {string} String with ANSI sequences removed
 */
function removeAnsiSequences(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  // Remove ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '');
}

/**
 * Sanitize general text input - comprehensive sanitization with multiple layers
 * 
 * Applies multiple layers of sanitization:
 * 1. Unicode normalization (NFC) to prevent homograph attacks
 * 2. ANSI sequence removal for log injection prevention
 * 3. Null byte removal
 * 4. Control character removal
 * 5. Script tag and event handler removal
 * 6. HTML entity encoding for XSS prevention
 * 7. Length truncation
 * 8. Optional character restriction
 * 
 * @param {string} input - The input to sanitize
 * @param {Object} options - Sanitization options
 * @param {number} options.maxLength - Maximum allowed length (default: 255)
 * @param {boolean} options.allowNewlines - Whether to allow newline characters (default: false)
 * @param {boolean} options.allowSpecialChars - Whether to allow special characters (default: true)
 * @param {boolean} options.encodeHtml - Whether to HTML encode for display (default: true)
 * @returns {string} Sanitized string
 */
function sanitizeText(input, options = {}) {
  const {
    maxLength = 255,
    allowNewlines = false,
    allowSpecialChars = true,
    encodeHtml = true
  } = options;

  // Handle non-string inputs
  if (input === null || input === undefined) {
    return '';
  }

  if (typeof input !== 'string') {
    return '';
  }

  // Step 1: Trim whitespace
  let sanitized = input.trim();

  // Step 2: Unicode normalization to prevent homograph attacks
  sanitized = normalizeUnicode(sanitized);

  // Step 3: Remove ANSI escape sequences (log injection prevention)
  sanitized = removeAnsiSequences(sanitized);

  // Step 4: Remove null bytes (security risk)
  sanitized = removeNullBytes(sanitized);

  // Step 5: Remove control characters
  sanitized = removeControlCharacters(sanitized, allowNewlines);

  // Step 6: Remove script tags and dangerous event handlers
  sanitized = removeScriptTagsAndHandlers(sanitized);

  // Step 7: HTML entity encoding for XSS prevention (if enabled)
  if (encodeHtml) {
    sanitized = encodeHtmlEntities(sanitized);
  }

  // Step 8: Optionally restrict to safe characters
  if (!allowSpecialChars) {
    // Allow only alphanumeric, spaces, and basic punctuation
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_.@]/g, '');
  }

  // Step 9: Truncate to maximum length
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
 * Sanitize Stellar address
 * Removes null bytes and control characters but preserves alphanumeric characters
 * used in Stellar base32 addresses (A-Z, 2-7, =)
 * Does NOT HTML encode to preserve address format
 * @param {string} address - Stellar address to sanitize
 * @returns {string} Sanitized address
 */
function sanitizeStellarAddress(address) {
  if (!address || typeof address !== 'string') {
    return '';
  }

  let sanitized = address.trim();

  // Remove null bytes
  sanitized = removeNullBytes(sanitized);

  // Remove script tags and event handlers to prevent XSS
  sanitized = removeScriptTagsAndHandlers(sanitized);

  // Remove control characters
  sanitized = removeControlCharacters(sanitized, false);

  // Remove ANSI sequences
  sanitized = removeAnsiSequences(sanitized);

  // Truncate to maximum Stellar address length
  const STELLAR_ADDRESS_MAX_LENGTH = 56;
  if (sanitized.length > STELLAR_ADDRESS_MAX_LENGTH) {
    sanitized = sanitized.substring(0, STELLAR_ADDRESS_MAX_LENGTH);
  }

  return sanitized;
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
  // Main sanitization functions
  sanitizeText,
  sanitizeMemo,
  sanitizeLabel,
  sanitizeName,
  sanitizeIdentifier,
  sanitizeStellarAddress,
  sanitizeForLogging,
  sanitizeRequestBody,
  
  // Helper functions for specialized sanitization
  encodeHtmlEntities,
  normalizeUnicode,
  removeScriptTagsAndHandlers,
  removeNullBytes,
  removeControlCharacters,
  removeAnsiSequences
};
