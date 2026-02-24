/**
 * Memo Validator
 * Validates and sanitizes transaction memos according to Stellar specifications
 * 
 * Stellar Memo Types:
 * - MEMO_TEXT: Up to 28 bytes of UTF-8 text
 * - MEMO_ID: 64-bit unsigned integer
 * - MEMO_HASH: 32-byte hash
 * - MEMO_RETURN: 32-byte hash for returns
 * 
 * This implementation focuses on MEMO_TEXT for simplicity
 */

const { sanitizeMemo } = require('./sanitizer');

const MAX_MEMO_LENGTH = 28; // Stellar MEMO_TEXT limit in bytes

class MemoValidator {
  /**
   * Validate memo according to Stellar specifications
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
