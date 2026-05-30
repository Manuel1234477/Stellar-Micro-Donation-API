/**
 * Field Filter Middleware
 *
 * RESPONSIBILITY: Parse the `?fields` query parameter and trim API responses
 *                 to only the requested fields, supporting dot-notation for
 *                 nested paths (e.g. fields=id,wallet.address).
 * OWNER: Backend Team
 *
 * Flow:
 * 1. Parse `?fields` — split on commas, validate each path segment.
 * 2. If any path is invalid, return 400 immediately.
 * 3. Wrap `res.json` to apply the filter before sending.
 * 4. Set `X-Fields-Applied: true` when filtering is active.
 *
 * Security:
 * - Path segments are validated against /^[a-zA-Z0-9_]+$/ — no injection possible.
 * - Sensitive fields can be added to BLOCKED_FIELDS to prevent exposure.
 */

const { ValidationError } = require('../utils/errors');

/**
 * Fields that can never be selected, regardless of the `?fields` parameter.
 * Add sensitive field names here to prevent accidental exposure.
 */
const BLOCKED_FIELDS = new Set(['password', 'secret', 'privateKey', 'secretKey']);

/**
 * Validate a single dot-notation field path.
 * Each segment must be a non-empty alphanumeric/underscore string.
 *
 * @param {string} path - e.g. "wallet.address"
 * @returns {boolean}
 */
function isValidFieldPath(path) {
  if (!path || typeof path !== 'string') return false;
  const segments = path.split('.');
  return segments.every(seg => /^[a-zA-Z0-9_]+$/.test(seg));
}

/**
 * Pick a nested value from an object using a dot-notation path array.
 *
 * @param {Object} obj
 * @param {string[]} segments - e.g. ['wallet', 'address']
 * @returns {*} The value at the path, or undefined if absent.
 */
function getNestedValue(obj, segments) {
  let current = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[seg];
  }
  return current;
}

/**
 * Set a nested value on an object, creating intermediate objects as needed.
 *
 * @param {Object} obj
 * @param {string[]} segments
 * @param {*} value
 */
function setNestedValue(obj, segments, value) {
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current[seg] === undefined || current[seg] === null || typeof current[seg] !== 'object') {
      current[seg] = {};
    }
    current = current[seg];
  }
  current[segments[segments.length - 1]] = value;
}

/**
 * Apply field filtering to a single object.
 *
 * @param {Object} obj - The object to filter.
 * @param {string[][]} fieldPaths - Array of segment arrays, e.g. [['id'], ['wallet', 'address']].
 * @returns {Object} A new object containing only the requested fields.
 */
function filterObject(obj, fieldPaths) {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result = {};
  for (const segments of fieldPaths) {
    const value = getNestedValue(obj, segments);
    if (value !== undefined) {
      setNestedValue(result, segments, value);
    }
  }
  return result;
}

/**
 * Apply field filtering to a response body.
 * Handles the standard `{ success, data }` envelope:
 * - If `data` is an array, filter each element.
 * - If `data` is an object, filter it directly.
 * - Top-level fields outside `data` (e.g. `success`, `count`, `meta`) are preserved.
 *
 * @param {*} body - The full response body.
 * @param {string[][]} fieldPaths - Parsed field paths.
 * @returns {*} The filtered body.
 */
function applyFilter(body, fieldPaths) {
  if (!body || typeof body !== 'object') return body;

  // If the body has a `data` envelope, filter inside it
  if ('data' in body) {
    const filtered = { ...body };
    if (Array.isArray(body.data)) {
      filtered.data = body.data.map(item => filterObject(item, fieldPaths));
    } else if (body.data && typeof body.data === 'object') {
      filtered.data = filterObject(body.data, fieldPaths);
    }
    return filtered;
  }

  // No envelope — filter the body directly
  return filterObject(body, fieldPaths);
}

/**
 * Express middleware that parses `?fields` and applies response field filtering.
 *
 * Usage:
 *   GET /donations?fields=id,amount,status
 *   GET /wallets?fields=id,address,balance
 *   GET /donations?fields=id,donor.name   (dot notation)
 *
 * Returns 400 if any field path is invalid or references a blocked field.
 * Sets `X-Fields-Applied: true` when filtering is active.
 *
 * @returns {import('express').RequestHandler}
 */
function fieldFilterMiddleware() {
  return function fieldFilter(req, res, next) {
    const fieldsParam = req.query.fields;

    // No ?fields param — pass through unchanged
    if (!fieldsParam || typeof fieldsParam !== 'string' || fieldsParam.trim() === '') {
      return next();
    }

    // Parse and validate field paths
    const rawPaths = fieldsParam.split(',').map(f => f.trim()).filter(Boolean);

    for (const path of rawPaths) {
      if (!isValidFieldPath(path)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FIELD_PATH',
            message: `Invalid field path: "${path}". Field paths must contain only alphanumeric characters, underscores, and dots.`,
          },
        });
      }

      const topLevel = path.split('.')[0];
      if (BLOCKED_FIELDS.has(topLevel)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FIELD_PATH',
            message: `Field "${topLevel}" is not accessible.`,
          },
        });
      }
    }

    // Convert paths to segment arrays once
    const fieldPaths = rawPaths.map(p => p.split('.'));

    // Wrap res.json to intercept and filter the response
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      res.setHeader('X-Fields-Applied', 'true');
      return originalJson(applyFilter(body, fieldPaths));
    };

    next();
  };
}

module.exports = {
  fieldFilterMiddleware,
  filterObject,
  applyFilter,
  isValidFieldPath,
};
