'use strict';

/**
 * Hardened CSV serializer (Issue #1114)
 *
 * Handles:
 * - Embedded commas, double-quotes, newlines, carriage returns
 * - Formula-injection neutralization (=, +, -, @, tab, carriage-return prefixes)
 * - UTF-8 BOM prefix for correct Excel opening
 * - Consistent quoting rules across all CSV producers
 */

/** Characters that trigger formula injection in spreadsheet apps */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Escape a single CSV field value.
 *
 * Rules:
 *  1. Null / undefined → empty string
 *  2. Objects → JSON-stringified
 *  3. Fields starting with a formula prefix get a leading single-quote neutralizer
 *  4. Fields containing comma, double-quote, newline, or carriage-return are
 *     wrapped in double-quotes; internal double-quotes are doubled
 *
 * @param {*} value - The raw field value
 * @returns {string} Safe CSV field (may or may not be quoted)
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';

  let str;
  if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  // Neutralize formula-injection prefixes
  if (FORMULA_PREFIXES.has(str.charAt(0))) {
    str = `'${str}`;
  }

  // Quote if the field contains special characters
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Serialize an array of row objects to a CSV string.
 *
 * @param {string[]} headers      - Ordered list of column names (used as header row and object keys)
 * @param {Object[]} rows         - Array of plain objects; missing keys become empty strings
 * @param {Object}  [options]
 * @param {boolean} [options.bom=false]   - Prepend UTF-8 BOM (for Excel compatibility)
 * @param {string}  [options.delimiter=','] - Field delimiter (default comma)
 * @param {string}  [options.lineEnding='\n'] - Row terminator (default LF)
 * @returns {string} Complete CSV text
 */
function serialize(headers, rows, options = {}) {
  const {
    bom = false,
    delimiter = ',',
    lineEnding = '\n',
  } = options;

  const output = [];

  if (bom) {
    output.push('\uFEFF');
  }

  // Header row
  output.push(headers.map(h => escapeField(h)).join(delimiter));

  // Data rows
  for (const row of rows) {
    const cells = headers.map(h => escapeField(row[h]));
    output.push(cells.join(delimiter));
  }

  return output.join(lineEnding);
}

module.exports = { escapeField, serialize };
