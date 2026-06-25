/**
 * User Model - Data Access Layer (SQLite-backed)
 * No longer reads from data/users.json — all lookups go through SQLite.
 */

const Database = require('../utils/database');

class User {
  static async getById(id) {
    if (!id) return null;
    const row = await Database.get(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
      [id]
    );
    return row || null;
  }

  static async getByWallet(address) {
    if (!address) return null;
    const row = await Database.get(
      'SELECT * FROM users WHERE publicKey = ? AND deleted_at IS NULL',
      [address]
    );
    return row || null;
  }
}

module.exports = User;
