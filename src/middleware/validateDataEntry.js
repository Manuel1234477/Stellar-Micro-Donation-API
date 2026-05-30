/**
 * Data Entry Validation Middleware
 * 
 * Enforces Stellar's 64-byte limit for both keys and values in account data entries.
 * Uses Buffer.byteLength() to correctly handle multi-byte characters.
 */

/**
 * Validate data entry key and value against Stellar's 64-byte limit
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
function validateDataEntry(req, res, next) {
  const { key, value } = req.body;

  // Validate key is present
  if (!key) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_REQUIRED_FIELD',
        message: 'Key field is required'
      }
    });
  }

  // Validate key is a string
  if (typeof key !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DATA_TYPE',
        message: 'Key must be a string'
      }
    });
  }

  // Check key byte length
  const keyByteLength = Buffer.byteLength(key, 'utf8');
  if (keyByteLength > 64) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'KEY_EXCEEDS_BYTE_LIMIT',
        message: `Key exceeds 64 bytes (${keyByteLength} bytes). Please use a shorter key or ASCII-only characters.`
      }
    });
  }

  // Validate value if present (optional, but if provided must be string)
  if (value !== undefined && value !== null && typeof value !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DATA_TYPE',
        message: 'Value must be a string or null'
      }
    });
  }

  // Check value byte length if present
  if (value) {
    const valueByteLength = Buffer.byteLength(value, 'utf8');
    if (valueByteLength > 64) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALUE_EXCEEDS_BYTE_LIMIT',
          message: `Value exceeds 64 bytes (${valueByteLength} bytes). Please use shorter data or ASCII-only characters.`
        }
      });
    }
  }

  // All validations passed
  next();
}

module.exports = { validateDataEntry };
