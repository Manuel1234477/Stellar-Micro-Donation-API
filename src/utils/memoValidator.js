/**
 * Memo Validator
 * Validates and sanitizes transaction memos according to Stellar specifications
 *
 * Stellar Memo Types:
 * - MEMO_TEXT: Up to 28 bytes of UTF-8 text
 * - MEMO_ID: 64-bit unsigned integer (0 to 2^64-1, stored as string)
 * - MEMO_HASH: 32-byte hash (64 hex chars or 32-byte Buffer/base64)
 * - MEMO_RETURN: 32-byte hash for return payments (same format as MEMO_HASH)
 *
 * This implementation supports all four Stellar memo types.
 */

const { sanitizeMemo } = require('./sanitizer');

const MAX_MEMO_LENGTH = 28; // Stellar MEMO_TEXT limit in bytes

/** Valid memo type values */
const MEMO_TYPES = Object.freeze(['text', 'hash', 'id', 'return']);

/** Max 64-bit unsigned integer */
const MAX_UINT64 = BigInt('18446744073709551615');

class MemoValidator {
  /**
   * Validate a memo value for a given Stellar memo type.
   *
   * @param {string} memo - The memo value to validate
   * @param {string} [memoType='text'] - One of: 'text', 'hash', 'id', 'return'
   * @returns {{ valid: boolean, sanitized?: string, error?: string, code?: string }}
   */
  static validateWithType(memo, memoType = 'text') {
    if (!MEMO_TYPES.includes(memoType)) {
      return {
        valid: false,
        error: `Invalid memo type '${memoType}'. Must be one of: ${MEMO_TYPES.join(', ')}`,
        code: 'INVALID_MEMO_TYPE',
      };
    }

    // Empty memo is always valid (means no memo)
    if (memo === undefined || memo === null || memo === '') {
      return { valid: true, sanitized: '' };
    }

    switch (memoType) {
      case 'text':
        return this.validate(memo);

      case 'id':
        return this._validateId(memo);

      case 'hash':
      case 'return':
        return this._validateHash(memo, memoType);

      default:
        return { valid: false, error: 'Unknown memo type', code: 'INVALID_MEMO_TYPE' };
    }
  }

  /**
   * Validate a MEMO_ID value.
   * Must be a non-negative integer representable as a 64-bit unsigned integer.
   * @private
   * @param {string|number} value
   * @returns {{ valid: boolean, sanitized?: string, error?: string, code?: string }}
   */
  static _validateId(value) {
    const str = String(value).trim();

    if (!/^\d+$/.test(str)) {
      return {
        valid: false,
        error: 'ID memo must be a non-negative integer',
        code: 'INVALID_MEMO_ID',
      };
    }

    try {
      const bigVal = BigInt(str);
      if (bigVal < BigInt(0) || bigVal > MAX_UINT64) {
        return {
          valid: false,
          error: 'ID memo must be a valid 64-bit unsigned integer (0 to 18446744073709551615)',
          code: 'INVALID_MEMO_ID',
        };
      }
    } catch {
      return { valid: false, error: 'ID memo is not a valid integer', code: 'INVALID_MEMO_ID' };
    }

    return { valid: true, sanitized: str };
  }

  /**
   * Validate a MEMO_HASH or MEMO_RETURN value.
   * Must be exactly 32 bytes, supplied as a 64-character hex string.
   * @private
   * @param {string} value
   * @param {string} type - 'hash' or 'return'
   * @returns {{ valid: boolean, sanitized?: string, error?: string, code?: string }}
   */
  static _validateHash(value, type) {
    if (typeof value !== 'string') {
      return {
        valid: false,
        error: `${type} memo must be a string`,
        code: 'INVALID_MEMO_HASH',
      };
    }

    const hex = value.trim().toLowerCase();

    if (!/^[0-9a-f]{64}$/.test(hex)) {
      return {
        valid: false,
        error: `${type} memo must be exactly 32 bytes represented as a 64-character hex string`,
        code: 'INVALID_MEMO_HASH',
      };
    }

    return { valid: true, sanitized: hex };
  }

  /**
   * Validate memo according to Stellar specifications (text type only).
   * @param {string} memo - The memo to validate
   * @returns {Object} Validation result with valid flag and error message
   */
  static validate(memo) {
    // Empty memo is valid
    if (!memo || memo === '') {
      return {
        valid: true,
        sanitized: '',
        byteLength: 0
      };
    }

    // Check type
    if (typeof memo !== 'string') {
      return {
        valid: false,
        error: 'Memo must be a string',
        code: 'INVALID_MEMO_TYPE'
      };
    }

    // Sanitize: trim whitespace
    const sanitized = memo.trim();

    // Check byte length (Stellar uses UTF-8 encoding)
    const byteLength = Buffer.byteLength(sanitized, 'utf8');

    if (byteLength > MAX_MEMO_LENGTH) {
      return {
        valid: false,
        error: `Memo exceeds maximum length of ${MAX_MEMO_LENGTH} bytes (current: ${byteLength} bytes)`,
        code: 'MEMO_TOO_LONG',
        maxLength: MAX_MEMO_LENGTH,
        currentLength: byteLength
      };
    }

    // Check for null bytes (not allowed in Stellar memos)
    if (sanitized.includes('\0')) {
      return {
        valid: false,
        error: 'Memo cannot contain null bytes',
        code: 'INVALID_MEMO_CONTENT'
      };
    }

    // Check for non-printable characters (only allow printable ASCII + common UTF-8)
    // Here we reject control characters entirely
    // eslint-disable-next-line no-control-regex -- Intentionally checking for control characters
    if (/[\x00-\x1F\x7F]/.test(sanitized)) {
      return {
        valid: false,
        error: 'Memo contains invalid control characters',
        code: 'INVALID_MEMO_FORMAT'
      };
    }

    return {
      valid: true,
      sanitized,
      byteLength
    };
  }

  /**
   * Sanitize memo for safe storage and display
   * @param {string} memo - The memo to sanitize
   * @returns {string} Sanitized memo
   */
  static sanitize(memo) {
    // Use centralized sanitization utility
    return sanitizeMemo(memo);
  }

  /**
   * Get maximum memo length
   * @returns {number} Maximum memo length in bytes
   */
  static getMaxLength() {
    return MAX_MEMO_LENGTH;
  }

  /**
   * Check if memo is empty
   * @param {string} memo - The memo to check
   * @returns {boolean} True if memo is empty or whitespace only
   */
  static isEmpty(memo) {
    return !memo || memo.trim() === '';
  }

  /**
   * Truncate memo to maximum length (by bytes, not characters)
   * @param {string} memo - The memo to truncate
   * @returns {string} Truncated memo
   */
  static truncate(memo) {
    if (!memo || typeof memo !== 'string') {
      return '';
    }

    const sanitized = memo.trim();
    let truncated = sanitized;

    while (Buffer.byteLength(truncated, 'utf8') > MAX_MEMO_LENGTH) {
      truncated = truncated.slice(0, -1);
    }

    return truncated;
  }
}

module.exports = MemoValidator;
module.exports.MEMO_TYPES = MEMO_TYPES;
