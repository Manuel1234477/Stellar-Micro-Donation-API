#!/usr/bin/env node
/**
 * reencrypt-memos.js — Memo Key Rotation Migration Script
 *
 * Re-encrypts all transaction memos that were encrypted with an older key version
 * to the current active key version.
 *
 * Usage:
 *   npm run migrate:reencrypt
 *
 * The script:
 *   1. Loads all transactions from data/donations.json
 *   2. Identifies memos using old key versions (versioned format "v<n>:…")
 *   3. Decrypts each memo with the recipient's Stellar key
 *   4. Re-encrypts with the current active key version
 *   5. Saves the updated transactions back to data/donations.json
 *
 * Requirements:
 *   - The current active key version must be set in data/memo-keys/keys.json
 *   - Old key versions must still be present in the key store (not yet purged)
 *   - Recipient Stellar secret keys must be available via RECIPIENT_SECRETS env var
 *     as a JSON map: { "<publicKey>": "<secretKey>", ... }
 *
 * Environment variables:
 *   RECIPIENT_SECRETS  — JSON map of publicKey → secretKey for memos to re-encrypt
 *   DRY_RUN            — Set to "true" to preview changes without writing
 */

'use strict';

const fs = require('fs');
const path = require('path');
const memoKeyManager = require('../utils/memoKeyManager');
const MemoEncryptionService = require('../services/MemoEncryptionService');

const DONATIONS_PATH = process.env.DB_JSON_PATH ||
  path.join(__dirname, '../../data/donations.json');

const DRY_RUN = process.env.DRY_RUN === 'true';

function loadTransactions() {
  if (!fs.existsSync(DONATIONS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DONATIONS_PATH, 'utf8'));
  } catch (err) {
    console.error('Failed to load transactions:', err.message);
    process.exit(1);
  }
}

function saveTransactions(transactions) {
  fs.writeFileSync(DONATIONS_PATH, JSON.stringify(transactions, null, 2));
}

function loadRecipientSecrets() {
  if (!process.env.RECIPIENT_SECRETS) return {};
  try {
    return JSON.parse(process.env.RECIPIENT_SECRETS);
  } catch (err) {
    console.error('Failed to parse RECIPIENT_SECRETS env var:', err.message);
    return {};
  }
}

async function main() {
  console.log('=== Memo Re-encryption Migration ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const activeVersion = memoKeyManager.getActiveKeyVersion();
  const allVersions = memoKeyManager.getAllKeyVersions();
  console.log(`Active key version: ${activeVersion}`);
  console.log(`Key versions in store: ${allVersions.map(k => `v${k.version}${k.retiredAt ? ' (retired)' : ' (active)'}`).join(', ')}`);

  const transactions = loadTransactions();
  const recipientSecrets = loadRecipientSecrets();

  const toReencrypt = [];
  const skipped = [];
  const alreadyCurrent = [];

  for (const tx of transactions) {
    if (!tx.memoEnvelope) continue;

    // Only process versioned memos
    if (typeof tx.memoEnvelope !== 'string' || !/^v\d+:/.test(tx.memoEnvelope)) {
      skipped.push({ id: tx.id, reason: 'legacy format (not versioned)' });
      continue;
    }

    let keyVersion;
    try {
      ({ keyVersion } = memoKeyManager.deserializeVersionedCiphertext(tx.memoEnvelope));
    } catch (err) {
      skipped.push({ id: tx.id, reason: `parse error: ${err.message}` });
      continue;
    }

    if (keyVersion === activeVersion) {
      alreadyCurrent.push(tx.id);
      continue;
    }

    toReencrypt.push({ tx, keyVersion });
  }

  console.log(`\nSummary:`);
  console.log(`  Already at current version (v${activeVersion}): ${alreadyCurrent.length}`);
  console.log(`  Needs re-encryption: ${toReencrypt.length}`);
  console.log(`  Skipped (no versioned memo): ${skipped.length}`);

  if (skipped.length > 0) {
    console.log('\nSkipped transactions:');
    skipped.forEach(s => console.log(`  ${s.id}: ${s.reason}`));
  }

  if (toReencrypt.length === 0) {
    console.log('\nNothing to re-encrypt. All memos are at the current key version.');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const updatedTransactions = [...transactions];

  for (const { tx, keyVersion } of toReencrypt) {
    const recipientSecret = recipientSecrets[tx.recipient];
    if (!recipientSecret) {
      console.warn(`  [SKIP] tx ${tx.id}: no recipient secret for ${tx.recipient}`);
      failed++;
      continue;
    }

    try {
      // Decrypt with old key version
      const plaintext = MemoEncryptionService.decryptMemoForRecipient(
        tx.memoEnvelope,
        recipientSecret
      );

      // Re-encrypt with current active key version
      const { memoEnvelope: newVersionedMemo, encryptionMetadata } =
        MemoEncryptionService.encryptMemoForRecipient(plaintext, tx.recipient);

      if (!DRY_RUN) {
        const idx = updatedTransactions.findIndex(t => t.id === tx.id);
        if (idx !== -1) {
          updatedTransactions[idx] = {
            ...updatedTransactions[idx],
            memoEnvelope: newVersionedMemo,
            encryptionMetadata,
          };
        }
      }

      console.log(`  [OK] tx ${tx.id}: re-encrypted from v${keyVersion} → v${activeVersion}`);
      succeeded++;
    } catch (err) {
      console.error(`  [FAIL] tx ${tx.id}: ${err.message}`);
      failed++;
    }
  }

  if (!DRY_RUN && succeeded > 0) {
    saveTransactions(updatedTransactions);
    console.log(`\nSaved ${succeeded} re-encrypted memo(s) to ${DONATIONS_PATH}`);
  }

  console.log(`\nResult: ${succeeded} succeeded, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
