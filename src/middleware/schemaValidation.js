const { ERROR_CODES } = require('../utils/errors');

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
    return {
      path: fieldPath,
      message: `Invalid type. Expected ${expectedTypes.join(' or ')}, received ${getValueType(value)}`,
    };
  }

  if (rules.enum && !rules.enum.includes(value)) {
    return {
      path: fieldPath,
      message: `Invalid value. Must be one of: ${rules.enum.join(', ')}`,
    };
  }

  if (typeof value === 'string') {
    const normalized = rules.trim === true ? value.trim() : value;

    if (rules.minLength !== undefined && normalized.length < rules.minLength) {
      return {
        path: fieldPath,
        message: `Must be at least ${rules.minLength} characters`,
      };
    }

    if (rules.maxLength !== undefined && normalized.length > rules.maxLength) {
      return {
        path: fieldPath,
        message: `Must be at most ${rules.maxLength} characters`,
      };
    }

    if (rules.pattern && !rules.pattern.test(normalized)) {
      return {
        path: fieldPath,
        message: 'Invalid format',
      };
    }
  }

  if (typeof value === 'number') {
    if (rules.min !== undefined && value < rules.min) {
      return {
        path: fieldPath,
        message: `Must be greater than or equal to ${rules.min}`,
      };
    }

    if (rules.max !== undefined && value > rules.max) {
      return {
        path: fieldPath,
        message: `Must be less than or equal to ${rules.max}`,
      };
    }
  }

  if (typeof rules.validate === 'function') {
    const customResult = rules.validate(value);
    if (customResult !== true) {
      return {
        path: fieldPath,
        message:
          typeof customResult === 'string'
            ? customResult
            : 'Custom validation failed',
      };
    }
  }

  return null;
}

function validateSegment(data, segmentSchema, segmentName) {
  const errors = [];
  const fields = segmentSchema.fields || {};
  const allowUnknown = segmentSchema.allowUnknown === true;

  if (!isPlainObject(data)) {
    return [
      {
        path: segmentName,
        message: `Invalid ${segmentName}. Expected an object`,
      },
    ];
  }

  if (!allowUnknown) {
    const unknownFields = Object.keys(data).filter((key) => !Object.prototype.hasOwnProperty.call(fields, key));
    if (unknownFields.length > 0) {
      errors.push({
        path: segmentName,
        message: `Unknown field(s): ${unknownFields.join(', ')}`,
      });
    }
  }

  for (const [fieldName, rules] of Object.entries(fields)) {
    const value = data[fieldName];
    const isMissing = value === undefined;

    if (isMissing) {
      if (rules.required) {
        errors.push({
          path: `${segmentName}.${fieldName}`,
          message: 'Field is required',
        });
      }
      continue;
    }

    if (value === null && rules.nullable !== true) {
      errors.push({
        path: `${segmentName}.${fieldName}`,
        message: 'Field cannot be null',
      });
      continue;
    }

    const fieldError = validateField(value, rules, `${segmentName}.${fieldName}`);
    if (fieldError) {
      errors.push(fieldError);
    }
  }

  if (typeof segmentSchema.validate === 'function') {
    const segmentError = segmentSchema.validate(data);
    if (segmentError) {
      errors.push({
        path: segmentName,
        message: typeof segmentError === 'string' ? segmentError : 'Invalid input',
      });
    }
  }

  return errors;
}

function validateSchema(schema) {
  return (req, res, next) => {
    const allErrors = [];

    if (schema.body) {
      allErrors.push(...validateSegment(req.body ?? {}, schema.body, 'body'));
    }

    if (schema.query) {
      allErrors.push(...validateSegment(req.query ?? {}, schema.query, 'query'));
    }

    if (schema.params) {
      allErrors.push(...validateSegment(req.params ?? {}, schema.params, 'params'));
    }

    if (allErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Schema validation failed',
          details: allErrors,
        },
      });
    }

    return next();
  };
}

module.exports = {
  validateSchema,
};
