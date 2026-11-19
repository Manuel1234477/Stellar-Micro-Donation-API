'use strict';

/**
 * Federation Record Service (issue #1938)
 *
 * RESPONSIBILITY: Validation and persistence for SEP-0002 federation records
 * OWNER: Backend Team
 * DEPENDENCIES: Database, Stellar SDK boundary (services/stellar/sdk.js)
 *
 * Records map a federation name (the part before `*domain`) to a Stellar
 * account and optional memo. They live in the `federation_records` table so
 * admins can change them at runtime. The FEDERATION_RECORDS env var is only an
 * optional seed.
 */

const { StrKey } = require('./stellar/sdk.js');
const Database = require('../utils/database');

const NAME_PATTERN = /^[a-z0-9._-]{1,64}$/;
const MEMO_TYPES = ['text', 'id', 'hash'];
const TEXT_MEMO_MAX_BYTES = 28;
const UINT64_MAX = (1n << 64n) - 1n;

/**
 * Validate one federation record.
 * @param {{ name?: string, account_id?: string, memo_type?: string|null, memo?: string|null }} input
 * @returns {{ valid: boolean, errors: string[], value: { name: string, account_id: string, memo_type: string|null, memo: string|null } | null }}
 */
function validateRecord(input = {}) {
  const errors = [];
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
  const accountId = typeof input.account_id === 'string' ? input.account_id.trim() : '';
  const memoType = input.memo_type == null || input.memo_type === '' ? null : String(input.memo_type).trim().toLowerCase();
  const memo = input.memo == null || input.memo === '' ? null : String(input.memo);

  if (!NAME_PATTERN.test(name)) {
    errors.push('name must be 1-64 characters of lowercase letters, digits, "." "_" or "-"');
  }

  if (!StrKey.isValidEd25519PublicKey(accountId)) {
    errors.push('account_id must be a valid Stellar public key (G...)');
  }

  if (memoType !== null && !MEMO_TYPES.includes(memoType)) {
    errors.push(`memo_type must be one of: ${MEMO_TYPES.join(', ')}`);
  }

  if (memoType === null && memo !== null) {
    errors.push('memo requires memo_type');
  }

  if (memoType !== null && memo === null) {
    errors.push('memo_type requires memo');
  }

  if (memoType !== null && memo !== null) {
    const memoError = validateMemo(memoType, memo);
    if (memoError) errors.push(memoError);
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }
  return {
    valid: true,
    errors: [],
    value: { name, account_id: accountId, memo_type: memoType, memo },
  };
}

/**
 * SEP-0002 memo rules: text <= 28 bytes, id is a uint64 decimal string,
 * hash is 32 bytes encoded as 64 hex characters or base64.
 * @returns {string|null} error message, or null when valid
 */
function validateMemo(memoType, memo) {
  if (memoType === 'text') {
    return Buffer.byteLength(memo, 'utf8') <= TEXT_MEMO_MAX_BYTES
      ? null
      : `text memo must be at most ${TEXT_MEMO_MAX_BYTES} bytes`;
  }
  if (memoType === 'id') {
    if (!/^\d+$/.test(memo) || BigInt(memo) > UINT64_MAX) {
      return 'id memo must be an unsigned 64-bit integer';
    }
    return null;
  }
  // hash
  if (/^[0-9a-fA-F]{64}$/.test(memo)) return null;
  if (/^[A-Za-z0-9+/]{43}=$/.test(memo) && Buffer.from(memo, 'base64').length === 32) return null;
  return 'hash memo must be 32 bytes encoded as 64 hex characters or base64';
}

function toPublic(row) {
  return {
    name: row.name,
    account_id: row.account_id,
    memo_type: row.memo_type || null,
    memo: row.memo || null,
  };
}

/**
 * List records ordered by name for stable paging.
 * @param {{ limit?: number, offset?: number }} [page]
 */
async function list({ limit = 50, offset = 0 } = {}) {
  const rows = await Database.query(
    'SELECT name, account_id, memo_type, memo FROM federation_records ORDER BY name ASC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return rows.map(toPublic);
}

async function getByName(name) {
  const row = await Database.get(
    'SELECT name, account_id, memo_type, memo FROM federation_records WHERE name = ?',
    [String(name).toLowerCase()]
  );
  return row ? toPublic(row) : null;
}

/**
 * Reverse lookup (SEP-0002 type=id): the first name, in name order, for an account.
 */
async function getByAccountId(accountId) {
  const row = await Database.get(
    'SELECT name, account_id, memo_type, memo FROM federation_records WHERE account_id = ? ORDER BY name ASC LIMIT 1',
    [accountId]
  );
  return row ? toPublic(row) : null;
}

/**
 * Insert a validated record. Returns { conflict: true } if the name exists.
 */
async function create(record) {
  const existing = await getByName(record.name);
  if (existing) return { conflict: true };
  await Database.run(
    'INSERT INTO federation_records (name, account_id, memo_type, memo) VALUES (?, ?, ?, ?)',
    [record.name, record.account_id, record.memo_type, record.memo]
  );
  return { record: await getByName(record.name) };
}

/**
 * Update a record in place. Fields omitted from `patch` keep their stored value.
 * Returns { notFound: true } when the name does not exist.
 */
async function update(name, patch) {
  const current = await getByName(name);
  if (!current) return { notFound: true };
  const merged = validateRecord({ ...current, ...patch, name: current.name });
  if (!merged.valid) return { invalid: merged.errors };
  await Database.run(
    'UPDATE federation_records SET account_id = ?, memo_type = ?, memo = ? WHERE name = ?',
    [merged.value.account_id, merged.value.memo_type, merged.value.memo, current.name]
  );
  return { record: await getByName(current.name) };
}

/**
 * Delete a record. Returns true when a row was removed.
 */
async function remove(name) {
  const result = await Database.run(
    'DELETE FROM federation_records WHERE name = ?',
    [String(name).toLowerCase()]
  );
  return (result?.changes || 0) > 0;
}

module.exports = {
  validateRecord,
  validateMemo,
  list,
  getByName,
  getByAccountId,
  create,
  update,
  remove,
  MEMO_TYPES,
};
