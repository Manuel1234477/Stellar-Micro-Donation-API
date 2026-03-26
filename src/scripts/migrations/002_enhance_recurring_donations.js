/**
 * Migration 002: Enhance recurring_donations table
 *
 * Adds: customIntervalDays, maxExecutions, webhookUrl, failureCount, lastFailureReason
 * Creates: recurring_donation_logs table if not exists
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(new Error(`Failed to connect: ${err.message}`));

      db.serialize(() => {
        // Add customIntervalDays for custom frequency
        db.run(`ALTER TABLE recurring_donations ADD COLUMN customIntervalDays INTEGER`, () => {});
        // Add maxExecutions (null = unlimited)
        db.run(`ALTER TABLE recurring_donations ADD COLUMN maxExecutions INTEGER`, () => {});
        // Add webhookUrl for failure notifications
        db.run(`ALTER TABLE recurring_donations ADD COLUMN webhookUrl TEXT`, () => {});
        // Add failure tracking
        db.run(`ALTER TABLE recurring_donations ADD COLUMN failureCount INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE recurring_donations ADD COLUMN lastFailureReason TEXT`, () => {});

        // Create logs table
        db.run(`
          CREATE TABLE IF NOT EXISTS recurring_donation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scheduleId INTEGER NOT NULL,
            status TEXT NOT NULL,
            transactionHash TEXT,
            errorMessage TEXT,
            attemptNumber INTEGER DEFAULT 1,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            correlationId TEXT,
            traceId TEXT,
            FOREIGN KEY (scheduleId) REFERENCES recurring_donations(id)
          )
        `, (err) => {
          db.close();
          if (err) return reject(err);
          console.log('✓ Migration 002 complete');
          resolve();
        });
      });
    });
  });
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigration };
