/**
 * Unique ID generator for test fixtures
 *
 * RESPONSIBILITY: Produce collision-safe identifiers for test data
 * OWNER: QA/Testing Team
 *
 * Why this exists:
 * When tests create records with hard-coded IDs or public keys they risk colliding
 * with records from other test files running in the same Jest worker. This module
 * provides lightweight helpers that combine a monotonic counter with
 * process.hrtime() so every value is unique within the process lifetime.
 *
 * @example
 * const { uniqueId, uniquePublicKey, uniqueKeyName } = require('./uniqueId');
 * const id   = uniqueId();                  // 'tid_1_1234567890123'
 * const pk   = uniquePublicKey();           // 'G_TEST_1_1234567890123_AAAAAAA…' (56-char hex-ish)
 * const name = uniqueKeyName('admin-key');  // 'admin-key_1_1234567890123'
 */

'use strict';

let _counter = 0;

/**
 * Return a monotonically increasing test-ID string.
 * Format: `tid_<counter>_<hrtime-ns>`
 * @returns {string}
 */
function uniqueId() {
  _counter += 1;
  // hrtime returns [seconds, nanoseconds]; combine for sub-millisecond uniqueness
  const [, ns] = process.hrtime();
  return `tid_${_counter}_${ns}`;
}

/**
 * Return a unique, fake Stellar-like public key.
 * Keys are padded to 56 characters so they pass simple length checks.
 * They are NOT valid on the Stellar network — they are mock values only.
 * @returns {string}
 */
function uniquePublicKey() {
  _counter += 1;
  const [, ns] = process.hrtime();
  const base = `GTEST${_counter}X${ns}`;
  // Pad / truncate to exactly 56 chars (standard Stellar public key length)
  return base.toUpperCase().padEnd(56, '0').slice(0, 56);
}

/**
 * Return a unique name string suitable for API keys, wallet names, etc.
 * @param {string} [prefix='test']
 * @returns {string}
 */
function uniqueKeyName(prefix = 'test') {
  _counter += 1;
  const [, ns] = process.hrtime();
  return `${prefix}_${_counter}_${ns}`;
}

/**
 * Reset the internal counter (use only in test-reset helpers, not individual tests).
 * Normally you do NOT need to call this — the per-worker counter is already isolated.
 */
function _resetCounter() {
  _counter = 0;
}

module.exports = { uniqueId, uniquePublicKey, uniqueKeyName, _resetCounter };
