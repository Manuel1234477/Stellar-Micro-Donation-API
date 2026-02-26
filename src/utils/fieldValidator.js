/**
 * Field Validator Utility - Unknown Field Detection
 * 
 * RESPONSIBILITY: Detect unknown/unexpected fields in request payloads
 * OWNER: Security Team
 * DEPENDENCIES: None
 * 
 * Provides utilities for comparing request payload fields against allowed field schemas
 * to identify and reject requests containing unexpected fields.
 */

/**
 * Detect unknown fields in a payload
 * Compares the keys in the payload against the list of allowed fields
 * and returns any fields that are not in the allowed list.
 * 
 * @param {Object} payload - The request payload object to validate
 * @param {string[]} allowedFields - Array of allowed field names
 * @returns {string[]} Array of unknown field names (empty if all fields are valid)
 * 
 * @example
 * const payload = { name: 'John', age: 30, hacker: 'malicious' };
 * const allowed = ['name', 'age'];
 * const unknown = detectUnknownFields(payload, allowed);
 * // Returns: ['hacker']
 */
function detectUnknownFields(payload, allowedFields) {
  // Handle edge cases
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (!allowedFields || !Array.isArray(allowedFields)) {
    return [];
  }

  // Get all keys from the payload
  const payloadKeys = Object.keys(payload);

  // Filter out keys that are not in the allowed fields list
  const unknownFields = payloadKeys.filter(key => !allowedFields.includes(key));

  return unknownFields;
}

/**
 * Check if a payload contains only allowed fields
 * @param {Object} payload - The request payload object to validate
 * @param {string[]} allowedFields - Array of allowed field names
 * @returns {boolean} True if all fields are allowed, false if unknown fields exist
 */
function hasOnlyAllowedFields(payload, allowedFields) {
  const unknownFields = detectUnknownFields(payload, allowedFields);
  return unknownFields.length === 0;
}

/**
 * Validate payload against allowed fields and return validation result
 * @param {Object} payload - The request payload object to validate
 * @param {string[]} allowedFields - Array of allowed field names
 * @returns {{valid: boolean, unknownFields: string[]}} Validation result
 */
function validatePayloadFields(payload, allowedFields) {
  const unknownFields = detectUnknownFields(payload, allowedFields);
  
  return {
    valid: unknownFields.length === 0,
    unknownFields
  };
}

module.exports = {
  detectUnknownFields,
  hasOnlyAllowedFields,
  validatePayloadFields
};
