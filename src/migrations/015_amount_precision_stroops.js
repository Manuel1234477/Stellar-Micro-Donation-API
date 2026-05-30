'use strict';

/**
 * Migration: Store transaction amounts as INTEGER stroops instead of REAL XLM
 *
 * Issue #932 — IEEE 754 double precision cannot exactly represent values like 0.1 XLM.
 * Storing amounts as integer stroops (1 XLM = 10,000,000 stroops) eliminates rounding errors.
 *
 * Steps:
 *  1. Add a new INTEGER column `amount_stroops`.
 *  2. Populate it by converting existing REAL amounts: ROUND(amount * 10000000).
 *  3. Drop the old `amount` column via table rebuild (SQLite does not support DROP COLUMN).
 *  4. Rename `amount_stroops` to `amount`.
 */

const STROOPS_PER_XLM = 10_000_000;

exports.name = '015_amount_precision_stroops';

exports.up = async (db) => {
  // 1. Add temporary stroops column
  await db.run(`ALTER TABLE transactions ADD COLUMN amount_stroops INTEGER`);

  // 2. Convert existing REAL amounts to stroops
  await db.run(
    `UPDATE transactions SET amount_stroops = CAST(ROUND(amount * ${STROOPS_PER_XLM}) AS INTEGER)`
  );

  // 3. Rebuild the table without the old REAL column
  //    SQLite requires a full table rebuild to drop a column.
  await db.run(`
    CREATE TABLE transactions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      memo TEXT,
      notes TEXT,
      tags TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      idempotencyKey TEXT UNIQUE,
      stellar_tx_id TEXT UNIQUE,
      is_orphan INTEGER NOT NULL DEFAULT 0,
      campaign_id INTEGER,
      validAfter INTEGER DEFAULT 0,
      validBefore INTEGER DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (senderId) REFERENCES users(id),
      FOREIGN KEY (receiverId) REFERENCES users(id)
    )
  `);

  await db.run(`
    INSERT INTO transactions_new
      SELECT id, senderId, receiverId, amount_stroops, memo, notes, tags,
             timestamp, deleted_at, idempotencyKey, stellar_tx_id, is_orphan,
             campaign_id, validAfter, validBefore, tenant_id
      FROM transactions
  `);

  await db.run(`DROP TABLE transactions`);
  await db.run(`ALTER TABLE transactions_new RENAME TO transactions`);

  // Restore indexes
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON transactions(idempotencyKey)
  `);

  console.log('✓ Migrated transactions.amount from REAL (XLM) to INTEGER (stroops)');
};

exports.down = async (db) => {
  // Rebuild table converting stroops back to REAL XLM
  await db.run(`
    CREATE TABLE transactions_old (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      amount REAL NOT NULL,
      memo TEXT,
      notes TEXT,
      tags TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME DEFAULT NULL,
      idempotencyKey TEXT UNIQUE,
      stellar_tx_id TEXT UNIQUE,
      is_orphan INTEGER NOT NULL DEFAULT 0,
      campaign_id INTEGER,
      validAfter INTEGER DEFAULT 0,
      validBefore INTEGER DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (senderId) REFERENCES users(id),
      FOREIGN KEY (receiverId) REFERENCES users(id)
    )
  `);

  await db.run(`
    INSERT INTO transactions_old
      SELECT id, senderId, receiverId,
             CAST(amount AS REAL) / ${STROOPS_PER_XLM},
             memo, notes, tags, timestamp, deleted_at, idempotencyKey,
             stellar_tx_id, is_orphan, campaign_id, validAfter, validBefore, tenant_id
      FROM transactions
  `);

  await db.run(`DROP TABLE transactions`);
  await db.run(`ALTER TABLE transactions_old RENAME TO transactions`);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON transactions(idempotencyKey)
  `);

  console.log('✓ Rolled back transactions.amount from INTEGER (stroops) to REAL (XLM)');
};
