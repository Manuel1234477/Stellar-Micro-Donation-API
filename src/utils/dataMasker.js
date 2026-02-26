/**
 * Data Masker Utility - Security Layer
 * 
 * RESPONSIBILITY: Automatic masking of sensitive data in logs and error messages
 * OWNER: Security Team
 * DEPENDENCIES: None (foundational utility)
 * 
 * Prevents exposure of secrets, API keys, passwords, and private values in logs.
 * Applies pattern-based detection and masking for comprehensive data protection.
 */

/**
 * List of sensitive field patterns to mask
 * Supports both exact matches and partial matches (case-insensitive)
 */
const SENSITIVE_PATTERNS = [
  // Authentication & Authorization
  'password',
  'passwd',
  'pwd',
  'secret',
  'secretkey',
  'secret_key',
  'private',
  'privatekey',
  'private_key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'auth',
  'bearer',
  
  // Stellar-specific
  'sendersecret',
  'sender_secret',
  'sourcesecret',
  'source_secret',
  'destinationsecret',
  'destination_secret',
  'seed',
  'mnemonic',
  
  // Financial & PII
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'ssn',
  'social_security',
  'socialsecurity',
  'taxid',
  'tax_id',
  
  // Encryption
  'encryptionkey',
  'encryption_key',
  'cipher',
  'iv',
  'authtag',
  'auth_tag',
  
  // Session & Cookies
  'session',
  'sessionid',
  'session_id',
  'cookie',
  'csrf',
  'xsrf',
];

/**
 * Patterns for values that should be masked (regex-based)
 */
const VALUE_PATTERNS = [
  // Stellar secret keys (start with S, 56 chars)
  /S[A-Z2-7]{55}/g,
  // JWT tokens (three base64 segments separated by dots)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // API keys (common formats)
  /[a-zA-Z0-9]{32,}/g, // Long alphanumeric strings (potential API keys)
];

/**
 * Check if a key name indicates sensitive data
 * @param {string} key - The key name to check
 * @returns {boolean} True if the key is sensitive
 */
function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  
  const lowerKey = key.toLowerCase().replace(/[-_\s]/g, '');
  
  return SENSITIVE_PATTERNS.some(pattern => {
    const normalizedPattern = pattern.toLowerCase().replace(/[-_\s]/g, '');
    return lowerKey.includes(normalizedPattern);
  });
}

/**
 * Check if a value looks like sensitive data
 * @param {*} value - The value to check
 * @returns {boolean} True if the value appears sensitive
 */
function isSensitiveValue(value) {
  if (typeof value !== 'string') return false;
  
  // Check against value patterns
  return VALUE_PATTERNS.some(pattern => {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

/**
 * Mask a sensitive value
 * @param {*} value - The value to mask
 * @param {Object} options - Masking options
 * @returns {string} Masked value
 */
function maskValue(value, options = {}) {
  const {
    maskChar = '*',
    showFirst = 0,
    showLast = 0,
    minLength = 8,
  } = options;
  
  if (value === null || value === undefined) {
    return '[REDACTED]';
  }
  
  const strValue = String(value);
  
  // For very short values, just redact completely
  if (strValue.length < minLength) {
    return '[REDACTED]';
  }
  
  // Show partial value for debugging purposes
  if (showFirst > 0 || showLast > 0) {
    const first = strValue.substring(0, showFirst);
    const last = strValue.substring(strValue.length - showLast);
    const maskedLength = Math.max(8, strValue.length - showFirst - showLast);
    const masked = maskChar.repeat(maskedLength);
    return `${first}${masked}${last}`;
  }
  
  return '[REDACTED]';
}

/**
 * Mask sensitive data in an object recursively
 * @param {*} data - Data to mask (object, array, or primitive)
 * @param {Object} options - Masking options
 * @returns {*} Masked data
 */
function maskSensitiveData(data, options = {}) {
  const {
    maxDepth = 10,
    currentDepth = 0,
    showPartial = false, // Show first/last chars for debugging
  } = options;
  
  // Prevent infinite recursion
  if (currentDepth >= maxDepth) {
    return '[MAX_DEPTH_REACHED]';
  }
  
  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }
  
  // Handle primitives
  if (typeof data !== 'object') {
    // Check if the value itself looks sensitive
    if (isSensitiveValue(data)) {
      return maskValue(data, showPartial ? { showFirst: 4, showLast: 4 } : {});
    }
    return data;
  }
  
  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => 
      maskSensitiveData(item, { ...options, currentDepth: currentDepth + 1 })
    );
  }
  
  // Handle objects
  const masked = {};
  
  for (const [key, value] of Object.entries(data)) {
    // Check if key indicates sensitive data
    if (isSensitiveKey(key)) {
      masked[key] = maskValue(value, showPartial ? { showFirst: 4, showLast: 4 } : {});
    } else if (typeof value === 'object' && value !== null) {
      // Recursively mask nested objects
      masked[key] = maskSensitiveData(value, { ...options, currentDepth: currentDepth + 1 });
    } else if (isSensitiveValue(value)) {
      // Check if value looks sensitive even if key doesn't
      masked[key] = maskValue(value, showPartial ? { showFirst: 4, showLast: 4 } : {});
    } else {
      masked[key] = value;
    }
  }
  
  return masked;
}

/**
 * Mask sensitive data in error objects
 * @param {Error} error - Error object to mask
 * @returns {Object} Masked error object
 */
function maskError(error) {
  if (!error) return error;
  
  const masked = {
    name: error.name,
    message: error.message,
    code: error.code,
  };
  
  // Mask stack trace to remove potential sensitive data in file paths or values
  if (error.stack) {
    // Keep stack trace but mask any potential secrets in it
    masked.stack = error.stack.split('\n').map(line => {
      let maskedLine = line;
      VALUE_PATTERNS.forEach(pattern => {
        pattern.lastIndex = 0;
        maskedLine = maskedLine.replace(pattern, '[REDACTED]');
      });
      return maskedLine;
    }).join('\n');
  }
  
  // Mask any additional properties
  const additionalProps = Object.keys(error).filter(
    key => !['name', 'message', 'code', 'stack'].includes(key)
  );
  
  additionalProps.forEach(key => {
    masked[key] = maskSensitiveData(error[key]);
  });
  
  return masked;
}

/**
 * Add custom sensitive patterns
 * @param {string[]} patterns - Array of patterns to add
 */
function addSensitivePatterns(patterns) {
  if (Array.isArray(patterns)) {
    SENSITIVE_PATTERNS.push(...patterns);
  }
}

module.exports = {
  maskSensitiveData,
  maskError,
  maskValue,
  isSensitiveKey,
  isSensitiveValue,
  addSensitivePatterns,
  SENSITIVE_PATTERNS,
};
