/**
 * Database Migration Script: Add memo column to transactions table
 * This script safely adds a memo column to the existing transactions table
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');

async function addMemoColumn() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(new Error(`Failed to connect to database: ${err.message}`));
        return;
      }

      console.log('✓ Connected to database');

      // Check if memo column already exists
      db.all("PRAGMA table_info(transactions)", (err, columns) => {
        if (err) {
          db.close();
          reject(new Error(`Failed to read table info: ${err.message}`));
          return;
        }

        const memoExists = columns.some(col => col.name === 'memo');

        if (memoExists) {
          console.log('✓ Memo column already exists');
          db.close();
          resolve({ alreadyExists: true });
          return;
        }

        // Add memo column
        const alterSQL = `ALTER TABLE transactions ADD COLUMN memo TEXT`;

        db.run(alterSQL, (err) => {
          if (err) {
            db.close();
            reject(new Error(`Failed to add memo column: ${err.message}`));
            return;
          }

          console.log('✓ Successfully added memo column to transactions table');

          // Verify the column was added
          db.all("PRAGMA table_info(transactions)", (err, updatedColumns) => {
            db.close();

            if (err) {
              reject(new Error(`Failed to verify column: ${err.message}`));
              return;
            }

            const memoColumn = updatedColumns.find(col => col.name === 'memo');
            if (memoColumn) {
              console.log('✓ Memo column verified');
              console.log(`  - Type: ${memoColumn.type}`);
              console.log(`  - Nullable: ${memoColumn.notnull === 0 ? 'Yes' : 'No'}`);
              resolve({ alreadyExists: false, column: memoColumn });
            } else {
              reject(new Error('Memo column was not added successfully'));
            }
          });
        });
      });
    });
  });
}

async function main() {
  console.log('Starting database migration: Add memo column\n');

  try {
    const result = await addMemoColumn();

    if (result.alreadyExists) {
      console.log('\n✓ Migration skipped - memo column already exists');
    } else {
      console.log('\n✓ Migration completed successfully');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration if executed directly
if (require.main === module) {
  main();
}

module.exports = { addMemoColumn };
