const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');

function addRecurringDonationsTable() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }

      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS recurring_donations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          donorId INTEGER NOT NULL,
          recipientId INTEGER NOT NULL,
          amount REAL NOT NULL,
          frequency TEXT NOT NULL,
          startDate DATETIME DEFAULT CURRENT_TIMESTAMP,
          nextExecutionDate DATETIME NOT NULL,
          status TEXT DEFAULT 'active',
          lastExecutionDate DATETIME,
          executionCount INTEGER DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (donorId) REFERENCES users(id),
          FOREIGN KEY (recipientId) REFERENCES users(id)
        )
      `;

      db.run(createTableSQL, (err) => {
        if (err) {
          db.close();
          reject(err);
        } else {
          console.log('✓ Created recurring_donations table');

          // Verify table creation
          db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='recurring_donations'", (err, tables) => {
            db.close();
            if (err) {
              reject(err);
            } else if (tables.length > 0) {
              console.log('✓ Table verified successfully');
              resolve();
            } else {
              reject(new Error('Table creation verification failed'));
            }
          });
        }
      });
    });
  });
}

async function main() {
  console.log('Adding recurring_donations table to database...\n');

  try {
    await addRecurringDonationsTable();
    console.log('\n✓ Migration complete!');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }
}

main();
