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
        daily_limit REAL DEFAULT NULL,
        monthly_limit REAL DEFAULT NULL,
        per_transaction_limit REAL DEFAULT NULL
      )
    `;

    db.run(createTableSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created users table');
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
        idempotencyKey TEXT UNIQUE,
        stellar_tx_id TEXT UNIQUE,
        is_orphan INTEGER NOT NULL DEFAULT 0,
        campaign_id INTEGER,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (senderId) REFERENCES users(id),
        FOREIGN KEY (receiverId) REFERENCES users(id)
      )
    `;

    db.run(createTableSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created transactions table with idempotency constraint');
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
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `;

    db.run(createTableSQL, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Created campaigns table');
        resolve();
      }
    });
  });
}

function insertSampleUsers(db) {
  const encryption = require('../utils/encryption');
  return new Promise((resolve, reject) => {
    /* eslint-disable no-secrets/no-secrets */
    // Test keys for development only - not real secrets
    const sampleUsers = [
      {
        publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU',
        secret: 'SA7XJJGTAY5XJJGUJMUC5XNODMZTQYBB5XYZXYUU7XJJGTAY5XJJGUJMUC'
      },
      {
        publicKey: 'GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJGTAY5XJJGUJMUC5XNOD',
        secret: 'SBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJGTAY5XJJGUJMUC5XNOD'
      },
      {
        publicKey: 'GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X',
        secret: 'SCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X'
      }
    ];
    /* eslint-enable no-secrets/no-secrets */

    const insertSQL = 'INSERT OR IGNORE INTO users (publicKey, encryptedSecret) VALUES (?, ?)';
    let completed = 0;

    sampleUsers.forEach((user) => {
      const encryptedSecret = encryption.encrypt(user.secret);
      db.run(insertSQL, [user.publicKey, encryptedSecret], (err) => {
        if (err) {
          reject(err);
        } else {
          completed++;
          if (completed === sampleUsers.length) {
            console.log(`✓ Inserted ${sampleUsers.length} sample users with encrypted secrets`);
            resolve();
          }
        }
      });
    });
  });
}

function insertSampleTransactions(db) {
  return new Promise((resolve, reject) => {
    const sampleTransactions = [
      { senderId: 1, receiverId: 3, amount: 50.0, memo: 'Donation to Red Cross' },
      { senderId: 2, receiverId: 3, amount: 75.0, memo: 'Support for humanitarian work' },
      { senderId: 1, receiverId: 2, amount: 25.5, memo: 'Test transaction' }
    ];

    const insertSQL = 'INSERT INTO transactions (senderId, receiverId, amount, memo) VALUES (?, ?, ?, ?)';
    let completed = 0;

    sampleTransactions.forEach((tx) => {
      db.run(insertSQL, [tx.senderId, tx.receiverId, tx.amount, tx.memo], (err) => {
        if (err) {
          reject(err);
        } else {
          completed++;
          if (completed === sampleTransactions.length) {
            console.log(`✓ Inserted ${sampleTransactions.length} sample transactions`);
            resolve();
          }
        }
      });
    });
  });
}

function verifyTables(db) {
  return new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      if (err) {
        reject(err);
      } else {
        console.log('\n✓ Database tables created:');
        tables.forEach(table => {
          console.log(`  - ${table.name}`);
        });
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
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => { if (err) return reject(err); });

      db.run(`CREATE TABLE IF NOT EXISTS fee_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feeId INTEGER NOT NULL,
        amount REAL NOT NULL,
        note TEXT,
        paidAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (feeId) REFERENCES student_fees(id)
      )`, (err) => {
        if (err) return reject(err);
        console.log('✓ Created student_fees and fee_payments tables');
        resolve();
      });
    });
  });
}

async function main() {
  console.log('Initializing Stellar Micro-Donation API Database...\n');

  let db;
  try {
    ensureDataDir();
    db = await createDatabase();
    await createUsersTable(db);
    await createTransactionsTable(db);
    await createIndexes(db);
    await createCampaignsTable(db);
    await createStudentFeeTables(db);
    await insertSampleUsers(db);
    await insertSampleTransactions(db);
    await verifyTables(db);

    console.log('\n✓ Database initialization complete!');
    console.log(`\nDatabase location: ${DB_PATH}`);
  } catch (error) {
    console.error('✗ Database initialization failed:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        }
      });
    }
  }
}

main();
