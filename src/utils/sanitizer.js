/**
 * Sanitizer Utility - Input Sanitization Layer
 * 
 * RESPONSIBILITY: Comprehensive input sanitization to prevent injection attacks and data corruption
 * OWNER: Security Team
 * DEPENDENCIES: None (foundational utility)
 * 
 * Sanitizes user-provided metadata to prevent log injection, SQL injection, XSS attacks,
 * and removes control characters. Implements defense-in-depth with:
 * - HTML tag stripping for plain-text fields (memo, label, name, description)
 * - HTML allowlist sanitization for markup fields (campaign descriptions)
 * - HTML entity encoding to prevent XSS
 * - Unicode normalization (NFC) to prevent homograph attacks
 * - Control character and null byte removal
 * - SQL injection prevention (defense in depth with parameterized queries)
 * - Log injection prevention
 */

'use strict';

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
 */
const HTML_ENTITY_REGEX = /[&<>"'/]/g;

/** Default allowlist of HTML tags for rich-text fields (e.g. campaign description) */
const DEFAULT_ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'];

/**
 * Encodes HTML entities to prevent XSS attacks
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
 * @param {string} str - String to normalize
 * @returns {string} Unicode NFC normalized string
 */
function normalizeUnicode(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  try {
    return str.normalize('NFC');
  } catch (e) {
    return str;
  }
}

/**
 * Removes script tags, iframe tags, and dangerous event handlers
 * @param {string} str - String to sanitize
 * @returns {string} String with script tags and handlers removed
 */
function removeScriptTagsAndHandlers(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  // Remove script tags and their content (case-insensitive)
  // eslint-disable-next-line security/detect-unsafe-regex
  let sanitized = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove iframe tags and their content
  // eslint-disable-next-line security/detect-unsafe-regex
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // Remove style tags and their content
  // eslint-disable-next-line security/detect-unsafe-regex
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove event handlers (onclick, onload, onerror, onchange, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:[^"'\s>]*/gi, '');
  
  return sanitized;
}

/**
 * Strips all HTML tags completely from plain-text input strings
 * @param {string} str - String to strip HTML from
 * @returns {string} Plain-text string with all tags removed
 */
function stripHtmlTags(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  let cleaned = removeScriptTagsAndHandlers(str);
  // Remove any remaining HTML tags
  cleaned = cleaned.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  return cleaned;
}

/**
 * Sanitizes markup fields (e.g. campaign description) using an allowlist of safe HTML tags.
 * Disallowed tags are stripped, script tags/event handlers are removed, and javascript: URIs are dropped.
 *
 * @param {string} str - String with markup
 * @param {string[]} [allowedTags=DEFAULT_ALLOWED_TAGS] - Allowlist of permitted tag names
 * @returns {string} Sanitized markup string
 */
function sanitizeMarkup(str, allowedTags = DEFAULT_ALLOWED_TAGS) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  let sanitized = normalizeUnicode(str);
  sanitized = removeNullBytes(sanitized);
  sanitized = removeAnsiSequences(sanitized);
  sanitized = removeScriptTagsAndHandlers(sanitized);

  // Match all HTML tags
  const tagRegex = /<\/?([a-zA-Z0-9]+)([^>]*)>/g;
  sanitized = sanitized.replace(tagRegex, (match, tagName, attributes) => {
    const lowerTag = tagName.toLowerCase();
    if (!allowedTags.includes(lowerTag)) {
      return ''; // Strip disallowed tag entirely
    }

    // If tag is allowed, sanitize attributes (allow safe href for <a>, strip event handlers and javascript:)
    if (match.startsWith('</')) {
      return `</${lowerTag}>`;
    }

    if (lowerTag === 'a') {
      const hrefMatch = attributes.match(/href\s*=\s*["']([^"']*)["']/i);
      if (hrefMatch) {
        const href = hrefMatch[1].trim();
        if (/^(https?:\/\/|mailto:|\/)/i.test(href)) {
          return `<a href="${encodeHtmlEntities(href)}" rel="noopener noreferrer">`;
        }
      }
      return '<a>';
    }

    return `<${lowerTag}>`;
  });

  return sanitized.trim();
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
    // Keep newlines (0x0A) and carriage returns (0x0D) but remove other control characters
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
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
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '');
}

/**
 * Sanitize general text input - comprehensive sanitization with multiple layers
 * 
 * @param {string} input - The input to sanitize
 * @param {Object} options - Sanitization options
 * @param {number} options.maxLength - Maximum allowed length (default: 255)
 * @param {boolean} options.allowNewlines - Whether to allow newline characters (default: false)
 * @param {boolean} options.allowSpecialChars - Whether to allow special characters (default: true)
 * @param {boolean} options.encodeHtml - Whether to HTML encode for display (default: true)
 * @param {boolean} options.stripTags - Whether to strip HTML tags before encoding (default: false)
 * @returns {string} Sanitized string
 */
function sanitizeText(input, options = {}) {
  const {
    maxLength = 255,
    allowNewlines = false,
    allowSpecialChars = true,
    encodeHtml = true,
    stripTags = false,
  } = options;

  if (input === null || input === undefined || typeof input !== 'string') {
    return '';
  }

  let sanitized = input.trim();
  sanitized = normalizeUnicode(sanitized);
  sanitized = removeAnsiSequences(sanitized);
  sanitized = removeNullBytes(sanitized);
  sanitized = removeControlCharacters(sanitized, allowNewlines);
  sanitized = removeScriptTagsAndHandlers(sanitized);

  if (stripTags) {
    sanitized = stripHtmlTags(sanitized);
  }

  if (!allowSpecialChars) {
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-_.@]/g, '');
  }

  if (encodeHtml && allowSpecialChars && !stripTags) {
    sanitized = encodeHtmlEntities(sanitized);
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize memo field for Stellar transactions (plain-text, strips HTML, max 28 bytes)
 * @param {string} memo - The memo to sanitize
 * @returns {string} Sanitized memo
 */
function sanitizeMemo(memo) {
  if (!memo || typeof memo !== 'string') return '';
  let cleaned = stripHtmlTags(memo);
  cleaned = removeControlCharacters(cleaned, false);
  cleaned = removeNullBytes(cleaned);
  cleaned = removeAnsiSequences(cleaned);
  cleaned = cleaned.trim();
  return cleaned.substring(0, 28);
}

/**
 * Sanitize wallet label (plain-text, strips HTML, max 100 chars)
 * @param {string} label - The label to sanitize
 * @returns {string} Sanitized label
 */
function sanitizeLabel(label) {
  if (!label || typeof label !== 'string') return '';
  let cleaned = stripHtmlTags(label);
  cleaned = removeControlCharacters(cleaned, false);
  cleaned = removeNullBytes(cleaned);
  cleaned = removeAnsiSequences(cleaned);
  cleaned = cleaned.trim();
  return cleaned.substring(0, 100);
}

/**
 * Sanitize owner name (plain-text, strips HTML, max 100 chars)
 * @param {string} name - The name to sanitize
 * @returns {string} Sanitized name
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return '';
  let cleaned = stripHtmlTags(name);
  cleaned = removeControlCharacters(cleaned, false);
  cleaned = removeNullBytes(cleaned);
  cleaned = removeAnsiSequences(cleaned);
  cleaned = cleaned.trim();
  return cleaned.substring(0, 100);
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
    allowSpecialChars: false
  }).replace(/@/g, '');
}

/**
 * Sanitize campaign description or general description fields.
 * If allowMarkup is true, uses allowlist-based sanitizer; otherwise strips HTML tags.
 *
 * @param {string} description - The description to sanitize
 * @param {Object} [options]
 * @param {boolean} [options.allowMarkup=false] - Whether to allow safe HTML markup
 * @param {number} [options.maxLength=5000] - Max character length
 * @returns {string} Sanitized description
 */
function sanitizeDescription(description, options = {}) {
  const { allowMarkup = false, maxLength = 5000 } = options;
  if (!description || typeof description !== 'string') return '';

  let sanitized;
  if (allowMarkup) {
    sanitized = sanitizeMarkup(description);
  } else {
    sanitized = stripHtmlTags(description);
    sanitized = removeControlCharacters(sanitized, true); // allow newlines for multi-line description
    sanitized = removeNullBytes(sanitized);
    sanitized = removeAnsiSequences(sanitized);
    sanitized = sanitized.trim();
  }

  return sanitized.length > maxLength ? sanitized.substring(0, maxLength) : sanitized;
}

/**
 * Sanitize Stellar address
 * @param {string} address - Stellar address to sanitize
 * @returns {string} Sanitized address
 */
function sanitizeStellarAddress(address) {
  if (!address || typeof address !== 'string') {
    return '';
  }

  let sanitized = address.trim();
  sanitized = removeNullBytes(sanitized);
  sanitized = removeScriptTagsAndHandlers(sanitized);
  sanitized = removeControlCharacters(sanitized, false);
  sanitized = removeAnsiSequences(sanitized);

  const STELLAR_ADDRESS_MAX_LENGTH = 56;
  if (sanitized.length > STELLAR_ADDRESS_MAX_LENGTH) {
    sanitized = sanitized.substring(0, STELLAR_ADDRESS_MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Sanitize for logging
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
      case 'description':
        sanitized[key] = sanitizeDescription(value, config.options || {});
        break;
      case 'markup':
        sanitized[key] = sanitizeMarkup(value, config.allowedTags);
        break;
      case 'number':
        sanitized[key] = value;
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
  sanitizeDescription,
  sanitizeMarkup,
  sanitizeStellarAddress,
  sanitizeForLogging,
  sanitizeRequestBody,
  
  // Helper functions for specialized sanitization
  encodeHtmlEntities,
  normalizeUnicode,
  removeScriptTagsAndHandlers,
  stripHtmlTags,
  removeNullBytes,
  removeControlCharacters,
  removeAnsiSequences,
  DEFAULT_ALLOWED_TAGS,
};
