/**
 * Migration: Add corporate matching tables
 *
 * Creates tables for corporate donation matching programs with per-employee
 * and total limits.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

async function up() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(new Error(`Failed to connect to database: ${err.message}`));
        return;
      }

      console.log('✓ Connected to database for corporate matching migration');

      // Corporate matching programs table
      db.run(`
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
      `, (err) => {
        if (err) {
          db.close();
          reject(new Error(`Failed to create corporate_matching table: ${err.message}`));
          return;
        }

        console.log('✓ Created corporate_matching table');

        // Employee enrollment in corporate programs
        db.run(`
          CREATE TABLE IF NOT EXISTS matching_employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            corporate_matching_id INTEGER NOT NULL,
            employee_wallet_id INTEGER NOT NULL,
            enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
            FOREIGN KEY (employee_wallet_id) REFERENCES users(id),
            UNIQUE(corporate_matching_id, employee_wallet_id)
          )
        `, (err) => {
          if (err) {
            db.close();
            reject(new Error(`Failed to create matching_employees table: ${err.message}`));
            return;
          }

          console.log('✓ Created matching_employees table');

          // Track annual matched amounts per employee per program
          db.run(`
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
          `, (err) => {
            if (err) {
              db.close();
              reject(new Error(`Failed to create employee_matching_history table: ${err.message}`));
              return;
            }

            console.log('✓ Created employee_matching_history table');

            // Corporate matching donations
            db.run(`
              CREATE TABLE IF NOT EXISTS corporate_matching_donations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                corporate_matching_id INTEGER NOT NULL,
                original_donation_id INTEGER NOT NULL,
                employee_wallet_id INTEGER NOT NULL,
                matched_amount REAL NOT NULL,
                year INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
                FOREIGN KEY (original_donation_id) REFERENCES transactions(id),
                FOREIGN KEY (employee_wallet_id) REFERENCES users(id)
              )
            `, (err) => {
              if (err) {
                db.close();
                reject(new Error(`Failed to create corporate_matching_donations table: ${err.message}`));
                return;
              }

              console.log('✓ Created corporate_matching_donations table');

              // Indexes
              db.run(`
                CREATE INDEX IF NOT EXISTS idx_corporate_matching_sponsor
                ON corporate_matching(sponsor_id)
              `, (err) => {
                if (err) {
                  db.close();
                  reject(new Error(`Failed to create sponsor index: ${err.message}`));
                  return;
                }

                db.run(`
                  CREATE INDEX IF NOT EXISTS idx_matching_employees_program
                  ON matching_employees(corporate_matching_id)
                `, (err) => {
                  if (err) {
                    db.close();
                    reject(new Error(`Failed to create employees index: ${err.message}`));
                    return;
                  }

                  db.run(`
                    CREATE INDEX IF NOT EXISTS idx_employee_matching_history_program_employee_year
                    ON employee_matching_history(corporate_matching_id, employee_wallet_id, year)
                  `, (err) => {
                    db.close();
                    if (err) {
                      reject(new Error(`Failed to create history index: ${err.message}`));
                      return;
                    }

                    console.log('✓ Created indexes');
                    resolve();
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

async function down() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(new Error(`Failed to connect to database: ${err.message}`));
        return;
      }

      db.serialize(() => {
        db.run(`DROP TABLE IF EXISTS corporate_matching_donations`, (err) => {
          if (err) {
            console.error('Failed to drop corporate_matching_donations:', err.message);
          }
        });

        db.run(`DROP TABLE IF EXISTS employee_matching_history`, (err) => {
          if (err) {
            console.error('Failed to drop employee_matching_history:', err.message);
          }
        });

        db.run(`DROP TABLE IF EXISTS matching_employees`, (err) => {
          if (err) {
            console.error('Failed to drop matching_employees:', err.message);
          }
        });

        db.run(`DROP TABLE IF EXISTS corporate_matching`, (err) => {
          if (err) {
            console.error('Failed to drop corporate_matching:', err.message);
          } else {
            console.log('✓ Dropped corporate matching tables');
          }
          db.close();
          resolve();
        });
      });
    });
  });
}

module.exports = { up, down };

// Run migration if called directly
if (require.main === module) {
  up().then(() => {
    console.log('Migration completed successfully');
  }).catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}