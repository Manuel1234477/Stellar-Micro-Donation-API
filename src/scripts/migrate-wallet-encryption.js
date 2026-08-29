#!/usr/bin/env node
/**
 * Wallet Field Encryption Migration (#1593)
 *
 * RESPONSIBILITY: Encrypt existing plaintext values for sensitive wallet fields
 *   (label, notes) in the database so that they are protected at rest.
 *
 * USAGE:
 *   node src/scripts/migrate-wallet-encryption.js
 *
 * SAFETY:
 *   - Already-encrypted values (beginning with "v") are skipped.
 *   - Rows with NULL values for those fields are skipped.
 *   - The migration is idempotent; it is safe to run multiple times.
 *
 * REQUIRES:
 *   - ENCRYPTION_KEY (or ENCRYPTION_KEY_1) environment variable set.
 */

'use strict';

require('dotenv').config();

const Database = require('../utils/database');
const EncryptionService = require('../services/EncryptionService');
const log = require('../utils/log');

const ENCRYPTED_FIELDS = ['label', 'notes'];

async function main() {
  if (!process.env.ENCRYPTION_KEY && !process.env.ENCRYPTION_KEY_1) {
    console.error('[migrate-wallet-encryption] ERROR: No ENCRYPTION_KEY configured. Aborting.');
    process.exit(1);
  }

  log.info('WALLET_ENCRYPTION_MIGRATION', 'Starting wallet field encryption migration');

  // Ensure schema is ready (adds label_encrypted / notes_encrypted columns if missing)
  const columns = await Database.all('PRAGMA table_info(wallets)').catch(() => []);
  if (columns.length === 0) {
    log.warn('WALLET_ENCRYPTION_MIGRATION', 'wallets table does not exist; nothing to migrate');
    return;
  }

  const existingCols = new Set(columns.map(c => c.name));
  for (const field of ENCRYPTED_FIELDS) {
    const flagCol = `${field}_encrypted`;
    if (!existingCols.has(flagCol)) {
      await Database.run(`ALTER TABLE wallets ADD COLUMN ${flagCol} INTEGER DEFAULT 0`);
      log.info('WALLET_ENCRYPTION_MIGRATION', `Added column ${flagCol}`);
    }
  }

  // Fetch wallets that have any plaintext value
  const wallets = await Database.all('SELECT id, label, notes, label_encrypted, notes_encrypted FROM wallets');
  log.info('WALLET_ENCRYPTION_MIGRATION', `Processing ${wallets.length} wallet(s)`);

  let migrated = 0;
  let skipped  = 0;

  for (const wallet of wallets) {
    const updates = {};
    let needsUpdate = false;

    for (const field of ENCRYPTED_FIELDS) {
      const value       = wallet[field];
      const encFlagRaw  = wallet[`${field}_encrypted`];
      const isAlreadyEncrypted =
        (encFlagRaw === 1 || encFlagRaw === '1' || encFlagRaw === true) ||
        (typeof value === 'string' && value.startsWith('v'));

      if (value == null || isAlreadyEncrypted) {
        // NULL or already encrypted — skip this field
        continue;
      }

      // Plaintext value found — encrypt it
      updates[field] = EncryptionService.encryptField(value);
      updates[`${field}_encrypted`] = 1;
      needsUpdate = true;
    }

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const params     = [...Object.values(updates), wallet.id];
    await Database.run(
      `UPDATE wallets SET ${setClauses} WHERE id = ?`,
      params
    );
    migrated++;
    log.info('WALLET_ENCRYPTION_MIGRATION', `Encrypted wallet ${wallet.id}`, {
      fields: ENCRYPTED_FIELDS.filter(f => updates[f] !== undefined),
    });
  }

  log.info('WALLET_ENCRYPTION_MIGRATION', 'Migration complete', { migrated, skipped });
  console.log(`[migrate-wallet-encryption] Done. Migrated: ${migrated}, Skipped: ${skipped}`);
}

main().catch(err => {
  console.error('[migrate-wallet-encryption] Fatal error:', err.message);
  process.exit(1);
});
