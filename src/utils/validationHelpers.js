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

module.exports = {
  validateRequiredFields,
  validateNonEmptyString,
  validateInteger,
  validateFloat,
  validateEnum,
  validateDifferent,
  validatePagination,
  validateRole,
};
