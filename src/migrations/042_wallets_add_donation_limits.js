'use strict';

/**
 * Add per-wallet donation limit columns to enable per-wallet overrides (#1484).
 *
 * Adds:
 * - donation_limit_min: minimum amount per donation for this wallet (stroops, BigInt)
 * - donation_limit_max: maximum amount per donation for this wallet (stroops, BigInt)
 *
 * When NULL, system defaults to global environment variables.
 */

exports.name = '042_wallets_add_donation_limits';

exports.up = async (db) => {
  await db.run(`
    ALTER TABLE wallets
    ADD COLUMN donation_limit_min INTEGER
  `);

  await db.run(`
    ALTER TABLE wallets
    ADD COLUMN donation_limit_max INTEGER
  `);

  // Create index for faster queries on wallets with explicit limits
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_wallets_donation_limits
    ON wallets(donation_limit_min, donation_limit_max)
    WHERE donation_limit_min IS NOT NULL OR donation_limit_max IS NOT NULL
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_wallets_donation_limits');
  await db.run('ALTER TABLE wallets DROP COLUMN donation_limit_max');
  await db.run('ALTER TABLE wallets DROP COLUMN donation_limit_min');
};
