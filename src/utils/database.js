require('dotenv').config({ path: require('path').join(__dirname, '../../src/.env') });

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Use DB_PATH from environment or default to ./db.sqlite
const DB_PATH = process.env.DB_PATH 
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, '../../db.sqlite');

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQL.js
let db = null;
let SQL = null;
let initPromise = null;

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
function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

class Database {
  static async getConnection() {
    return initDB();
  }

  static async query(sql, params = []) {
    const database = await this.getConnection();
    const stmt = database.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  static async run(sql, params = []) {
    const database = await this.getConnection();
    database.run(sql, params);
    saveDB();
    return { id: database.getRowsModified(), changes: database.getRowsModified() };
  }

  static async get(sql, params = []) {
    const database = await this.getConnection();
    const stmt = database.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }
}

module.exports = Database;
