/**
 * Migration: add originalCurrency and originalAmount columns to transactions table
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(
    `ALTER TABLE transactions ADD COLUMN originalCurrency TEXT DEFAULT 'XLM'`,
    (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding originalCurrency:', err.message);
      } else {
        console.log('✓ originalCurrency column ready');
      }
    }
  );

  db.run(
    `ALTER TABLE transactions ADD COLUMN originalAmount REAL`,
    (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding originalAmount:', err.message);
      } else {
        console.log('✓ originalAmount column ready');
      }
    }
  );
});

db.close();
