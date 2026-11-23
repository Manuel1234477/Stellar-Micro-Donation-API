const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'stellar_donations.db');

/**
 * Migration: Add campaign milestone tracking columns
 *
 * This migration adds:
 * 1. notified_milestones - JSON array to track which milestones have been notified (0.25, 0.5, 0.75, 1.0)
 * 2. last_milestone_notification - Timestamp of last milestone notification to prevent duplicate notifications
 * 3. closed_at - Timestamp when the campaign reached 100% completion
 */

function runMigration() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(new Error(`Failed to connect to database: ${err.message}`));
        return;
      }

      console.log('✓ Connected to database');

      // Check if columns already exist
      db.all("PRAGMA table_info(campaigns)", (err, columns) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        const existingColumns = columns.map(col => col.name);
        const columnsToAdd = [
          { name: 'notified_milestones', type: 'TEXT', default: '[]' },
          { name: 'last_milestone_notification', type: 'DATETIME', default: null },
          { name: 'closed_at', type: 'DATETIME', default: null }
        ];

        const required = columnsToAdd.filter(col => !existingColumns.includes(col.name));

        if (required.length === 0) {
          console.log('✓ All milestone tracking columns already exist');
          db.close();
          resolve();
          return;
        }

        console.log(`Adding ${required.length} milestone tracking columns...`);

        db.serialize(() => {
          required.forEach((col, index) => {
            const sql = `ALTER TABLE campaigns ADD COLUMN ${col.name} ${col.type}`;
            db.run(sql, (err) => {
              if (err) {
                console.error(`✗ Failed to add ${col.name}: ${err.message}`);
              } else {
                console.log(`✓ Added ${col.name} column`);
              }

              if (index === required.length - 1) {
                db.close();
                resolve();
              }
            });
          });
        });
      });
    });
  });
}

if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('\n✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigration };
