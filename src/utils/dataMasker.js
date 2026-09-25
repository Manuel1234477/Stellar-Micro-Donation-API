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
  'bearer',
  
  // Stellar-specific
  'sendersecret',
  'sender_secret',
  'sourcesecret',
  'source_secret',
  'destinationsecret',
  'destination_secret',
  'claimantsecret',
  'claimant_secret',
  'secretkey',
  'secret_key',
  'signingkey',
  'signing_key',
  'seedphrase',
  'seed_phrase',
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
  
  // Database & Connection
  'database_url',
  'databaseurl',
  'db_url',
  'connection_string',
  'connectionstring',
  'encryption_key',
  'cipher_key',
  'cipherkey',
  'authtag',
  'auth_tag',
  'initializationvector',
  'initialization_vector',

  // HSM (Hardware Security Module)
  'hsm_pin',
  'hsmpin',
  'hsm_slot_id',
  'hsmslotid',
  'hsm_slot',
  'hsmslot',

  // KMS (Key Management Service)
  'kms_key_id',
  'kmskeyid',
  'kms_key',
  'kmskey',
  'kms_provider',
  'kmsprovider',
  
  // Session & Cookies
  'sessionid',
  'session_id',
  'sessiontoken',
  'session_token',
  'cookie',
  'csrf',
  'xsrf',

  // HTTP headers
  'x-api-key',
  'x_api_key',
  'memo_text',
  'memo_hash',
  'memotext',
  'memohash',
];

/**
 * Stellar secret key: 56-char StrKey starting with S (base32 alphabet A-Z, 2-7).
 * Applied to all string values so secrets in memo/label/metadata fields are caught.
 */
const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;
const STELLAR_SECRET_REDACTED = '[STELLAR_SECRET_REDACTED]';

/**
 * Patterns for values that should be masked when the entire value matches (regex-based).
 * Targets actual secrets: hex strings of exactly 64 characters (encryption keys),
 * JWT tokens, bcrypt hashes, and Stellar secret keys.
 */
const VALUE_PATTERNS = [
  // Stellar secret keys (start with S, 56 chars) — public keys (G…) are not matched
  /^S[A-Z2-7]{55}$/,
  // Hex strings of exactly 64 characters (256-bit encryption / private keys)
  /^[0-9a-fA-F]{64}$/,
  // Bcrypt password hashes
  /^\$2[aby]?\$\d{1,2}\$[./A-Za-z0-9]{53}$/,
  // JWT tokens (three base64 segments separated by dots)
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];

/**
 * Check if a string is a Stellar public key (56 characters, starts with G).
 * Stellar public keys must NEVER be masked.
 * @param {*} value
 * @returns {boolean}
 */
function isStellarPublicKey(value) {
  return typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value.trim());
}

/**
 * Check if a value represents a legitimate numeric or XLM amount.
 * Amounts must NEVER be masked.
 * @param {*} value
 * @returns {boolean}
 */
function isXlmAmount(value) {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d+(\.\d+)?(\s*XLM)?$/i.test(trimmed) && !isNaN(parseFloat(trimmed));
  }
  return false;
}

/**
 * Mask Stellar secret key substrings inside any string (issue #938).
 * @param {string} str
 * @returns {string}
 */
function maskStellarSecretsInString(str) {
  if (typeof str !== 'string' || str.length === 0) {
    return str;
  }
  return str.replace(STELLAR_SECRET_PATTERN, STELLAR_SECRET_REDACTED);
}

/**
 * Check if a key name indicates sensitive data.
 * Uses exact matching (after normalising separators to lower-case) rather than
 * substring matching to avoid masking innocent fields like receiverId (which
 * contains the substring "iv") or authorName (which contains "auth").
 *
 * @param {string} key - The key name to check
 * @returns {boolean} True if the key is sensitive
 */
function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;

  const lowerKey = key.toLowerCase().replace(/[-_\s]/g, '');

  return getNormalizedSensitiveKeys().has(lowerKey);
}

// Normalised SENSITIVE_PATTERNS cached as a Set so isSensitiveKey (hot path:
// every logged key) is O(1). Rebuilt when the pattern list grows.
let normalizedSensitiveKeys = null;
let normalizedSensitiveKeysSize = -1;

function getNormalizedSensitiveKeys() {
  if (normalizedSensitiveKeysSize !== SENSITIVE_PATTERNS.length) {
    normalizedSensitiveKeys = new Set(
      SENSITIVE_PATTERNS.map(pattern => pattern.toLowerCase().replace(/[-_\s]/g, ''))
    );
    normalizedSensitiveKeysSize = SENSITIVE_PATTERNS.length;
  }
  return normalizedSensitiveKeys;
}

/**
 * Check if a value looks like sensitive data.
 * Stellar public keys and XLM amounts are never flagged as sensitive values.
 * @param {*} value - The value to check
 * @returns {boolean} True if the value appears sensitive
 */
function isSensitiveValue(value) {
  if (typeof value !== 'string') return false;
  if (isStellarPublicKey(value)) return false;
  if (isXlmAmount(value)) return false;
  return VALUE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Mask a string after name-based rules: full-value secrets vs embedded patterns.
 * @param {string} value
 * @param {Object} options
 * @returns {string}
 */
function maskStringValue(value, options = {}) {
  const { showPartial = false } = options;

  if (isSensitiveValue(value) && /^S[A-Z2-7]{55}$/.test(value)) {
    if (showPartial) {
      return maskValue(value, { showFirst: 4, showLast: 4 });
    }
    return STELLAR_SECRET_REDACTED;
  }

  if (isSensitiveValue(value)) {
    return maskValue(value, showPartial ? { showFirst: 4, showLast: 4 } : {});
  }

  return maskStellarSecretsInString(value);
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
    const maskedLength = Math.max(4, strValue.length - showFirst - showLast);
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
    if (typeof data === 'string') {
      return maskStringValue(data, { showPartial });
    }
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
      masked[key] = maskSensitiveData(value, { ...options, currentDepth: currentDepth + 1 });
    } else if (typeof value === 'string') {
      masked[key] = maskStringValue(value, { showPartial });
    } else if (isSensitiveValue(value)) {
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
    masked.stack = error.stack.split('\n').map(line => {
      // Replace Stellar secret keys in stack trace lines
      return line.replace(STELLAR_SECRET_PATTERN, STELLAR_SECRET_REDACTED);
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
 * Add custom sensitive key patterns
 * @param {string[]|string} patterns - Array of key names or single key name to add
 */
function addSensitivePatterns(patterns) {
  if (Array.isArray(patterns)) {
    SENSITIVE_PATTERNS.push(...patterns);
  } else if (typeof patterns === 'string') {
    SENSITIVE_PATTERNS.push(patterns);
  }
}

/**
 * Add custom value patterns (regex or string)
 * @param {RegExp|string|Array<RegExp|string>} patterns
 */
function addValuePatterns(patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const p of list) {
    if (p instanceof RegExp) {
      VALUE_PATTERNS.push(p);
    } else if (typeof p === 'string') {
      VALUE_PATTERNS.push(new RegExp(p));
    }
  }
}

/**
 * Expose configuration API for operators to add custom sensitive key or value patterns.
 * @param {Object} config
 * @param {string[]} [config.keyPatterns] - Additional field names to treat as sensitive
 * @param {Array<RegExp|string>} [config.valuePatterns] - Additional regex patterns for sensitive values
 */
function configureMasker(config = {}) {
  if (config.keyPatterns) {
    addSensitivePatterns(config.keyPatterns);
  }
  if (config.valuePatterns) {
    addValuePatterns(config.valuePatterns);
  }
}

module.exports = {
  maskSensitiveData,
  maskError,
  maskValue,
  maskStellarSecretsInString,
  isSensitiveKey,
  isSensitiveValue,
  isStellarPublicKey,
  isXlmAmount,
  addSensitivePatterns,
  addValuePatterns,
  configureMasker,
  SENSITIVE_PATTERNS,
  VALUE_PATTERNS,
  STELLAR_SECRET_PATTERN,
  STELLAR_SECRET_REDACTED,
};
