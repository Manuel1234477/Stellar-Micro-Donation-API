'use strict';

/**
 * Migration: Add indexes on transactions table for performance
 * Issue: #737
 *
 * - Index on transactions.senderId (used by GET /stats/donors GROUP BY)
 * - Index on transactions.receiverId (used by GET /stats/recipients GROUP BY)
 * - Composite index on (senderId, timestamp) for time-range donor queries
 */

exports.name = '009_add_transaction_indexes';

exports.up = async (db) => {
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_senderId
    ON transactions(senderId)
  `);
  console.log('✓ Created index idx_transactions_senderId');

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_receiverId
    ON transactions(receiverId)
  `);
  console.log('✓ Created index idx_transactions_receiverId');

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_senderId_timestamp
    ON transactions(senderId, timestamp)
  `);
  console.log('✓ Created composite index idx_transactions_senderId_timestamp');
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_transactions_senderId');
  await db.run('DROP INDEX IF EXISTS idx_transactions_receiverId');
  await db.run('DROP INDEX IF EXISTS idx_transactions_senderId_timestamp');
};
