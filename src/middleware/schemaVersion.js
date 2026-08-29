/**
 * Schema Version Middleware
 *
 * RESPONSIBILITY: Parse and normalise the X-Schema-Version request header, then
 * expose it on req.schemaVersion for downstream schema validation.
 *
 * VERSIONING CONTRACT (single, authoritative):
 *   - URL path   (/api/v{MAJOR}) governs the *API surface version* and changes
 *     only on a MAJOR (breaking) release.  All current routes live under /api/v1.
 *   - X-Schema-Version header governs the *request-body schema variant* used by
 *     a specific endpoint.  Values are full semver strings (e.g. "1.0.0", "2.0.0").
 *
 * These two mechanisms serve distinct concerns and must not be conflated:
 *   - Omitting X-Schema-Version is fine; the endpoint will use the latest schema.
 *   - Providing an integer like "1" is accepted and normalised to "1.0.0" for
 *     backward compatibility with older clients.
 *   - An unparseable or out-of-range value is stored as-is so that schemaValidation
 *     can return a descriptive 400 error rather than a generic one here.
 *
 * What this middleware does NOT do:
 *   - It does not select a schema — that is schemaValidation's job.
 *   - It does not govern routing — that is the URL path's job.
 *   - It does not impose any Accept-Version / API version negotiation on the path.
 */

'use strict';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const INTEGER_RE = /^\d+$/;

/**
 * The current (latest) schema version understood by this API.
 * Downstream consumers can import this constant to determine whether a request
 * was submitted with an older schema and therefore requires transformation.
 */
const CURRENT_SCHEMA_VERSION = '2.0.0';

/**
 * Transformation table mapping "fromVersion:toVersion" composite keys to arrays
 * of field-level transformation descriptors.
 *
 * Supported actions:
 *   - rename:  rename `field` to `newField`
 *   - default: set `field` to `defaultValue` when it is absent from the body
 *   - remove:  delete `field` from the body
 *
 * Transformations within each array are applied in order, so renaming a field
 * before referencing the new name is safe.
 */
const SCHEMA_TRANSFORMATIONS = {
  // ── v1.0.0 → v2.0.0 ──────────────────────────────────────────────────────
  '1.0.0:2.0.0': [
    { field: 'donor_name',        action: 'rename',  newField: 'donorName' },
    { field: 'recipient_address', action: 'rename',  newField: 'recipient' },
    { field: 'amount_xlm',        action: 'rename',  newField: 'amount' },
    { field: 'currency',          action: 'default', defaultValue: 'XLM' }
  ],

  // ── v1.1.0 → v2.0.0 ──────────────────────────────────────────────────────
  // Normalise any remaining legacy field names that may appear in 1.1.x bodies.
  '1.1.0:2.0.0': [
    { field: 'donor_name',        action: 'rename',  newField: 'donorName' },
    { field: 'recipient_address', action: 'rename',  newField: 'recipient' },
    { field: 'amount_xlm',        action: 'rename',  newField: 'amount' },
    { field: 'currency',          action: 'default', defaultValue: 'XLM' }
  ]
};

/**
 * Apply schema transformations to a request body, upgrading it from
 * `fromVersion` to `toVersion`.
 *
 * Rules are looked up via the composite key "fromVersion:toVersion" in
 * SCHEMA_TRANSFORMATIONS.  When no rule is found (unknown version pair or
 * identical versions) the body is returned unchanged.
 *
 * The original body object is never mutated — a shallow clone is made before
 * any transformation is applied.
 *
 * @param {Object} body         - Original request body object.
 * @param {string} fromVersion  - Source schema version (e.g. "1.0.0").
 * @param {string} toVersion    - Target schema version (e.g. "2.0.0").
 * @returns {Object} Transformed body (or the original when no rules apply).
 */
function transformRequestBody(body, fromVersion, toVersion) {
  if (!body || typeof body !== 'object') return body;

  // Identity transform — nothing to do
  if (fromVersion === toVersion) return body;

  const key = `${fromVersion}:${toVersion}`;
  const rules = SCHEMA_TRANSFORMATIONS[key];

  // No transformation rules defined for this version pair
  if (!rules || rules.length === 0) return body;

  // Shallow-clone so we never mutate the original body
  const transformed = Object.assign({}, body);

  for (const rule of rules) {
    switch (rule.action) {
      case 'rename':
        if (Object.prototype.hasOwnProperty.call(transformed, rule.field)) {
          transformed[rule.newField] = transformed[rule.field];
          delete transformed[rule.field];
        }
        break;

      case 'default':
        if (!Object.prototype.hasOwnProperty.call(transformed, rule.field)) {
          transformed[rule.field] = rule.defaultValue;
        }
        break;

      case 'remove':
        delete transformed[rule.field];
        break;

      default:
        // Unknown action — skip silently to remain forward-compatible
        break;
    }
  }

  return transformed;
}

/**
 * Normalise a raw X-Schema-Version value to a semver string, or return
 * the raw value unchanged when it cannot be normalised (so downstream
 * validators can reject it with a proper error message).
 *
 * @param {string} raw - Raw header value.
 * @returns {string} Normalised semver string or original raw value.
 */
function normaliseSchemaVersion(raw) {
  if (!raw) return '1.0.0'; // default: latest stable schema

  const trimmed = raw.trim();

  // Already a valid semver — pass through as-is
  if (SEMVER_RE.test(trimmed)) return trimmed;

  // Integer shorthand (e.g. "1", "2") — expand to x.0.0
  if (INTEGER_RE.test(trimmed)) {
    const major = parseInt(trimmed, 10);
    if (major >= 1) return `${major}.0.0`;
  }

  // Unrecognised format — return raw so schemaValidation can reject it properly
  return trimmed;
}

/**
 * Express middleware that attaches a normalised schema version to every request
 * and, when the request schema differs from the current version, also attaches
 * a transformed copy of the request body.
 *
 * Sets:
 *   req.schemaVersion    {string}  — semver string, consumed by validateSchema()
 *   req.transformedBody  {Object}  — body transformed to CURRENT_SCHEMA_VERSION
 *                                    (only set when fromVersion !== current)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function schemaVersionMiddleware(req, res, next) {
  const version = normaliseSchemaVersion(req.get('X-Schema-Version'));
  req.schemaVersion = version;

  // Attach a transformed body when the client is on an older schema
  if (version !== CURRENT_SCHEMA_VERSION && req.body && typeof req.body === 'object') {
    req.transformedBody = transformRequestBody(req.body, version, CURRENT_SCHEMA_VERSION);
  }

  next();
}

module.exports = schemaVersionMiddleware;
module.exports.normaliseSchemaVersion = normaliseSchemaVersion;
module.exports.transformRequestBody = transformRequestBody;
module.exports.SCHEMA_TRANSFORMATIONS = SCHEMA_TRANSFORMATIONS;
module.exports.CURRENT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
