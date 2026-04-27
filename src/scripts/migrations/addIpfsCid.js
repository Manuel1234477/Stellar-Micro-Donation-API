'use strict';

/**
 * Migration: add ipfs_cid column to transactions table
 * Stores the IPFS CID of the donation impact certificate.
 */

const Database = require('../../utils/database');

async function up() {
  await Database.run(
    `ALTER TABLE transactions ADD COLUMN ipfs_cid TEXT DEFAULT NULL`
  ).catch((err) => {
    // Column may already exist (idempotent)
    if (!err.message.includes('duplicate column')) throw err;
  });
  console.log('✓ Added ipfs_cid column to transactions');
}

module.exports = { up };
