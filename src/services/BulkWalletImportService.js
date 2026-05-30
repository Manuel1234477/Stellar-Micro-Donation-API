/**
 * Bulk Wallet Import Service
 *
 * RESPONSIBILITY: Parse CSV/JSON files and atomically import wallet records.
 * OWNER: Backend Team
 * DEPENDENCIES: Wallet model, csv-parse, stellar-sdk
 */

const { parse } = require('csv-parse/sync');
const StellarSdk = require('stellar-sdk');
const Wallet = require('../routes/models/wallet');

const DEFAULT_MAX_ROWS = 1000;

/**
 * Parse a Buffer/string as JSON, returning an array of wallet objects.
 * @param {Buffer} buffer
 * @returns {Object[]}
 */
function parseJSON(buffer) {
  const parsed = JSON.parse(buffer.toString('utf8'));
  if (!Array.isArray(parsed)) throw new Error('JSON body must be an array');
  return parsed;
}

/**
 * Parse a Buffer/string as CSV, returning an array of wallet objects.
 * Expects a header row with at least a `public_key` column.
 * @param {Buffer} buffer
 * @returns {Object[]}
 */
function parseCSV(buffer) {
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
}

/**
 * Validate a single wallet row.
 * @param {Object} row
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
function validateRow(row) {
  if (row.secret_key !== undefined || row.private_key !== undefined) {
    return { valid: false, reason: 'private_key_not_accepted' };
  }
  if (!row.public_key || typeof row.public_key !== 'string') {
    return { valid: false, reason: 'missing_public_key' };
  }
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(row.public_key)) {
    return { valid: false, reason: 'invalid_address' };
  }
  return { valid: true };
}

class BulkWalletImportService {
  /**
   * Parse file buffer into an array of wallet objects.
   *
   * @param {Buffer} buffer - Raw file content.
   * @param {'application/json'|'text/csv'} mimeType - Content type of the file.
   * @returns {Object[]} Parsed rows.
   * @throws {Error} If the format is unsupported or parsing fails.
   */
  parseFile(buffer, mimeType) {
    if (mimeType === 'application/json' || mimeType === 'json') {
      return parseJSON(buffer);
    }
    if (mimeType === 'text/csv' || mimeType === 'csv') {
      return parseCSV(buffer);
    }
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  /**
   * Import wallets from a parsed array with full pre-validation and atomic rollback.
   *
   * Steps:
   * 1. Enforce row limit (BULK_IMPORT_MAX_ROWS env var, default 1000).
   * 2. Validate each row (public key format, no private keys).
   * 3. Detect intra-file duplicate public keys.
   * 4. If any row fails steps 2-3, abort immediately — zero records written.
   * 5. Wrap all Wallet.create() calls in a snapshot-based transaction:
   *    if any insert fails, roll back all previously inserted records.
   *
   * @param {Object[]} rows - Array of wallet objects (already parsed).
   * @returns {{
   *   totalSubmitted: number,
   *   totalCreated: number,
   *   details: Array<{ row: number, public_key: string, status: string, reason?: string }>
   * }}
   */
  importRows(rows) {
    const maxRows = parseInt(process.env.BULK_IMPORT_MAX_ROWS || DEFAULT_MAX_ROWS, 10);

    if (rows.length > maxRows) {
      const err = new Error(`File exceeds maximum row limit of ${maxRows}`);
      err.code = 'ROW_LIMIT_EXCEEDED';
      err.limit = maxRows;
      throw err;
    }

    // Pre-validation: validate all rows and detect duplicates before any DB write
    const seen = new Set();
    const validationErrors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const result = validateRow(row);
      if (!result.valid) {
        validationErrors.push({ row: i + 1, public_key: row.public_key || '', reason: result.reason });
        continue;
      }
      if (seen.has(row.public_key)) {
        validationErrors.push({ row: i + 1, public_key: row.public_key, reason: 'duplicate_in_file' });
        continue;
      }
      seen.add(row.public_key);
    }

    if (validationErrors.length > 0) {
      const err = new Error('Validation failed: one or more rows are invalid');
      err.code = 'VALIDATION_FAILED';
      err.details = validationErrors;
      throw err;
    }

    // Transactional insert: snapshot wallets.json, insert all, roll back on any failure
    const snapshot = Wallet.loadWallets();
    const details = [];
    const created = [];

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const wallet = Wallet.create({
          address: row.public_key,
          label: row.label || null,
          ownerName: row.owner_name || null,
        });
        created.push(wallet);
        details.push({ row: i + 1, public_key: row.public_key, status: 'created', id: wallet.id });
      }
    } catch (insertErr) {
      // Rollback: restore snapshot
      Wallet.saveWallets(snapshot);
      const err = new Error(`Insert failed, transaction rolled back: ${insertErr.message}`);
      err.code = 'INSERT_FAILED';
      throw err;
    }

    return {
      totalSubmitted: rows.length,
      totalCreated: created.length,
      details,
    };
  }

  /**
   * Parse a file buffer and import wallets atomically.
   *
   * @param {Buffer} buffer - Raw file content.
   * @param {'application/json'|'text/csv'} mimeType - Content type.
   * @returns {{ totalSubmitted: number, totalCreated: number, details: Object[] }}
   */
  importFile(buffer, mimeType) {
    const rows = this.parseFile(buffer, mimeType);
    return this.importRows(rows);
  }
}

module.exports = BulkWalletImportService;
