require('dotenv').config({ path: require('path').join(__dirname, '../../src/.env') });

const initSqlJs = require('sql.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { DatabaseError } = require('./errors');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');
let SQL = null;
let db = null;
let initPromise = null;

// eslint-disable-next-line no-unused-vars -- Reserved for sql.js initialization
async function initDB() {
  if (initPromise) {
    return initPromise;
  }
  
  initPromise = (async () => {
    if (!SQL) {
      SQL = await initSqlJs();
      
      // Try to load existing database
      if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
      } else {
        db = new SQL.Database();
      }
    }
    return db;
  })();
  
  return initPromise;
}

// Save database to file
// eslint-disable-next-line no-unused-vars -- Reserved for sql.js persistence
function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

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

  static async query(sql, params = []) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        db.close();
        if (err) {
          reject(new DatabaseError('Database query failed', err));
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
          reject(new DatabaseError('Database operation failed', err));
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
          reject(new DatabaseError('Database query failed', err));
        } else {
          resolve(row);
        }
      });
    });
  }
}

module.exports = Database;
