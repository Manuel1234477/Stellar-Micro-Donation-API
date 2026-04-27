'use strict';

/**
 * Migration: Add missing columns to recurring_donations table
 * Issues: #686, #687
 * 
 * - Adds customIntervalDays, maxExecutions, webhookUrl, failureCount, lastExecutionDate to recurring_donations
 * - Ensures deleted_at column exists on users table (idempotent)
 */

exports.name = '002_add_missing_columns';

exports.up = async (db) => {
  // Issue #687: Add missing columns to recurring_donations table
  const columns = [
    { name: 'customIntervalDays', type: 'INTEGER DEFAULT NULL' },
    { name: 'maxExecutions', type: 'INTEGER DEFAULT NULL' },
    { name: 'webhookUrl', type: 'TEXT DEFAULT NULL' },
    { name: 'failureCount', type: 'INTEGER DEFAULT 0' },
    { name: 'lastExecutionDate', type: 'DATETIME DEFAULT NULL' }
  ];

  for (const col of columns) {
    try {
      await db.run(`
        ALTER TABLE recurring_donations
        ADD COLUMN ${col.name} ${col.type}
      `);
      console.log(`✓ Added column ${col.name} to recurring_donations`);
    } catch (err) {
      // Column already exists - this is idempotent
      if (err.message.includes('duplicate column name')) {
        console.log(`ℹ Column ${col.name} already exists on recurring_donations`);
      } else {
        throw err;
      }
    }
  }

  // Issue #686: Ensure deleted_at exists on users table (idempotent)
  try {
    await db.run(`
      ALTER TABLE users
      ADD COLUMN deleted_at DATETIME DEFAULT NULL
    `);
    console.log('✓ Added column deleted_at to users');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('ℹ Column deleted_at already exists on users');
    } else {
      throw err;
    }
  }
};

exports.down = async (db) => {
  // SQLite doesn't support DROP COLUMN easily, so we skip rollback
  // In production, use a separate migration if needed
  console.log('ℹ Rollback not supported for this migration (SQLite limitation)');
};
