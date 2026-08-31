#!/usr/bin/env node
/**
 * Wallet Field Re-encryption Script (#1593)
 *
 * RESPONSIBILITY: Re-encrypt sensitive wallet fields (label, notes) when the
 *   encryption key is rotated. Decrypts each value with the OLD key version
 *   and re-encrypts with the NEW key version.
 *
 * USAGE:
 *   ENCRYPTION_KEY_VERSION=2 \
 *   ENCRYPTION_KEY_1=<old-key> \
 *   ENCRYPTION_KEY_2=<new-key> \
 *   node src/scripts/reencrypt-wallet-fields.js
 *
 * SAFETY:
 *   - Only processes records encrypted with the previous key version.
 *   - Rows with NULL fields or the current key version are skipped.
 *   - The operation is idempotent; running it again will find nothing to do.
 *   - Recommend taking a DB backup before running.
 *
 * ENVIRONMENT:
 *   ENCRYPTION_KEY_VERSION  Target (new) key version number (default: 1)
 *   ENCRYPTION_KEY_<n>      Symmetric key for version n
 */

'use strict';

require('dotenv').config();

const Database = require('../utils/database');
const EncryptionService = require('../services/EncryptionService');
const log = require('../utils/log');

const ENCRYPTED_FIELDS = ['label', 'notes'];

/**
 * Parse the key version from a ciphertext string "v<n>:...".
 * Returns null for plaintext or invalid values.
 */
function parseCiphertextVersion(value) {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('v')) return null;
  const colon = value.indexOf(':');
  if (colon === -1) return null;
  const v = parseInt(value.slice(1, colon), 10);
  return isNaN(v) ? null : v;
}

async function main() {
  const targetVersion = parseInt(process.env.ENCRYPTION_KEY_VERSION || '1', 10);

  log.info('WALLET_REENCRYPTION', 'Starting wallet field re-encryption', { targetVersion });

  const wallets = await Database.all(
    'SELECT id, label, notes, label_encrypted, notes_encrypted FROM wallets'
  ).catch(() => []);

  if (wallets.length === 0) {
    console.log('[reencrypt-wallet-fields] No wallets found.');
    return;
  }

  let reencrypted = 0;
  let skipped     = 0;
  let errors      = 0;

  for (const wallet of wallets) {
    const updates = {};
    let needsUpdate = false;

    for (const field of ENCRYPTED_FIELDS) {
      const value        = wallet[field];
      const encFlagRaw   = wallet[`${field}_encrypted`];
      const isEncrypted  =
        (encFlagRaw === 1 || encFlagRaw === '1' || encFlagRaw === true) ||
        (typeof value === 'string' && value.startsWith('v'));

      if (value == null || !isEncrypted) {
        continue; // Nothing to re-encrypt
      }

      const currentVersion = parseCiphertextVersion(value);
      if (currentVersion === targetVersion) {
        continue; // Already at the target version
      }

      try {
        const plaintext = EncryptionService.decryptField(value);
        updates[field]            = EncryptionService.encryptField(plaintext, targetVersion);
        updates[`${field}_encrypted`] = 1;
        needsUpdate = true;
      } catch (err) {
        log.error('WALLET_REENCRYPTION', `Failed to re-encrypt field "${field}" for wallet ${wallet.id}`, {
          error: err.message,
        });
        errors++;
      }
    }

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const params     = [...Object.values(updates), wallet.id];
    await Database.run(`UPDATE wallets SET ${setClauses} WHERE id = ?`, params);
    reencrypted++;
    log.info('WALLET_REENCRYPTION', `Re-encrypted wallet ${wallet.id}`, {
      fields: ENCRYPTED_FIELDS.filter(f => updates[f] !== undefined),
      newVersion: targetVersion,
    });
  }

  log.info('WALLET_REENCRYPTION', 'Re-encryption complete', { reencrypted, skipped, errors });
  console.log(`[reencrypt-wallet-fields] Done. Re-encrypted: ${reencrypted}, Skipped: ${skipped}, Errors: ${errors}`);

  if (errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('[reencrypt-wallet-fields] Fatal error:', err.message);
  process.exit(1);
});
