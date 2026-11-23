/**
 * Migration: Add crowdfunding support
 * - Adds funding_model column to campaigns table
 * - Creates escrow_pledges table
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '../../../data/stellar_donations.db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function up() {
  const db = new sqlite3.Database(DB_PATH);
  try {
    // Add funding_model to campaigns (ignore if already exists)
    await run(db,
      `ALTER TABLE campaigns ADD COLUMN funding_model TEXT NOT NULL DEFAULT 'keep-what-you-raise'`
    ).catch(e => { if (!e.message.includes('duplicate column')) throw e; });

    // Create escrow_pledges table
    await run(db, `
      CREATE TABLE IF NOT EXISTS escrow_pledges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        donor_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'held',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (donor_id) REFERENCES users(id)
      )
    `);

    await run(db, `CREATE INDEX IF NOT EXISTS idx_escrow_pledges_campaign ON escrow_pledges(campaign_id)`);
    console.log('✓ Crowdfunding migration applied');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  up().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { up };
