/**
 * Database Migration: Add Idempotency Keys Table
 * Creates table to store idempotency keys and prevent duplicate donation processing
 */

const Database = require('../utils/database');

async function addIdempotencyTable() {
  console.log('Creating idempotency_keys table...');

  try {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotencyKey VARCHAR(255) NOT NULL UNIQUE,
        requestHash VARCHAR(64) NOT NULL,
        response TEXT NOT NULL,
        userId INTEGER,
        createdAt DATETIME NOT NULL,
        expiresAt DATETIME NOT NULL
      )
    `);

    // Create indexes separately
    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_idempotency_key
      ON idempotency_keys(idempotencyKey)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_request_hash
      ON idempotency_keys(requestHash)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_expires_at
      ON idempotency_keys(expiresAt)
    `);

    await Database.run(`
      CREATE INDEX IF NOT EXISTS idx_user_id
      ON idempotency_keys(userId)
    `);

    console.log('✓ idempotency_keys table created successfully');
    console.log('✓ Indexes created successfully');

    // Verify table structure
    const tableInfo = await Database.query(
      "PRAGMA table_info(idempotency_keys)"
    );

    console.log('\nTable structure:');
    tableInfo.forEach(column => {
      console.log(`  - ${column.name}: ${column.type}`);
    });

    // Check if table has any data
    const count = await Database.get(
      'SELECT COUNT(*) as count FROM idempotency_keys'
    );

    console.log(`\nCurrent records: ${count.count}`);
    console.log('\n✓ Migration completed successfully');

  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  addIdempotencyTable()
    .then(() => {
      console.log('\nMigration script finished');
      process.exit(0);
    })
    .catch(error => {
      console.error('\nMigration script failed:', error);
      process.exit(1);
    });
}

module.exports = addIdempotencyTable;
