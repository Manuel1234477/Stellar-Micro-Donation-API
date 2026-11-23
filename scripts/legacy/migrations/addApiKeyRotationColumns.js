/**
 * Migration: Add grace_period_days and rotated_to_id columns to api_keys table
 * Run once on existing databases: node src/scripts/migrations/addApiKeyRotationColumns.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('Failed to open DB:', err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(
    `ALTER TABLE api_keys ADD COLUMN grace_period_days INTEGER NOT NULL DEFAULT 30`,
    (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding grace_period_days:', err.message);
      } else {
        console.log('✓ grace_period_days column ready');
      }
    }
  );
  db.run(
    `ALTER TABLE api_keys ADD COLUMN rotated_to_id INTEGER`,
    (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Error adding rotated_to_id:', err.message);
      } else {
        console.log('✓ rotated_to_id column ready');
      }
    }
  );
});

db.close();
