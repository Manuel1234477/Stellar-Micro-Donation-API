/**
 * Migration: Add signing_required and key_secret columns to api_keys table.
 * Run once: node src/scripts/migrations/addSigningRequired.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('Failed to open DB:', err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(
    `ALTER TABLE api_keys ADD COLUMN signing_required INTEGER NOT NULL DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding signing_required:', err.message);
      } else {
        console.log('✓ signing_required column ready');
      }
    }
  );
  db.run(
    `ALTER TABLE api_keys ADD COLUMN key_secret TEXT`,
    (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding key_secret:', err.message);
      } else {
        console.log('✓ key_secret column ready');
      }
    }
  );
});

db.close();
