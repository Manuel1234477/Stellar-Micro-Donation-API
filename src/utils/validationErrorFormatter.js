/**
 * Validation Error Formatter
 * Produces structured per-field validation errors with masking for sensitive values.
 */

const { getMessage, parseLanguage } = require('./i18n');

/** Fields whose values must always be masked in error output */
const SENSITIVE_FIELDS = new Set(['secretKey', 'secret', 'password', 'privateKey', 'serviceSecretKey', 'sourceSecret', 'key', 'token', 'apiKey']);

/** Base URL for documentation links */
const DOCS_BASE = '/docs/validation-errors';

/**
 * Error code registry — single source of truth for all validation error codes.
 * Each entry: { field, expectedFormat, description }
 * @type {Record<string, {field: string, expectedFormat: string, description: string}>}
 */
const ERROR_REGISTRY = {
  MISSING_AMOUNT:           { field: 'amount',           expectedFormat: 'Positive number (e.g. 10.5)',                         description: 'amount is required' },
  INVALID_AMOUNT_TYPE:      { field: 'amount',           expectedFormat: 'Positive number (e.g. 10.5)',                         description: 'amount must be a valid number' },
  AMOUNT_TOO_LOW:           { field: 'amount',           expectedFormat: 'Positive number greater than 0',                      description: 'amount must be greater than zero' },
  AMOUNT_BELOW_MINIMUM:     { field: 'amount',           expectedFormat: 'Number >= configured minimum XLM',                    description: 'amount is below the minimum allowed' },
  AMOUNT_EXCEEDS_MAXIMUM:   { field: 'amount',           expectedFormat: 'Number <= configured maximum XLM',                    description: 'amount exceeds the maximum allowed' },
  DAILY_LIMIT_EXCEEDED:     { field: 'amount',           expectedFormat: 'Number within remaining daily allowance',             description: 'daily donation limit would be exceeded' },
  MISSING_RECIPIENT:        { field: 'recipient',        expectedFormat: 'Non-empty string (Stellar public key or identifier)', description: 'recipient is required' },
  SAME_SENDER_RECIPIENT:    { field: 'recipient',        expectedFormat: 'Different value from donor',                          description: 'sender and recipient must be different' },
  MISSING_IDEMPOTENCY_KEY:  { field: 'idempotency-key', expectedFormat: 'Non-empty string header (UUID recommended)',           description: 'Idempotency-Key header is required' },
  MISSING_ADDRESS:          { field: 'address',          expectedFormat: 'Stellar public key (starts with G, 56 chars)',        description: 'address is required' },
  MISSING_STATUS:           { field: 'status',           expectedFormat: 'One of: pending, confirmed, failed, cancelled',       description: 'status is required' },
  INVALID_STATUS:           { field: 'status',           expectedFormat: 'One of: pending, confirmed, failed, cancelled',       description: 'status value is not recognised' },
  MISSING_PUBLIC_KEY:       { field: 'publicKey',        expectedFormat: 'Stellar public key (starts with G, 56 chars)',        description: 'publicKey is required' },
  INVALID_LIMIT:            { field: 'limit',            expectedFormat: 'Positive integer',                                    description: 'limit must be a positive integer' },
  INVALID_OFFSET:           { field: 'offset',           expectedFormat: 'Non-negative integer',                                description: 'offset must be a non-negative integer' },
  MISSING_TRANSACTION_HASH: { field: 'transactionHash',  expectedFormat: 'Non-empty hex string',                                description: 'transactionHash is required' },
  MISSING_WALLET_FIELD:     { field: 'label|ownerName',  expectedFormat: 'At least one non-empty string',                      description: 'at least one of label or ownerName is required' },
};

/**
 * Mask a sensitive value, preserving the first two characters.
 * @param {*} value
 * @returns {string}
 */
function maskValue(value) {
  const str = String(value ?? '');
  if (str.length <= 2) return '***';
  return str.slice(0, 2) + '***';
}

/**
 * Determine whether a field name is sensitive.
 * @param {string} field
 * @returns {boolean}
 */
function isSensitive(field) {
  return SENSITIVE_FIELDS.has(field);
}

/**
 * Build a human-readable example for a given expected format.
 * @param {string} expectedFormat
 * @returns {string}
 */
function exampleFor(expectedFormat) {
  if (!expectedFormat) return 'See documentation';
  const match = expectedFormat.match(/\(e\.g\.\s*([^)]+)\)/);
  if (match) return match[1].trim();
  if (/starts with G/i.test(expectedFormat)) return 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';
  if (/One of:/i.test(expectedFormat)) return expectedFormat.replace(/^One of:\s*/i, '').split(',')[0].trim();
  if (/integer/i.test(expectedFormat)) return '1';
  if (/number/i.test(expectedFormat)) return '10.5';
  if (/string/i.test(expectedFormat)) return 'example';
  return 'See documentation';
}

/**
 * Format a single validation error into the standard structure.
 *
 * @param {string} code - Error code from ERROR_REGISTRY
 * @param {*} [receivedValue] - The value that was received (will be masked if sensitive)
 * @param {object} [overrides] - Optional overrides for field / expectedFormat
 * @param {string} [lang='en'] - Locale for the human-readable `message` (falls back to English)
 * @returns {{ code: string, field: string, message: string, receivedValue: *, expectedFormat: string, docLink: string }}
 */
function formatError(code, receivedValue, overrides = {}, lang = 'en') {
  const entry = ERROR_REGISTRY[code] || { field: 'unknown', expectedFormat: 'See documentation', description: code };
  const field = overrides.field || entry.field;
  const expectedFormat = overrides.expectedFormat || entry.expectedFormat;
  const message = getMessage(code, lang) || entry.description;

  const masked = isSensitive(field) ? maskValue(receivedValue) : receivedValue;

  return {
    code,
    field,
    message,
    receivedValue: masked !== undefined ? masked : null,
    expectedFormat,
    docLink: `${DOCS_BASE}#${code.toLowerCase()}`,
  };
}

/**
 * Build a standard 400 error response body with one or more field errors.
 *
 * @param {Array<{code: string, receivedValue?: *, overrides?: object}>} errors
 * @param {string|import('express').Request} [langOrReq='en'] - A locale code, or a request
 *   object to derive one from via its Accept-Language header. Existing callers that omit
 *   this keep getting English messages, so this is backward compatible.
 * @returns {{ success: false, errors: object[] }}
 */
function buildErrorResponse(errors, langOrReq = 'en') {
  const lang =
    langOrReq && typeof langOrReq === 'object'
      ? parseLanguage(langOrReq.headers && langOrReq.headers['accept-language'])
      : parseLanguage(langOrReq);

  return {
    success: false,
    errors: errors.map(({ code, receivedValue, overrides }) => formatError(code, receivedValue, overrides, lang)),
  };
}

function formatRequiredError(fieldPath, rules) {
  return { field: fieldPath, message: `${fieldPath} is required`, code: 'REQUIRED', constraint: 'required', value: null, expected: 'required', example: 'example' };
}

function formatNullError(fieldPath, rules) {
  return { field: fieldPath, message: `${fieldPath} cannot be null`, code: 'NULL_NOT_ALLOWED', constraint: 'notNull', value: null, expected: 'non-null value', example: 'example' };
}

function formatTypeError(fieldPath, value, expectedTypes, rules) {
  const types = Array.isArray(expectedTypes) ? expectedTypes.join(', ') : expectedTypes;
  return { 
    field: fieldPath, 
    message: `${fieldPath} must be of type ${types}`, 
    code: 'INVALID_TYPE', 
    constraint: 'type',
    value: isSensitive(fieldPath) ? maskValue(value) : value,
    expected: types,
    example: exampleFor(types)
  };
}

function formatEnumError(fieldPath, value, enumValues) {
  return { 
    field: fieldPath, 
    message: `${fieldPath} must be one of: ${enumValues.join(', ')}`, 
    code: 'INVALID_ENUM', 
    constraint: 'enum',
    value: isSensitive(fieldPath) ? maskValue(value) : value,
    expected: enumValues.join(', '),
    example: enumValues[0]
  };
}

function formatLengthError(fieldPath, value, minLength, maxLength) {
  const msg = minLength !== undefined && maxLength !== undefined
    ? `${fieldPath} length must be between ${minLength} and ${maxLength}`
    : minLength !== undefined ? `${fieldPath} must be at least ${minLength} characters`
    : `${fieldPath} must not exceed ${maxLength} characters`;
  const constraint = minLength !== undefined && maxLength !== undefined
    ? 'length'
    : minLength !== undefined ? 'minLength' : 'maxLength';
  return { field: fieldPath, message: msg, code: 'INVALID_LENGTH', constraint, value: isSensitive(fieldPath) ? maskValue(value) : value, expected: constraint, example: 'example' };
}

function formatRangeError(fieldPath, value, min, max) {
  const msg = min !== undefined && max !== undefined
    ? `${fieldPath} must be between ${min} and ${max}`
    : min !== undefined ? `${fieldPath} must be at least ${min}`
    : `${fieldPath} must not exceed ${max}`;
  const constraint = min !== undefined && max !== undefined
    ? 'range'
    : min !== undefined ? 'min' : 'max';
  return { field: fieldPath, message: msg, code: 'INVALID_RANGE', constraint, value: isSensitive(fieldPath) ? maskValue(value) : value, expected: constraint, example: min !== undefined ? String(min) : String(max) };
}

module.exports = {
  ERROR_REGISTRY,
  SENSITIVE_FIELDS,
  maskValue,
  isSensitive,
  formatError,
  buildErrorResponse,
  formatRequiredError,
  formatNullError,
  formatTypeError,
  formatEnumError,
  formatLengthError,
  formatRangeError,
};
