const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'stellar_donations.db');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`✓ Created data directory: ${DATA_DIR}`);
  }
}

function createDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`✓ Connected to SQLite database: ${DB_PATH}`);
        resolve(db);
      }
    });
  });
}

function createUsersTable(db) {
  return new Promise((resolve, reject) => {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publicKey TEXT NOT NULL UNIQUE,
        encryptedSecret TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        daily_limit REAL DEFAULT NULL,
        monthly_limit REAL DEFAULT NULL,
        per_transaction_limit REAL DEFAULT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default'
      )
    `;

    db.run(createTableSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created users table (with soft-delete support)');
        resolve();
      }
    });
  });
}

function createTransactionsTable(db) {
  return new Promise((resolve, reject) => {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        senderId INTEGER NOT NULL,
        receiverId INTEGER NOT NULL,
        amount REAL NOT NULL,
        memo TEXT,
        notes TEXT,
        tags TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        idempotencyKey TEXT UNIQUE,
        stellar_tx_id TEXT UNIQUE,
        is_orphan INTEGER NOT NULL DEFAULT 0,
        campaign_id INTEGER,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (senderId) REFERENCES users(id),
        FOREIGN KEY (receiverId) REFERENCES users(id)
      )
    `;

    db.run(createTableSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created transactions table (with soft-delete support)');
        resolve();
      }
    });
  });
}

function createIndexes(db) {
  return new Promise((resolve, reject) => {
    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
      ON transactions(idempotencyKey)
    `;

    db.run(createIndexSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created index on idempotencyKey');
        resolve();
      }
    });
  });
}

function createCampaignsTable(db) {
  return new Promise((resolve, reject) => {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        goal_amount REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        start_date DATETIME,
        end_date DATETIME,
        status TEXT DEFAULT 'active',
        created_by INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `;

    db.run(createTableSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created campaigns table (with soft-delete support)');
        resolve();
      }
    });
  });
}

function createStudentFeeTables(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS student_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        studentId TEXT NOT NULL,
        description TEXT NOT NULL,
        totalAmount REAL NOT NULL,
        paidAmount REAL NOT NULL DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default'
      )`, (err) => { if (err) return reject(err); });

      db.run(`CREATE TABLE IF NOT EXISTS fee_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feeId INTEGER NOT NULL,
        amount REAL NOT NULL,
        note TEXT,
        paidAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        FOREIGN KEY (feeId) REFERENCES student_fees(id)
      )`, (err) => {
        if (err) return reject(err);
        console.log('✓ Created student_fees and fee_payments tables (with soft-delete support)');
        resolve();
      });
    });
  });
}

// ... (Sample Insertion functions remain the same as your original) ...

async function main() {
  console.log('Initializing Stellar Micro-Donation API Database (Issue #335)...\n');

  let db;
  try {
    ensureDataDir();
    db = await createDatabase();
    await createUsersTable(db);
    await createTransactionsTable(db);
    await createIndexes(db);
    await createCampaignsTable(db);
    await createStudentFeeTables(db);
    
    // Note: If you are running this on an existing DB, you will need to manually 
    // run ALTER TABLE statements as CREATE TABLE IF NOT EXISTS won't add columns.
    
    // await insertSampleUsers(db);
    // await insertSampleTransactions(db);
    await verifyTables(db);

    console.log('\n✓ Database initialization complete with soft-delete columns!');
  } catch (error) {
    console.error('✗ Database initialization failed:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      db.close();
    }
  }
}

// Keep verifyTables function as you had it
function verifyTables(db) {
  return new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      if (err) {
        reject(err);
      } else {
        console.log('\n✓ Database tables verified:');
        tables.forEach(table => console.log(`  - ${table.name}`));
        resolve();
      }
    });
  });
}

main();