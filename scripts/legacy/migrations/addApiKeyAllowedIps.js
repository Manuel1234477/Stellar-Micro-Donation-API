/**
 * Migration: Add allowed_ips column to api_keys table
 * Run once on existing databases:
 *   node src/scripts/migrations/addApiKeyAllowedIps.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('Failed to open DB:', err.message); process.exit(1); }
});

db.run(
  `ALTER TABLE api_keys ADD COLUMN allowed_ips TEXT`,
  (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding allowed_ips:', err.message);
    } else {
      console.log('✓ allowed_ips column ready');
    }
    db.close();
  }
);
