/**
 * Wallet Model - Data Access Layer (SQLite-backed)
 * No longer reads from or writes to data/wallets.json.
 */

const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');

/** Encrypted field names on wallet records */
const ENCRYPTED_FIELDS = ['label', 'notes'];
let _schemaReady = false;
let _schemaPromise = null;

function getEncryptionService() {
  return require('../services/EncryptionService');
}

function isEncryptionEnabled() {
  return Boolean(process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY_1);
}

function isEncryptionFlagSet(wallet, field) {
  const value = wallet?.[`${field}_encrypted`];
  return value === true || value === 1 || value === '1';
}

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith('v');
}

async function ensureWalletSchema() {
  if (_schemaReady) return;
  if (_schemaPromise) return _schemaPromise;

  _schemaPromise = (async () => {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        label TEXT,
        ownerName TEXT,
        notes TEXT,
        leaderboard_visibility INTEGER DEFAULT 1,
        last_synced_at TEXT,
        last_cursor TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        deletedAt TEXT,
        label_encrypted INTEGER DEFAULT 0,
        notes_encrypted INTEGER DEFAULT 0,
        donation_limit_min INTEGER,
        donation_limit_max INTEGER
      )
    `);

    const columns = await Database.all('PRAGMA table_info(wallets)');
    const existingColumns = new Set(columns.map(column => column.name));

    if (!existingColumns.has('label_encrypted')) {
      await Database.run('ALTER TABLE wallets ADD COLUMN label_encrypted INTEGER DEFAULT 0');
    }
    if (!existingColumns.has('notes_encrypted')) {
      await Database.run('ALTER TABLE wallets ADD COLUMN notes_encrypted INTEGER DEFAULT 0');
    }
    if (!existingColumns.has('donation_limit_min')) {
      await Database.run('ALTER TABLE wallets ADD COLUMN donation_limit_min INTEGER');
    }
    if (!existingColumns.has('donation_limit_max')) {
      await Database.run('ALTER TABLE wallets ADD COLUMN donation_limit_max INTEGER');
    }
    if (!existingColumns.has('sdg_tags')) {
      await Database.run("ALTER TABLE wallets ADD COLUMN sdg_tags TEXT DEFAULT '[]'");
    }

    _schemaReady = true;
  })().catch(err => {
    _schemaPromise = null;
    throw err;
  });

  return _schemaPromise;
}

function encryptWalletFields(wallet) {
  const result = { ...wallet };
  const svc = getEncryptionService();
  for (const field of ENCRYPTED_FIELDS) {
    const stateKey = `${field}_encrypted`;
    const value = result[field];

    if (value == null) {
      result[stateKey] = 0;
      continue;
    }

    if (isEncryptedValue(value)) {
      result[stateKey] = 1;
      continue;
    }

    if (!isEncryptionEnabled()) {
      result[stateKey] = isEncryptionFlagSet(result, field) ? 1 : 0;
      continue;
    }

    result[field] = svc.encryptField(value);
    result[stateKey] = 1;
  }
  return result;
}

function decryptWalletFields(wallet) {
  if (!wallet) return wallet;
  const svc = getEncryptionService();
  const result = { ...wallet };
  for (const field of ENCRYPTED_FIELDS) {
    const stateKey = `${field}_encrypted`;
    const markedEncrypted = isEncryptionFlagSet(result, field) || isEncryptedValue(result[field]);
    if (result[field] != null && markedEncrypted) {
      try {
        result[field] = svc.decryptField(result[field]);
      } catch (err) {
        const error = new Error(`Unable to decrypt wallet field "${field}" for wallet ${result.id || 'unknown'}`);
        error.cause = err;
        throw error;
      }
    }
    result[stateKey] = markedEncrypted ? 1 : 0;
  }
  // Normalise leaderboard_visibility back to boolean
  if (result.leaderboard_visibility !== undefined) {
    result.leaderboard_visibility = result.leaderboard_visibility !== 0;
  }
  return result;
}

function rowToWallet(row) {
  if (!row) return null;
  const wallet = decryptWalletFields({ ...row });
  if (wallet.sdg_tags && typeof wallet.sdg_tags === 'string') {
    try {
      wallet.sdgTags = JSON.parse(wallet.sdg_tags);
    } catch (_) {
      wallet.sdgTags = [];
    }
  } else if (Array.isArray(wallet.sdg_tags)) {
    wallet.sdgTags = wallet.sdg_tags;
  } else if (Array.isArray(wallet.sdgTags)) {
    wallet.sdg_tags = JSON.stringify(wallet.sdgTags);
  } else {
    wallet.sdgTags = [];
  }
  return wallet;
}

class Wallet {
  static async create(walletData) {
    await ensureWalletSchema();
    const id = walletData.id || uuidv4();
    const now = new Date().toISOString();
    const sdgTags = walletData.sdgTags || walletData.sdg_tags || [];
    const sdgTagsStr = Array.isArray(sdgTags) ? JSON.stringify(sdgTags) : (typeof sdgTags === 'string' ? sdgTags : '[]');
    const record = encryptWalletFields({
      ...walletData,
      id,
      sdg_tags: sdgTagsStr,
      sdgTags: Array.isArray(sdgTags) ? sdgTags : [],
      createdAt: walletData.createdAt || now,
      deletedAt: null,
      last_synced_at: walletData.last_synced_at || null,
      last_cursor: walletData.last_cursor || null,
    });

    await Database.run(
      `INSERT INTO wallets
         (id, address, label, ownerName, notes, leaderboard_visibility, last_synced_at, last_cursor, createdAt, updatedAt, deletedAt, label_encrypted, notes_encrypted, donation_limit_min, donation_limit_max, sdg_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.address,
        record.label || null,
        record.ownerName || null,
        record.notes || null,
        record.leaderboard_visibility !== false ? 1 : 0,
        record.last_synced_at || null,
        record.last_cursor || null,
        record.createdAt,
        record.updatedAt || null,
        null,
        record.label_encrypted ? 1 : 0,
        record.notes_encrypted ? 1 : 0,
        record.donation_limit_min || null,
        record.donation_limit_max || null,
        sdgTagsStr,
      ]
    );

    return rowToWallet(record);
  }

  static async getAll() {
    await ensureWalletSchema();
    const rows = await Database.all('SELECT * FROM wallets WHERE deletedAt IS NULL');
    return rows.map(rowToWallet);
  }

  static async getById(id) {
    await ensureWalletSchema();
    const row = await Database.get(
      'SELECT * FROM wallets WHERE id = ? AND deletedAt IS NULL',
      [String(id)]
    );
    return rowToWallet(row);
  }

  static async getByAddress(address) {
    await ensureWalletSchema();
    const row = await Database.get(
      'SELECT * FROM wallets WHERE address = ? AND deletedAt IS NULL',
      [address]
    );
    return rowToWallet(row);
  }

  static async getAllDeleted() {
    await ensureWalletSchema();
    const rows = await Database.all('SELECT * FROM wallets WHERE deletedAt IS NOT NULL');
    return rows.map(rowToWallet);
  }

  static async update(id, updates) {
    await ensureWalletSchema();
    const existing = await this.getById(id);
    if (!existing) return null;

    const sdgTags = updates.sdgTags !== undefined ? updates.sdgTags : (updates.sdg_tags !== undefined ? updates.sdg_tags : existing.sdgTags);
    const sdgTagsStr = Array.isArray(sdgTags) ? JSON.stringify(sdgTags) : (typeof sdgTags === 'string' ? sdgTags : '[]');

    const merged = encryptWalletFields({
      ...existing,
      ...updates,
      sdg_tags: sdgTagsStr,
      sdgTags: Array.isArray(sdgTags) ? sdgTags : [],
      updatedAt: new Date().toISOString(),
    });

    await Database.run(
      `UPDATE wallets SET
         label = ?, ownerName = ?, notes = ?, leaderboard_visibility = ?,
         last_synced_at = ?, last_cursor = ?, updatedAt = ?, label_encrypted = ?, notes_encrypted = ?,
         donation_limit_min = ?, donation_limit_max = ?, sdg_tags = ?
       WHERE id = ? AND deletedAt IS NULL`,
      [
        merged.label || null,
        merged.ownerName || null,
        merged.notes || null,
        merged.leaderboard_visibility !== false ? 1 : 0,
        merged.last_synced_at || null,
        merged.last_cursor || null,
        merged.updatedAt,
        merged.label_encrypted ? 1 : 0,
        merged.notes_encrypted ? 1 : 0,
        merged.donation_limit_min || null,
        merged.donation_limit_max || null,
        sdgTagsStr,
        String(id),
      ]
    );

    return rowToWallet(merged);
  }

  static async softDelete(id) {
    await ensureWalletSchema();
    const result = await Database.run(
      'UPDATE wallets SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL',
      [new Date().toISOString(), String(id)]
    );
    return (result && result.changes > 0) || false;
  }

  /** Test helper — wipe all wallet data. */
  static async _clearAllData() {
    await ensureWalletSchema();
    await Database.run('DELETE FROM wallets');
  }
}

module.exports = Wallet;
module.exports.ENCRYPTED_FIELDS = ENCRYPTED_FIELDS;
module.exports.encryptWalletFields = encryptWalletFields;
module.exports.decryptWalletFields = decryptWalletFields;
