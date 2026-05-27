/**
 * Migration: Add API Key ID to Idempotency Keys (Issue #891)
 * 
 * Adds api_key_id column to idempotency_keys table for scoping keys per API key.
 * Prevents cross-tenant data leakage and key squatting attacks.
 */

const Database = require('../../utils/database');
const log = require('../../utils/log');

async function up() {
  try {
    log.info('MIGRATION', 'Starting: Add api_key_id to idempotency_keys');

    // Add api_key_id column if it doesn't exist
    try {
      await Database.run(`
        ALTER TABLE idempotency_keys 
        ADD COLUMN api_key_id INTEGER DEFAULT NULL
      `);
      log.info('MIGRATION', 'Added api_key_id column');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
      log.info('MIGRATION', 'api_key_id column already exists');
    }

    // Create composite unique index on (api_key_id, idempotencyKey)
    try {
      await Database.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_composite
        ON idempotency_keys(api_key_id, idempotencyKey)
      `);
      log.info('MIGRATION', 'Created composite unique index on (api_key_id, idempotencyKey)');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        throw err;
      }
      log.info('MIGRATION', 'Composite index already exists');
    }

    log.info('MIGRATION', 'Migration completed successfully');
  } catch (error) {
    log.error('MIGRATION', 'Failed to add api_key_id column', { error: error.message });
    throw error;
  }
}

async function down() {
  try {
    log.info('MIGRATION', 'Reversing: Remove api_key_id from idempotency_keys');
    
    // Drop the composite index
    try {
      await Database.run(`
        DROP INDEX IF EXISTS idx_idempotency_keys_composite
      `);
      log.info('MIGRATION', 'Dropped composite index');
    } catch (err) {
      log.warn('MIGRATION', 'Could not drop index', { error: err.message });
    }

    // Note: SQLite doesn't support dropping columns easily, so we leave the column
    // This is acceptable for a down migration as the column is nullable
    log.info('MIGRATION', 'Reverse migration completed (column left in place for safety)');
  } catch (error) {
    log.error('MIGRATION', 'Failed to reverse migration', { error: error.message });
    throw error;
  }
}

module.exports = { up, down };
