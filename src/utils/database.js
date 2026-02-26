/**
 * Database Utility - Data Access Layer
 * 
 * RESPONSIBILITY: SQLite database connection management and query execution
 * OWNER: Backend Team
 * DEPENDENCIES: sqlite3, error utilities
 * 
 * Provides centralized database access with connection pooling, error handling,
 * and query helpers for all database operations across the application.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../src/.env') });

// External modules
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config({ path: path.join(__dirname, '../../src/.env') });

// Internal modules
const { DatabaseError, DuplicateError } = require('./errors');
const { withTimeout, TIMEOUT_DEFAULTS, TimeoutError } = require('./timeoutHandler');
const log = require('./log');

const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');

class Database {
  static getConnection() {
    return withTimeout(
      new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
          if (err) {
            reject(new DatabaseError('Failed to connect to database', err));
          } else {
            resolve(db);
          }
        });
      }),
      TIMEOUT_DEFAULTS.DATABASE,
      'database_connection'
    );
  }

  /**
   * Check if error is a UNIQUE constraint violation
   */
  static isUniqueConstraintError(err) {
    return err && err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE');
  }

  static async query(sql, params = []) {
    const db = await this.getConnection();
    return withTimeout(
      new Promise((resolve, reject) => {
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
      }),
      TIMEOUT_DEFAULTS.DATABASE,
      'database_query'
    ).catch(error => {
      // Ensure connection is closed on timeout
      try {
        db.close();
      } catch (closeError) {
        log.warn('DATABASE', 'Failed to close database after timeout', { error: closeError.message });
      }
      throw error;
    });
  }

  static async run(sql, params = []) {
    const db = await this.getConnection();
    return withTimeout(
      new Promise((resolve, reject) => {
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
      }),
      TIMEOUT_DEFAULTS.DATABASE,
      'database_run'
    ).catch(error => {
      // Ensure connection is closed on timeout
      try {
        db.close();
      } catch (closeError) {
        log.warn('DATABASE', 'Failed to close database after timeout', { error: closeError.message });
      }
      throw error;
    });
  }

  static async get(sql, params = []) {
    const db = await this.getConnection();
    return withTimeout(
      new Promise((resolve, reject) => {
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
      }),
      TIMEOUT_DEFAULTS.DATABASE,
      'database_get'
    ).catch(error => {
      // Ensure connection is closed on timeout
      try {
        db.close();
      } catch (closeError) {
        log.warn('DATABASE', 'Failed to close database after timeout', { error: closeError.message });
      }
      throw error;
    });
  }

  static async all(sql, params = []) {
    return this.query(sql, params);
  }
}

module.exports = Database;
