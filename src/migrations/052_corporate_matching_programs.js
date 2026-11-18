'use strict';

/**
 * Migration 044: Corporate matching programs (#1550)
 *
 * Replaces the stray, never-wired-in script at
 * src/scripts/migrations/addCorporateMatchingTables.js with a proper,
 * checksum-tracked migration that matches what CorporateMatchingService,
 * routes/admin/corporateMatching.js, and DonationService already expect.
 *
 * Note: original_donation_id / matched_donation_id are TEXT (UUID) because
 * donations are keyed by the UUIDs generated in models/transaction.js
 * (donations_store), not by the legacy integer `transactions` table id.
 */

exports.name = '044_corporate_matching_programs';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS corporate_matching (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sponsor_id INTEGER NOT NULL,
      match_ratio REAL NOT NULL DEFAULT 1.0,
      per_employee_limit REAL NOT NULL,
      total_limit REAL NOT NULL,
      remaining_total_limit REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sponsor_id) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS matching_employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      corporate_matching_id INTEGER NOT NULL,
      employee_wallet_id INTEGER NOT NULL,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
      FOREIGN KEY (employee_wallet_id) REFERENCES users(id),
      UNIQUE(corporate_matching_id, employee_wallet_id)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS employee_matching_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      corporate_matching_id INTEGER NOT NULL,
      employee_wallet_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      matched_amount REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
      FOREIGN KEY (employee_wallet_id) REFERENCES users(id),
      UNIQUE(corporate_matching_id, employee_wallet_id, year)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS corporate_matching_donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      corporate_matching_id INTEGER NOT NULL,
      original_donation_id TEXT NOT NULL,
      matched_donation_id TEXT,
      employee_wallet_id INTEGER NOT NULL,
      matched_amount REAL NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stellar_tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
      FOREIGN KEY (employee_wallet_id) REFERENCES users(id)
    )
  `);

  await db.run(`CREATE INDEX IF NOT EXISTS idx_corporate_matching_sponsor ON corporate_matching(sponsor_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_corporate_matching_status ON corporate_matching(status)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_matching_employees_program ON matching_employees(corporate_matching_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_matching_employees_employee ON matching_employees(employee_wallet_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_employee_matching_history_program_employee_year ON employee_matching_history(corporate_matching_id, employee_wallet_id, year)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_corporate_matching_donations_program ON corporate_matching_donations(corporate_matching_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_corporate_matching_donations_original ON corporate_matching_donations(original_donation_id)`);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_corporate_matching_donations_original');
  await db.run('DROP INDEX IF EXISTS idx_corporate_matching_donations_program');
  await db.run('DROP INDEX IF EXISTS idx_employee_matching_history_program_employee_year');
  await db.run('DROP INDEX IF EXISTS idx_matching_employees_employee');
  await db.run('DROP INDEX IF EXISTS idx_matching_employees_program');
  await db.run('DROP INDEX IF EXISTS idx_corporate_matching_status');
  await db.run('DROP INDEX IF EXISTS idx_corporate_matching_sponsor');
  await db.run('DROP TABLE IF EXISTS corporate_matching_donations');
  await db.run('DROP TABLE IF EXISTS employee_matching_history');
  await db.run('DROP TABLE IF EXISTS matching_employees');
  await db.run('DROP TABLE IF EXISTS corporate_matching');
};
