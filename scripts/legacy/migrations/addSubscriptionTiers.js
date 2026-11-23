/**
 * Migration: Add subscription_tiers and donor_subscriptions tables
 *
 * Creates:
 *   subscription_tiers   – tier definitions (name, amount, interval, benefits)
 *   donor_subscriptions  – links donors to tiers and their recurring_donation schedule
 */

'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(new Error(`Failed to connect: ${err.message}`));

      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS subscription_tiers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL UNIQUE,
            amount      REAL    NOT NULL,
            interval    TEXT    NOT NULL DEFAULT 'monthly',
            benefits    TEXT,
            createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => { if (err) console.warn('subscription_tiers:', err.message); });

        db.run(`
          CREATE TABLE IF NOT EXISTS donor_subscriptions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            donorId             INTEGER NOT NULL,
            tierId              INTEGER NOT NULL,
            recurringDonationId INTEGER,
            status              TEXT    NOT NULL DEFAULT 'active',
            createdAt           DATETIME DEFAULT CURRENT_TIMESTAMP,
            cancelledAt         DATETIME DEFAULT NULL,
            FOREIGN KEY (donorId)             REFERENCES users(id),
            FOREIGN KEY (tierId)              REFERENCES subscription_tiers(id),
            FOREIGN KEY (recurringDonationId) REFERENCES recurring_donations(id)
          )
        `, (err) => {
          db.close();
          if (err) return reject(err);
          console.log('✓ Migration addSubscriptionTiers complete');
          resolve();
        });
      });
    });
  });
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { runMigration };
