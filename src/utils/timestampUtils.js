/**
 * Timestamp Utility
 *
 * RESPONSIBILITY: Normalise all timestamp values to ISO 8601 UTC strings before
 *                 they leave the API layer.
 * OWNER: Backend Team
 * DEPENDENCIES: None
 *
 * Problem being solved
 * --------------------
 * SQLite stores DATETIME values as `YYYY-MM-DD HH:MM:SS` (no `T` separator, no
 * trailing `Z`) when written via `DEFAULT CURRENT_TIMESTAMP` or raw SQL inserts.
 * Horizon (Stellar) returns timestamps as RFC 3339 strings that already carry a
 * timezone designator (`Z` or `+00:00`).  Returning the raw DB value from an
 * API endpoint produces an inconsistent mix of formats that forces every
 * consumer to normalise on their side and is a common source of timezone bugs.
 *
 * This module provides a single, safe conversion function so every route can
 * call `toISOStringUTC(rawValue)` and get back a guaranteed `YYYY-MM-DDTHH:mm:ss.sssZ`
 * string — or `null` when the input is absent / unparseable.
 *
 * Usage
 * -----
 *   const { toISOStringUTC } = require('../utils/timestampUtils');
 *
 *   // Raw SQLite value  →  ISO 8601 UTC
 *   toISOStringUTC('2024-05-01 13:45:00')   // "2024-05-01T13:45:00.000Z"
 *
 *   // Already ISO (Horizon)  →  unchanged shape, still ISO
 *   toISOStringUTC('2024-05-01T13:45:00Z')  // "2024-05-01T13:45:00.000Z"
 *
 *   // Missing / null  →  null
 *   toISOStringUTC(null)                    // null
 *   toISOStringUTC(undefined)               // null
 *
 *   // Unparseable string  →  null (never throws)
 *   toISOStringUTC('not-a-date')            // null
 */

/**
 * Convert any timestamp representation to an ISO 8601 UTC string.
 *
 * Handles:
 *  - SQLite `YYYY-MM-DD HH:MM:SS` (assumed UTC, treated as `YYYY-MM-DDTHH:MM:SSZ`)
 *  - JavaScript Date objects
 *  - Existing ISO 8601 strings (passed through after normalisation)
 *  - Unix epoch numbers (milliseconds or seconds — anything < 1e12 is treated
 *    as seconds to distinguish 10-digit epoch-s from 13-digit epoch-ms)
 *  - null / undefined → returns null
 *  - Unparseable input → returns null (never throws)
 *
 * @param {string|number|Date|null|undefined} value - Raw timestamp value
 * @returns {string|null} ISO 8601 UTC string or null
 */
function toISOStringUTC(value) {
  if (value === null || value === undefined) return null;

  // Already a Date object
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }

  // Numeric epoch — distinguish seconds (10 digits) from milliseconds (13 digits)
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS"
  // JavaScript's Date parser treats this as local time on most runtimes.
  // We rewrite it to an unambiguous UTC ISO string before parsing.
  const sqliteDateRe = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
  if (sqliteDateRe.test(trimmed)) {
    // Append 'Z' to tell the JS engine this is UTC, not local time
    const d = new Date(trimmed.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // All other strings — ISO 8601, RFC 3339, etc.
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { toISOStringUTC };
