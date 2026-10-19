'use strict';

/**
 * Typed environment configuration (#1784)
 *
 * RESPONSIBILITY: Parse every variable declared in ./envSchema.js into its
 *   typed value, validate the result once with Ajv, and expose it as a frozen
 *   object.
 * OWNER: Platform Team
 * DEPENDENCIES: ajv, ./envSchema
 *
 * Usage:
 *   const { env } = require('../config/env');
 *   const max = env.SSE_MAX_CONNECTIONS_PER_KEY; // number, default applied
 *
 * `env` is computed when this module is first required. Code that has to see
 * changes made to process.env after startup (mostly tests) can call
 * `readEnv(name)`, which parses a single variable on demand using the same
 * rules and default.
 *
 * Direct `process.env` reads outside src/config are being phased out; see the
 * `no-restricted-properties` rule in .eslintrc.js.
 */

// Same .env as src/config/index.js; dotenv never overrides variables that are already set.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const Ajv = require('ajv');
const { ENV_VARS, ENV_VAR_PATTERNS } = require('./envSchema');

const BY_NAME = new Map(ENV_VARS.map((v) => [v.name, v]));

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
// Fixed-shape, anchored patterns — linear time.
const INTEGER_RE = /^[-+]?\d+$/;

/** Marker for a raw value that could not be converted to the declared type. */
class Invalid {
  constructor(raw, reason) {
    this.raw = raw;
    this.reason = reason;
  }
}

function isUnset(raw) {
  return raw === undefined || raw === null || String(raw).trim() === '';
}

/**
 * Convert one raw string to the declared type.
 * Returns the default when unset and an `Invalid` marker when unparsable.
 */
function coerce(def, raw) {
  if (isUnset(raw)) {
    return def.default === undefined ? undefined : coerce({ ...def, default: undefined }, String(def.default));
  }
  const value = String(raw).trim();

  switch (def.type) {
    case 'integer':
      return INTEGER_RE.test(value) ? Number(value) : new Invalid(value, 'must be an integer');
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : new Invalid(value, 'must be a number');
    }
    case 'boolean': {
      const lower = value.toLowerCase();
      if (TRUE_VALUES.has(lower)) return true;
      if (FALSE_VALUES.has(lower)) return false;
      return new Invalid(value, 'must be "true" or "false"');
    }
    case 'list':
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    case 'url':
      try {
        new URL(value);
        return value;
      } catch (_) {
        return new Invalid(value, 'must be a valid URL');
      }
    case 'json':
      try {
        return JSON.parse(value);
      } catch (_) {
        return new Invalid(value, 'must be valid JSON');
      }
    default:
      return value;
  }
}

/** Build the Ajv schema that the coerced values must satisfy. */
function buildJsonSchema() {
  const properties = {};
  for (const def of ENV_VARS) {
    const prop = {};
    switch (def.type) {
      case 'integer': prop.type = 'integer'; break;
      case 'number': prop.type = 'number'; break;
      case 'boolean': prop.type = 'boolean'; break;
      case 'list': prop.type = 'array'; prop.items = { type: 'string' }; break;
      case 'json': break; // any JSON value
      case 'enum': prop.type = 'string'; prop.enum = def.enum; break;
      default: prop.type = 'string';
    }
    if (def.min !== undefined) prop.minimum = def.min;
    if (def.max !== undefined) prop.maximum = def.max;
    properties[def.name] = prop;
  }
  return { type: 'object', properties, additionalProperties: true };
}

let _validate = null;
function getValidator() {
  if (!_validate) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    _validate = ajv.compile(buildJsonSchema());
  }
  return _validate;
}

function describeAjvError(err, values, source) {
  const name = err.instancePath.replace(/^\//, '').split('/')[0];
  const def = BY_NAME.get(name);
  const shown = def && def.secret ? '<redacted>' : JSON.stringify(source[name] ?? values[name]);
  if (err.keyword === 'enum') {
    return `${name} must be one of: ${err.params.allowedValues.join(', ')}. Received: ${shown}`;
  }
  return `${name} ${err.message}. Received: ${shown}`;
}

/**
 * Parse and validate every declared variable from `source`.
 *
 * @param {object} [source=process.env]
 * @returns {{ values: object, errors: string[] }} `values` is frozen.
 */
function loadEnv(source = process.env) {
  const values = {};
  const errors = [];
  const nodeEnv = String(source.NODE_ENV || 'development').toLowerCase();

  for (const def of ENV_VARS) {
    const raw = source[def.name];

    if (isUnset(raw)) {
      if (def.required === 'always' || (def.required === 'production' && nodeEnv === 'production')) {
        errors.push(`${def.name} is required but was not set.`);
      }
    }

    const parsed = coerce(def, raw);
    if (parsed instanceof Invalid) {
      const shown = def.secret ? '<redacted>' : JSON.stringify(parsed.raw);
      errors.push(`${def.name} ${parsed.reason}. Received: ${shown}`);
      continue;
    }
    if (parsed !== undefined) values[def.name] = parsed;
  }

  const validate = getValidator();
  if (!validate(values)) {
    for (const err of validate.errors) errors.push(describeAjvError(err, values, source));
  }

  return { values: Object.freeze(values), errors };
}

/**
 * Validate the environment and return a list of human-readable errors.
 *
 * @param {object} [source=process.env]
 * @returns {string[]}
 */
function validateEnv(source = process.env) {
  return loadEnv(source).errors;
}

/**
 * Read one declared variable from the live environment, applying its type and
 * default. Invalid values fall back to the default (validation reports them at
 * startup). Throws for names missing from the schema so new reads cannot skip
 * documentation.
 *
 * @param {string} name
 * @param {object} [source=process.env]
 * @returns {*}
 */
function readEnv(name, source = process.env) {
  const def = BY_NAME.get(name) || matchPattern(name);
  if (!def) {
    throw new Error(`Environment variable ${name} is not declared in src/config/envSchema.js`);
  }
  const parsed = coerce(def, source[name]);
  if (parsed instanceof Invalid) return coerce(def, undefined);
  return parsed;
}

function matchPattern(name) {
  const p = ENV_VAR_PATTERNS.find((x) => x.pattern.test(name));
  return p ? { name, type: 'string' } : null;
}

/** Whether `name` is declared in the schema (directly or via a pattern). */
function isDeclared(name) {
  return BY_NAME.has(name) || Boolean(matchPattern(name));
}

const { values: env } = loadEnv(process.env);

module.exports = {
  env,
  loadEnv,
  validateEnv,
  readEnv,
  isDeclared,
  buildJsonSchema,
};
