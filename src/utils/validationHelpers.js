/**
 * Shared Validation Helpers
 * Centralized validation logic to eliminate duplication across routes and services
 */

function isStrictIntegerString(value) {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  let startIndex = 0;
  if (trimmed[0] === '-') {
    if (trimmed.length === 1) return false;
    startIndex = 1;
  }

  for (let i = startIndex; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

function isStrictNumberString(value) {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  let dotCount = 0;
  let digitCount = 0;

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    const code = trimmed.charCodeAt(i);

    if (char === '-') {
      if (i !== 0) return false;
      continue;
    }

    if (char === '.') {
      dotCount += 1;
      if (dotCount > 1) return false;
      continue;
    }

    if (code >= 48 && code <= 57) {
      digitCount += 1;
      continue;
    }

    return false;
  }

  return digitCount > 0;
}

/**
 * Validate required fields are present
 * @param {Object} data - Object containing fields to validate
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {{valid: boolean, missing?: string[]}}
 */
function validateRequiredFields(data, requiredFields) {
  const missing = requiredFields.filter(field => !data[field]);

  if (missing.length > 0) {
    return { valid: false, missing };
  }

  return { valid: true };
}

/**
 * Validate string field is non-empty
 * @param {*} value - Value to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {{valid: boolean, error?: string}}
 */
function validateNonEmptyString(value, fieldName = 'field') {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return {
      valid: false,
      error: `${fieldName} must be a non-empty string`
    };
  }
  return { valid: true };
}

/**
 * Validate and parse integer with range check
 * @param {*} value - Value to parse
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum value (inclusive)
 * @param {number} options.max - Maximum value (inclusive)
 * @param {number} options.default - Default value if parsing fails
 * @returns {{valid: boolean, value?: number, error?: string}}
 */
function validateInteger(value, options = {}) {
  const { min, max, default: defaultValue } = options;

  const isMissing = value === undefined || value === null || value === '';
  if (isMissing && defaultValue !== undefined) {
    return { valid: true, value: defaultValue };
  }

  let parsed;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { valid: false, error: 'Must be a valid integer' };
    }
    parsed = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!isStrictIntegerString(trimmed)) {
      return { valid: false, error: 'Must be a valid integer' };
    }
    parsed = Number(trimmed);
  } else {
    return { valid: false, error: 'Must be a valid integer' };
  }

  if (min !== undefined && parsed < min) {
    return { valid: false, error: `Must be at least ${min}` };
  }

  if (max !== undefined && parsed > max) {
    return { valid: false, error: `Must be at most ${max}` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validate an XLM amount at the input boundary (issue #1158).
 *
 * Rules enforced:
 *  - Input is coerced to a string before any numeric parsing so precision is
 *    never silently lost by a prior parseFloat/Number call.
 *  - Regex allows an optional integer part + up to 7 decimal places; no
 *    exponent notation, no leading/trailing whitespace after trim.
 *  - The numeric value must be strictly positive (> 0) unless allowZero is set.
 *  - Optional min / max bounds (in XLM) are applied after parsing.
 *  - On success, returns both the parsed XLM float and the equivalent integer
 *    stroops (1 XLM = 10,000,000 stroops) for downstream math.
 *
 * @param {*}      value           - Raw input (string or number)
 * @param {Object} [opts]
 * @param {boolean}[opts.allowZero=false] - Permit zero amounts
 * @param {number} [opts.min]      - Minimum XLM amount (inclusive)
 * @param {number} [opts.max]      - Maximum XLM amount (inclusive)
 * @returns {{ valid: boolean, xlm?: number, stroops?: number, error?: string, code?: string }}
 */
const XLM_AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;
const STROOPS_PER_XLM  = 10_000_000;

function validateXLMAmount(value, opts = {}) {
  const { allowZero = false, min, max } = opts;

  // Coerce to string — reject types that can't represent a numeric literal
  let raw;
  if (typeof value === 'string') {
    raw = value.trim();
  } else if (typeof value === 'number') {
    // Reject NaN / Infinity before converting to string
    if (!Number.isFinite(value)) {
      return { valid: false, error: 'Amount must be a finite number', code: 'INVALID_AMOUNT' };
    }
    // Use toFixed(7) to avoid scientific notation for very small/large numbers
    raw = value.toFixed(7).replace(/\.?0+$/, '') || '0';
  } else {
    return { valid: false, error: 'Amount must be a string or number', code: 'INVALID_AMOUNT' };
  }

  // Reject empty input
  if (raw.length === 0) {
    return { valid: false, error: 'Amount is required', code: 'INVALID_AMOUNT' };
  }

  // Reject scientific notation, negative prefix, or any non-digit/dot characters
  if (!XLM_AMOUNT_REGEX.test(raw)) {
    return {
      valid: false,
      error: 'Amount must be a positive decimal number with at most 7 decimal places (e.g. "10.5"). ' +
             'Scientific notation, negative values, and extra characters are not allowed.',
      code: 'INVALID_AMOUNT_FORMAT',
    };
  }

  const xlm = parseFloat(raw);

  if (!allowZero && xlm <= 0) {
    return { valid: false, error: 'Amount must be greater than 0', code: 'AMOUNT_TOO_LOW' };
  }
  if (allowZero && xlm < 0) {
    return { valid: false, error: 'Amount must not be negative', code: 'AMOUNT_TOO_LOW' };
  }

  if (min !== undefined && xlm < min) {
    return { valid: false, error: `Amount must be at least ${min} XLM`, code: 'AMOUNT_BELOW_MINIMUM' };
  }
  if (max !== undefined && xlm > max) {
    return { valid: false, error: `Amount must be at most ${max} XLM`, code: 'AMOUNT_EXCEEDS_MAXIMUM' };
  }

  // Compute stroops as an integer (ROUND-HALF-EVEN for the multiply; the
  // regex guarantees ≤7 dp so Math.round is exact for representable values).
  const stroops = Math.round(xlm * STROOPS_PER_XLM);

  return { valid: true, xlm, stroops };
}

/**
 * Validate and parse float with range check
 * @param {*} value - Value to parse
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum value (exclusive)
 * @param {number} options.max - Maximum value (inclusive)
 * @param {boolean} options.allowZero - Allow zero value
 * @returns {{valid: boolean, value?: number, error?: string}}
 */
function validateFloat(value, options = {}) {
  const { min, max, allowZero = false } = options;

  let parsed;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!isStrictNumberString(trimmed)) {
      return { valid: false, error: 'Must be a valid number' };
    }
    parsed = Number(trimmed);
  } else {
    return { valid: false, error: 'Must be a valid number' };
  }

  if (!Number.isFinite(parsed)) {
    return { valid: false, error: 'Must be a valid number' };
  }

  if (!allowZero && parsed <= 0) {
    return { valid: false, error: 'Must be greater than 0' };
  }

  if (min !== undefined && parsed <= min) {
    return { valid: false, error: `Must be greater than ${min}` };
  }

  if (max !== undefined && parsed > max) {
    return { valid: false, error: `Must be at most ${max}` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validate value is in allowed list
 * @param {*} value - Value to validate
 * @param {Array} allowedValues - Array of allowed values
 * @param {Object} options - Validation options
 * @param {boolean} options.caseInsensitive - Perform case-insensitive comparison for strings
 * @returns {{valid: boolean, value?: *, error?: string}}
 */
function validateEnum(value, allowedValues, options = {}) {
  const { caseInsensitive = false } = options;

  if (!value) {
    return { valid: false, error: 'Value is required' };
  }

  let normalizedValue = value;
  let normalizedAllowed = allowedValues;

  if (caseInsensitive && typeof value === 'string') {
    normalizedValue = value.toLowerCase();
    normalizedAllowed = allowedValues.map(v =>
      typeof v === 'string' ? v.toLowerCase() : v
    );
  }

  if (!normalizedAllowed.includes(normalizedValue)) {
    return {
      valid: false,
      error: `Must be one of: ${allowedValues.join(', ')}`
    };
  }

  return {
    valid: true,
    value: caseInsensitive && typeof value === 'string' ? normalizedValue : value
  };
}

/**
 * Validate two values are different
 * @param {*} value1 - First value
 * @param {*} value2 - Second value
 * @param {string} field1Name - Name of first field
 * @param {string} field2Name - Name of second field
 * @returns {{valid: boolean, error?: string}}
 */
function validateDifferent(value1, value2, field1Name = 'field1', field2Name = 'field2') {
  if (value1 && value2 && value1 === value2) {
    return {
      valid: false,
      error: `${field1Name} and ${field2Name} must be different`
    };
  }
  return { valid: true };
}

/**
 * Validate pagination parameters
 * @param {*} limit - Limit value
 * @param {*} offset - Offset value
 * @param {Object} options - Validation options
 * @param {number} options.maxLimit - Maximum allowed limit
 * @param {number} options.defaultLimit - Default limit if not provided
 * @returns {{valid: boolean, limit?: number, offset?: number, error?: string}}
 */
function validatePagination(limit, offset, options = {}) {
  const { maxLimit = 100, defaultLimit = 10 } = options;

  // Validate limit
  const limitResult = validateInteger(limit, {
    min: 1,
    max: maxLimit,
    default: defaultLimit
  });

  if (!limitResult.valid) {
    return { valid: false, error: `Invalid limit: ${limitResult.error}` };
  }

  // Validate offset
  const offsetResult = validateInteger(offset, {
    min: 0,
    default: 0
  });

  if (!offsetResult.valid) {
    return { valid: false, error: `Invalid offset: ${offsetResult.error}` };
  }

  return {
    valid: true,
    limit: limitResult.value,
    offset: offsetResult.value
  };
}

/**
 * Validate role is valid
 * @param {string} role - Role to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateRole(role) {
  const validRoles = ['admin', 'user', 'guest'];
  return validateEnum(role, validRoles, { caseInsensitive: false });
}

/**
 * Format error response for unknown fields
 * Creates a standardized error response when unknown fields are detected in a request payload
 * 
 * @param {string[]} unknownFields - Array of unknown field names
 * @param {string[]} allowedFields - Array of allowed field names (optional)
 * @returns {Object} Formatted error response object
 */
function formatUnknownFieldError(unknownFields, allowedFields = null) {
  const error = {
    success: false,
    error: {
      code: 'UNKNOWN_FIELDS',
      message: 'Request contains unknown or unexpected fields',
      unknownFields: unknownFields
    }
  };

  // Optionally include allowed fields for better developer experience
  if (allowedFields && Array.isArray(allowedFields)) {
    error.error.allowedFields = allowedFields;
  }

  return error;
}

module.exports = {
  validateRequiredFields,
  validateNonEmptyString,
  validateInteger,
  validateFloat,
  validateXLMAmount,
  validateEnum,
  validateDifferent,
  validatePagination,
  validateRole,
  formatUnknownFieldError,
  STROOPS_PER_XLM,
};
