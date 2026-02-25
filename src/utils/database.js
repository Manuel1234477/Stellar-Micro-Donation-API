require('dotenv').config({ path: require('path').join(__dirname, '../../src/.env') });

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { DatabaseError, DuplicateError } = require('./errors');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');

class Database {
  static getConnection() {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          reject(new DatabaseError('Failed to connect to database', err));
        } else {
          resolve(db);
        }
      });
    });
  }

  /**
   * Check if error is a UNIQUE constraint violation
   */
  static isUniqueConstraintError(err) {
    return err && err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE');
  }

  static async query(sql, params = []) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        db.close();
        if (err) {
          if (this.isUniqueConstraintError(err)) {
            reject(new DuplicateError('Duplicate donation detected - this transaction has already been processed'));
          } else {
            reject(new DatabaseError('Database query failed', err));
          }
        } else {
          resolve(rows);
        }
      });
    });
  }

  static async run(sql, params = []) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        db.close();
        if (err) {
          if (Database.isUniqueConstraintError(err)) {
            reject(new DuplicateError('Duplicate donation detected - this transaction has already been processed'));
          } else {
            reject(new DatabaseError('Database operation failed', err));
          }
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  static async get(sql, params = []) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        db.close();
        if (err) {
          if (this.isUniqueConstraintError(err)) {
            reject(new DuplicateError('Duplicate donation detected - this transaction has already been processed'));
          } else {
            reject(new DatabaseError('Database query failed', err));
          }
        } else {
          resolve(row);
        }
      });
    });
  }

  static async all(sql, params = []) {
    return this.query(sql, params);
  }
}

module.exports = Database;
