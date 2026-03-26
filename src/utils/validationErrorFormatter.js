/**
 * Validation Error Formatter - Validation Layer
 * 
 * RESPONSIBILITY: Generate comprehensive, actionable validation error messages
 * OWNER: Backend Team
 * DEPENDENCIES: None (foundational utility)
 * 
 * Provides detailed error messages that include:
 * - Field path (e.g., "body.amount")
 * - Constraint violated (e.g., "minimum value")
 * - Invalid value (sanitized to prevent sensitive data exposure)
 * - Example of valid value
 * - Actionable guidance for developers
 * 
 * Security: All error messages are designed to be user-safe and don't expose
 * sensitive information like database details, file paths, or system internals.
 */

/**
 * Sanitize a value for display in error messages
 * Prevents exposure of sensitive data while showing enough context
 * @param {*} value - The value to sanitize
 * @returns {string} - Sanitized string representation
 */
function sanitizeValueForDisplay(value) {
  // Handle null/undefined
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  // Handle primitives
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);

  // Handle strings - truncate long strings and escape special chars
  if (typeof value === 'string') {
    const maxLength = 50;
    const truncated = value.length > maxLength 
      ? `${value.substring(0, maxLength)}...` 
      : value;
    // Escape quotes for JSON safety
    return `"${truncated.replace(/"/g, '\\"')}"`;
  }

  // Handle arrays - show type and length
  if (Array.isArray(value)) {
    return `array[${value.length}]`;
  }

  // Handle objects - show type
  if (typeof value === 'object') {
    return `object{${Object.keys(value).length} keys}`;
  }

  return String(value);
}

/**
 * Generate example value based on field rules
 * @param {Object} rules - Field validation rules
 * @returns {string} - Example value string
 */
function generateExampleValue(rules) {
  // If enum is provided, use first value
  if (rules.enum && rules.enum.length > 0) {
    return sanitizeValueForDisplay(rules.enum[0]);
  }

  // Based on type
  const types = Array.isArray(rules.types) ? rules.types : [rules.type || 'string'];
  const primaryType = types[0];

  switch (primaryType) {
  case 'string':
    if (rules.pattern) {
      // Try to generate pattern-matching example
      if (rules.pattern.source.includes('G[A-Z2-7]')) {
        return '"G_PUBLIC_KEY_EXAMPLE"';
      }
      if (rules.pattern.source.includes('[a-f0-9]')) {
        return '"hex_value_example"';
      }
    }
    if (rules.minLength) {
      return `"${Array(Math.min(rules.minLength + 1, 20)).fill('a').join('')}"`;
    }
    return '"example"';

  case 'number':
  case 'numberString':
    if (rules.min !== undefined) {
      return String(rules.min);
    }
    return '10.5';

  case 'integer':
  case 'integerString':
    if (rules.min !== undefined) {
      return String(Math.ceil(rules.min));
    }
    return '10';

  case 'boolean':
    return 'true';

  case 'dateString':
    return '"2024-03-24T10:30:00Z"';

  case 'array':
    return '[]';

  case 'object':
    return '{}';

  default:
    return 'null';
  }
}

/**
 * Generate detailed error message for type mismatch
 * @param {string} fieldPath - Field path
 * @param {*} value - Actual value received
 * @param {string[]} expectedTypes - Expected types
 * @param {Object} rules - Field rules
 * @returns {Object} - Error object with message and details
 */
function formatTypeError(fieldPath, value, expectedTypes, rules) {
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  const example = generateExampleValue(rules, fieldPath);

  return {
    path: fieldPath,
    message: `Invalid type for field "${fieldPath}". Expected ${expectedTypes.join(' or ')}, but received ${actualType}.`,
    constraint: 'type',
    invalidValue: sanitizeValueForDisplay(value, fieldPath),
    expectedTypes,
    example,
    guidance: `Ensure the value is of type ${expectedTypes.join(' or ')}. Example: ${example}`,
  };
}

/**
 * Generate detailed error message for enum validation
 * @param {string} fieldPath - Field path
 * @param {*} value - Actual value received
 * @param {*[]} enumValues - Allowed enum values
 * @returns {Object} - Error object with message and details
 */
function formatEnumError(fieldPath, value, enumValues) {
  const example = sanitizeValueForDisplay(enumValues[0]);

  return {
    path: fieldPath,
    message: `Invalid value for field "${fieldPath}". Must be one of: ${enumValues.map(v => sanitizeValueForDisplay(v)).join(', ')}.`,
    constraint: 'enum',
    invalidValue: sanitizeValueForDisplay(value, fieldPath),
    allowedValues: enumValues,
    example,
    guidance: `Choose one of the allowed values. Example: ${example}`,
  };
}

/**
 * Generate detailed error message for string length validation
 * @param {string} fieldPath - Field path
 * @param {string} value - Actual value received
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length
 * @returns {Object} - Error object with message and details
 */
function formatLengthError(fieldPath, value, minLength, maxLength) {
  const actualLength = value.length;
  let message;
  let constraint;
  let example;

  if (minLength !== undefined && actualLength < minLength) {
    message = `Field "${fieldPath}" is too short. Minimum length is ${minLength} characters, but received ${actualLength}.`;
    constraint = 'minLength';
    example = `"${Array(minLength + 1).fill('a').join('')}"`;
  } else if (maxLength !== undefined && actualLength > maxLength) {
    message = `Field "${fieldPath}" is too long. Maximum length is ${maxLength} characters, but received ${actualLength}.`;
    constraint = 'maxLength';
    example = `"${Array(Math.min(maxLength, 20)).fill('a').join('')}"`;
  } else {
    message = `Field "${fieldPath}" length validation failed.`;
    constraint = 'length';
    example = '"example"';
  }

  return {
    path: fieldPath,
    message,
    constraint,
    invalidValue: sanitizeValueForDisplay(value, fieldPath),
    actualLength,
    minLength,
    maxLength,
    example,
    guidance: `Ensure the value has between ${minLength || 0} and ${maxLength || 'unlimited'} characters.`,
  };
}

/**
 * Generate detailed error message for numeric range validation
 * @param {string} fieldPath - Field path
 * @param {number} value - Actual value received
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {Object} - Error object with message and details
 */
function formatRangeError(fieldPath, value, min, max) {
  let message;
  let constraint;
  let example;

  if (min !== undefined && value < min) {
    message = `Field "${fieldPath}" is too small. Minimum value is ${min}, but received ${value}.`;
    constraint = 'min';
    example = String(min);
  } else if (max !== undefined && value > max) {
    message = `Field "${fieldPath}" is too large. Maximum value is ${max}, but received ${value}.`;
    constraint = 'max';
    example = String(max);
  } else {
    message = `Field "${fieldPath}" value is out of range.`;
    constraint = 'range';
    example = String(min || 0);
  }

  return {
    path: fieldPath,
    message,
    constraint,
    invalidValue: sanitizeValueForDisplay(value, fieldPath),
    min,
    max,
    example,
    guidance: `Ensure the value is between ${min || 'unlimited'} and ${max || 'unlimited'}.`,
  };
}

/**
 * Generate detailed error message for pattern validation
 * @param {string} fieldPath - Field path
 * @param {string} value - Actual value received
 * @param {RegExp} pattern - Expected pattern
 * @param {Object} rules - Field rules for context
 * @returns {Object} - Error object with message and details
 */
function formatPatternError(fieldPath, value, pattern, rules = {}) {
  const example = generateExampleValue(rules, fieldPath);
  let patternDescription = 'the required format';

  // Provide helpful pattern descriptions
  if (pattern.source.includes('G[A-Z2-7]')) {
    patternDescription = 'a Stellar public key (starts with G, 56 characters)';
  } else if (pattern.source.includes('S[A-Z2-7]')) {
    patternDescription = 'a Stellar secret key (starts with S, 56 characters)';
  } else if (pattern.source.includes('[a-f0-9]')) {
    patternDescription = 'a hexadecimal string';
  } else if (pattern.source.includes('@')) {
    patternDescription = 'a valid email address';
  }

  return {
    path: fieldPath,
    message: `Field "${fieldPath}" has invalid format. Expected ${patternDescription}.`,
    constraint: 'pattern',
    invalidValue: sanitizeValueForDisplay(value, fieldPath),
    pattern: pattern.source,
    example,
    guidance: `Ensure the value matches ${patternDescription}. Example: ${example}`,
  };
}

/**
 * Generate detailed error message for required field validation
 * @param {string} fieldPath - Field path
 * @param {Object} rules - Field rules
 * @returns {Object} - Error object with message and details
 */
function formatRequiredError(fieldPath, rules = {}) {
  const example = generateExampleValue(rules, fieldPath);

  return {
    path: fieldPath,
    message: `Field "${fieldPath}" is required but was not provided.`,
    constraint: 'required',
    invalidValue: 'undefined',
    example,
    guidance: `Provide a value for this field. Example: ${example}`,
  };
}

/**
 * Generate detailed error message for null validation
 * @param {string} fieldPath - Field path
 * @param {Object} rules - Field rules
 * @returns {Object} - Error object with message and details
 */
function formatNullError(fieldPath, rules = {}) {
  const example = generateExampleValue(rules, fieldPath);

  return {
    path: fieldPath,
    message: `Field "${fieldPath}" cannot be null.`,
    constraint: 'nullable',
    invalidValue: 'null',
    example,
    guidance: `Provide a non-null value for this field. Example: ${example}`,
  };
}

/**
 * Generate detailed error message for unknown fields
 * @param {string} segmentName - Segment name (body, query, params)
 * @param {string[]} unknownFields - Unknown field names
 * @param {string[]} allowedFields - Allowed field names
 * @returns {Object} - Error object with message and details
 */
function formatUnknownFieldsError(segmentName, unknownFields, allowedFields = []) {
  const fieldList = unknownFields.join(', ');
  const allowedList = allowedFields.length > 0 
    ? allowedFields.join(', ')
    : 'none (this endpoint does not accept a request body)';

  return {
    path: segmentName,
    message: `Unknown field(s) in ${segmentName}: ${fieldList}. Allowed fields are: ${allowedList}.`,
    constraint: 'unknownFields',
    invalidValue: fieldList,
    unknownFields,
    allowedFields,
    example: allowedFields.length > 0 ? `{ "${allowedFields[0]}": "value" }` : 'N/A',
    guidance: `Remove the unknown fields or check the API documentation. Allowed fields: ${allowedList}`,
  };
}

/**
 * Generate detailed error message for custom validation
 * @param {string} fieldPath - Field path
 * @param {*} value - Actual value received
 * @param {string} customMessage - Custom error message
 * @returns {Object} - Error object with message and details
 */
function formatCustomError(fieldPath, value, customMessage) {
  return {
    path: fieldPath,
    message: customMessage,
    constraint: 'custom',
    invalidValue: sanitizeValueForDisplay(value, fieldPath),
    guidance: customMessage,
  };
}

/**
 * Generate detailed error message for segment validation
 * @param {string} segmentName - Segment name (body, query, params)
 * @param {string} customMessage - Custom error message
 * @returns {Object} - Error object with message and details
 */
function formatSegmentError(segmentName, customMessage) {
  return {
    path: segmentName,
    message: customMessage,
    constraint: 'segment',
    guidance: customMessage,
  };
}

module.exports = {
  sanitizeValueForDisplay,
  generateExampleValue,
  formatTypeError,
  formatEnumError,
  formatLengthError,
  formatRangeError,
  formatPatternError,
  formatRequiredError,
  formatNullError,
  formatUnknownFieldsError,
  formatCustomError,
  formatSegmentError,
};
