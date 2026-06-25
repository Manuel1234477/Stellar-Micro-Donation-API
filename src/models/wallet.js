/**
 * Wallet Model - Data Access Layer (SQLite-backed)
 * No longer reads from or writes to data/wallets.json.
 */

const { v4: uuidv4 } = require('uuid');
const Database = require('../utils/database');

/** Encrypted field names on wallet records */
const ENCRYPTED_FIELDS = ['label', 'notes'];

function getEncryptionService() {
  return require('../services/EncryptionService');
}

function encryptWalletFields(wallet) {
  if (!process.env.ENCRYPTION_KEY && !process.env.ENCRYPTION_KEY_1) return wallet;
  const svc = getEncryptionService();
  const result = { ...wallet };
  for (const field of ENCRYPTED_FIELDS) {
    if (result[field] != null) {
      result[field] = svc.encryptField(result[field]);
    }
  }
  return result;
}

function decryptWalletFields(wallet) {
  if (!wallet) return wallet;
  const svc = getEncryptionService();
  const result = { ...wallet };
  for (const field of ENCRYPTED_FIELDS) {
    if (result[field] != null) {
      try { result[field] = svc.decryptField(result[field]); } catch (_) { /* leave as-is */ }
    }
  }
  // Normalise leaderboard_visibility back to boolean
  if (result.leaderboard_visibility !== undefined) {
    result.leaderboard_visibility = result.leaderboard_visibility !== 0;
  }
  return result;
}

function rowToWallet(row) {
  if (!row) return null;
  return decryptWalletFields({ ...row });
}

class Wallet {
  static async create(walletData) {
    const id = walletData.id || uuidv4();
    const now = new Date().toISOString();
    const record = encryptWalletFields({
      ...walletData,
      id,
      createdAt: walletData.createdAt || now,
      deletedAt: null,
      last_synced_at: walletData.last_synced_at || null,
      last_cursor: walletData.last_cursor || null,
    });

    await Database.run(
      `INSERT INTO wallets
         (id, address, label, ownerName, notes, leaderboard_visibility, last_synced_at, last_cursor, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );

    return rowToWallet(record);
  }

  static async getAll() {
    const rows = await Database.all('SELECT * FROM wallets WHERE deletedAt IS NULL');
    return rows.map(rowToWallet);
  }

  static async getById(id) {
    const row = await Database.get(
      'SELECT * FROM wallets WHERE id = ? AND deletedAt IS NULL',
      [String(id)]
    );
    return rowToWallet(row);
  }

  static async getByAddress(address) {
    const row = await Database.get(
      'SELECT * FROM wallets WHERE address = ? AND deletedAt IS NULL',
      [address]
    );
    return rowToWallet(row);
  }

  static async getAllDeleted() {
    const rows = await Database.all('SELECT * FROM wallets WHERE deletedAt IS NOT NULL');
    return rows.map(rowToWallet);
  }

  static async update(id, updates) {
    const existing = await this.getById(id);
    if (!existing) return null;

    const merged = encryptWalletFields({
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });

    await Database.run(
      `UPDATE wallets SET
         label = ?, ownerName = ?, notes = ?, leaderboard_visibility = ?,
         last_synced_at = ?, last_cursor = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL`,
      [
        merged.label || null,
        merged.ownerName || null,
        merged.notes || null,
        merged.leaderboard_visibility !== false ? 1 : 0,
        merged.last_synced_at || null,
        merged.last_cursor || null,
        merged.updatedAt,
        String(id),
      ]
    );

    return rowToWallet(merged);
  }

  static async softDelete(id) {
    const result = await Database.run(
      'UPDATE wallets SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL',
      [new Date().toISOString(), String(id)]
    );
    return (result && result.changes > 0) || false;
  }

  /** Test helper — wipe all wallet data. */
  static async _clearAllData() {
    await Database.run('DELETE FROM wallets');
  }
}

module.exports = Wallet;
module.exports.ENCRYPTED_FIELDS = ENCRYPTED_FIELDS;
module.exports.encryptWalletFields = encryptWalletFields;
module.exports.decryptWalletFields = decryptWalletFields;
