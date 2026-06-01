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
  // Get existing columns on recurring_donations
  const tableInfo = await db.query('PRAGMA table_info(recurring_donations)', []);
  const existingCols = new Set(tableInfo.map(r => r.name));

  const columns = [
    { name: 'customIntervalDays', type: 'INTEGER DEFAULT NULL' },
    { name: 'maxExecutions', type: 'INTEGER DEFAULT NULL' },
    { name: 'webhookUrl', type: 'TEXT DEFAULT NULL' },
    { name: 'failureCount', type: 'INTEGER DEFAULT 0' },
    { name: 'lastExecutionDate', type: 'DATETIME DEFAULT NULL' }
  ];

  for (const col of columns) {
    if (existingCols.has(col.name)) {
      console.log(`ℹ Column ${col.name} already exists on recurring_donations`);
      continue;
    }
    await db.run(`ALTER TABLE recurring_donations ADD COLUMN ${col.name} ${col.type}`);
    console.log(`✓ Added column ${col.name} to recurring_donations`);
  }

  // Ensure deleted_at exists on users table
  const usersInfo = await db.query('PRAGMA table_info(users)', []);
  const userCols = new Set(usersInfo.map(r => r.name));
  if (!userCols.has('deleted_at')) {
    await db.run('ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL');
    console.log('✓ Added column deleted_at to users');
  } else {
    console.log('ℹ Column deleted_at already exists on users');
  }
};

exports.down = async (db) => {
  // SQLite doesn't support DROP COLUMN easily, so we skip rollback
  // In production, use a separate migration if needed
  console.log('ℹ Rollback not supported for this migration (SQLite limitation)');
};
