const { ERROR_CODES } = require('../utils/errors');
const schemaRegistry = require('./schemaRegistry');
const {
  sanitizeMemo,
  sanitizeLabel,
  sanitizeName,
  sanitizeIdentifier,
  sanitizeDescription,
  sanitizeMarkup,
  sanitizeText,
  stripHtmlTags,
} = require('../utils/sanitizer');

const {
  formatTypeError,
  formatEnumError,
  formatLengthError,
  formatRangeError,
  formatPatternError,
  formatRequiredError,
  formatNullError,
  formatCustomError,
  formatSegmentError,
} = require('../utils/validationErrorFormatter');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

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

function matchesType(value, type) {
  switch (type) {
  case 'string':
    return typeof value === 'string';
  case 'number':
    return typeof value === 'number' && Number.isFinite(value);
  case 'integer':
    return typeof value === 'number' && Number.isInteger(value);
  case 'boolean':
    return typeof value === 'boolean';
  case 'object':
    return isPlainObject(value);
  case 'array':
    return Array.isArray(value);
  case 'integerString':
    return isStrictIntegerString(value);
  case 'numberString':
    return isStrictNumberString(value);
  case 'dateString':
    return (
      typeof value === 'string'
      && value.trim().length > 0
      && !Number.isNaN(new Date(value).getTime())
    );
  default:
    return false;
  }
}

function validateField(value, rules, fieldPath) {
  const expectedTypes = Array.isArray(rules.types)
    ? rules.types
    : [rules.type || 'string'];

  const typeMatched = expectedTypes.some((type) => matchesType(value, type));
  if (!typeMatched) {
    return formatTypeError(fieldPath, value, expectedTypes, rules);
  }

  if (rules.enum && !rules.enum.includes(value)) {
    return formatEnumError(fieldPath, value, rules.enum);
  }

  if (typeof value === 'string') {
    const normalized = rules.trim === true ? value.trim() : value;

    if (rules.minLength !== undefined && normalized.length < rules.minLength) {
      return formatLengthError(fieldPath, normalized, rules.minLength, rules.maxLength);
    }

    if (rules.maxLength !== undefined && normalized.length > rules.maxLength) {
      return formatLengthError(fieldPath, normalized, rules.minLength, rules.maxLength);
    }

    if (rules.pattern && !rules.pattern.test(normalized)) {
      return formatPatternError(fieldPath, normalized, rules.pattern, rules);
    }
  }

  if (typeof value === 'number') {
    if (rules.min !== undefined && value < rules.min) {
      return formatRangeError(fieldPath, value, rules.min, rules.max);
    }

    if (rules.max !== undefined && value > rules.max) {
      return formatRangeError(fieldPath, value, rules.min, rules.max);
    }
  }

  if (typeof rules.validate === 'function') {
    const customResult = rules.validate(value);
    if (customResult !== true) {
      const message = typeof customResult === 'string'
        ? customResult
        : 'Custom validation failed';
      return formatCustomError(fieldPath, value, message);
    }
  }

  return null;
}

function sanitizeFieldValue(key, value, rules = {}) {
  if (typeof value !== 'string') return value;
  if (rules.sanitize === false) return rules.trim === true ? value.trim() : value;

  const val = rules.trim === true ? value.trim() : value;

  if (rules.sanitize === 'markup' || rules.allowMarkup === true) {
    return sanitizeMarkup(val, rules.allowedTags);
  }
  if (rules.sanitize === 'memo' || key === 'memo') {
    return sanitizeMemo(val);
  }
  if (rules.sanitize === 'label' || key === 'label') {
    return sanitizeLabel(val);
  }
  if (rules.sanitize === 'name' || key === 'ownerName' || key === 'name') {
    return sanitizeName(val);
  }
  if (rules.sanitize === 'identifier' || key === 'donor' || key === 'recipient') {
    return sanitizeIdentifier(val);
  }
  if (rules.sanitize === 'description' || key === 'description') {
    return sanitizeDescription(val, { allowMarkup: rules.allowMarkup || false, maxLength: rules.maxLength });
  }

  if (rules.sanitize === true || rules.stripTags === true) {
    return stripHtmlTags(val);
  }

  return val;
}

function stripUnknown(data, segmentSchema) {
  const fields = segmentSchema.fields || {};
  const allowUnknown = segmentSchema.allowUnknown === true;

  if (!isPlainObject(data)) return data;

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      const rules = fields[key];
      // Recurse into nested objects if the field has its own fields definition
      if (isPlainObject(value) && rules.fields) {
        result[key] = stripUnknown(value, rules);
      } else {
        result[key] = sanitizeFieldValue(key, value, rules);
      }
    } else if (allowUnknown) {
      result[key] = value;
    }
  }
  return result;
}

function validateSegment(data, segmentSchema, segmentName) {
  const errors = [];
  const fields = segmentSchema.fields || {};

  if (!isPlainObject(data)) {
    return [
      formatSegmentError(segmentName, `Invalid ${segmentName}. Expected an object, received ${getValueType(data)}.`),
    ];
  }

  for (const [fieldName, rules] of Object.entries(fields)) {
    const value = data[fieldName];
    const isMissing = value === undefined;

    if (isMissing) {
      if (rules.required) {
        errors.push(formatRequiredError(`${segmentName}.${fieldName}`, rules));
      }
      continue;
    }

    if (value === null && rules.nullable !== true) {
      errors.push(formatNullError(`${segmentName}.${fieldName}`, rules));
      continue;
    }

    // Handle array validation with index tracking
    if (Array.isArray(value) && rules.items) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const itemPath = `${segmentName}.${fieldName}[${i}]`;
        
        if (isPlainObject(item) && rules.items.fields) {
          // Validate nested object within array
          const nestedErrors = validateNestedObject(item, rules.items, itemPath);
          errors.push(...nestedErrors);
        } else {
          // Validate scalar array item
          const itemError = validateField(item, rules.items, itemPath);
          if (itemError) {
            errors.push(itemError);
          }
        }
      }
    } else {
      const fieldError = validateField(value, rules, `${segmentName}.${fieldName}`);
      if (fieldError) {
        errors.push(fieldError);
      }
    }
  }

  if (typeof segmentSchema.validate === 'function') {
    const segmentError = segmentSchema.validate(data);
    if (segmentError) {
      errors.push(
        formatSegmentError(
          segmentName,
          typeof segmentError === 'string' ? segmentError : 'Invalid input'
        )
      );
    }
  }

  return errors;
}

/**
 * Validate a nested object (e.g., within an array).
 * @param {Object} data - Object to validate
 * @param {Object} schema - Schema with fields definition
 * @param {string} path - Dot-notation path prefix
 * @returns {Array} Array of validation errors
 */
function validateNestedObject(data, schema, path) {
  const errors = [];
  const fields = schema.fields || {};

  if (!isPlainObject(data)) {
    errors.push(formatSegmentError(path, `Expected an object, received ${getValueType(data)}.`));
    return errors;
  }

  for (const [fieldName, rules] of Object.entries(fields)) {
    const value = data[fieldName];
    const isMissing = value === undefined;
    const fieldPath = `${path}.${fieldName}`;

    if (isMissing) {
      if (rules.required) {
        errors.push(formatRequiredError(fieldPath, rules));
      }
      continue;
    }

    if (value === null && rules.nullable !== true) {
      errors.push(formatNullError(fieldPath, rules));
      continue;
    }

    const fieldError = validateField(value, rules, fieldPath);
    if (fieldError) {
      errors.push(fieldError);
    }
  }

  return errors;
}

/**
 * Middleware factory for request schema validation with version support.
 * 
 * Supports both legacy single-schema objects and versioned schemas from the registry.
 * Negotiates schema version using the 'X-Schema-Version' request header.
 * 
 * @param {Object|string} schemaOrKey A schema object (for legacy support) or a unique registry key.
 * @param {Object} [versions] (Optional) An object mapping version strings to schemas for in-line registration.
 * @param {Object} [options] (Optional) Configuration for versioning (deprecated versions, migration guides).
 * @returns {Function} Express middleware function
 */
function validateSchema(schemaOrKey, versions, options) {

  let schemaKey = null;

  // In-line registration if versions are provided
  if (typeof schemaOrKey === 'string' && versions) {
    schemaKey = schemaOrKey;
    schemaRegistry.registerSchema(schemaKey, versions, options);
  } else if (typeof schemaOrKey === 'string') {
    schemaKey = schemaOrKey;
  }

  return (req, res, next) => {
    let schemaToUse;
    let versionInfo = null;

    if (schemaKey) {
      // Use the normalised semver string attached by schemaVersionMiddleware.
      // Falls back to the raw header only when the middleware was not applied
      // (e.g. in isolated unit tests that skip the middleware stack).
      const requestedVersion = req.schemaVersion || req.get('X-Schema-Version') || null;
      versionInfo = schemaRegistry.getSchema(schemaKey, requestedVersion);

      if (!versionInfo) {
        // 400 Bad Request: the client specified a schema version string that does
        // not exist. This is a malformed request (wrong header value), not a
        // semantic validation failure, so 400 is correct here.
        return res.status(400).json({
          success: false,
          error: {
            code: ERROR_CODES.INVALID_SCHEMA_VERSION.code,
            message: `Unsupported schema version: ${requestedVersion || 'latest'}`,
            supportedVersions: schemaRegistry.registry.get(schemaKey)?.allVersions || [],
            migrationGuide: 'Please consult the API documentation for supported schema versions.',
            requestId: req.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
      schemaToUse = versionInfo.schema;
    } else {
      // Legacy support for direct schema objects
      schemaToUse = schemaOrKey;
    }

    // Version headers
    if (versionInfo) {
      res.setHeader('X-Schema-Version', versionInfo.version);
      res.setHeader('X-Schema-Version-Supported', versionInfo.supportedVersions.join(', '));

      if (versionInfo.isDeprecated) {
        res.setHeader('X-Schema-Deprecated', 'true');
        if (versionInfo.migrationGuide) {
          res.setHeader('X-Schema-Migration-Guide', versionInfo.migrationGuide);
          // Add standard Warning header for deprecation
          res.setHeader('Warning', `199 - "Schema version ${versionInfo.version} is deprecated. ${versionInfo.migrationGuide}"`);
        } else {
          res.setHeader('Warning', `199 - "Schema version ${versionInfo.version} is deprecated."`);
        }
      }
    }

    const allErrors = [];

    if (schemaToUse.body) {
      allErrors.push(...validateSegment(req.body ?? {}, schemaToUse.body, 'body'));
    }

    if (schemaToUse.query) {
      allErrors.push(...validateSegment(req.query ?? {}, schemaToUse.query, 'query'));
    }

    if (schemaToUse.params) {
      allErrors.push(...validateSegment(req.params ?? {}, schemaToUse.params, 'params'));
    }

    if (allErrors.length === 0) {
      if (schemaToUse.body) req.body = stripUnknown(req.body ?? {}, schemaToUse.body);
      if (schemaToUse.query) req.query = stripUnknown(req.query ?? {}, schemaToUse.query);
      if (schemaToUse.params) req.params = stripUnknown(req.params ?? {}, schemaToUse.params);
    }

    if (allErrors.length > 0) {
      const errorResponse = {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR.code,
          // 422 Unprocessable Entity: request was well-formed JSON but failed
          // semantic validation rules (missing fields, bad values, etc.).
          // 400 is reserved for syntactically malformed requests.
          message: 'Request body failed schema validation',
          details: allErrors,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      };

      // Include migration guide in error if version is deprecated
      if (versionInfo?.isDeprecated && versionInfo?.migrationGuide) {
        errorResponse.error.migrationGuide = versionInfo.migrationGuide;
      }

      return res.status(422).json(errorResponse);
    }

    return next();
  };
}

module.exports = {
  validateSchema,
};

