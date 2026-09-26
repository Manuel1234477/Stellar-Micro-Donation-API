#!/usr/bin/env node
'use strict';

/**
 * KEK (Key Encryption Key) rotation script.
 *
 * Rotates the master ENCRYPTION_KEY without data loss by re-wrapping each
 * memo's encryption key under the new KEK. The rotation is atomic at the database
 * level and blocks donation creation via the rotationLockMiddleware.
 *
 * Usage:
 *   ENCRYPTION_KEY=<old-key> NEW_ENCRYPTION_KEY=<new-key> node src/scripts/rotateKEK.js
 *
 * Safety guarantees:
 *   - Atomic: all memo re-encryptions happen in a single database transaction.
 *   - Blocking: during rotation, POST /donations returns HTTP 503 with Retry-After.
 *   - Idempotent: already-rotated rows (decrypt successfully with new key) are skipped.
 *   - Resumable: logs progress every 100 rows.
 *
 * After rotation completes:
 *   1. Set ENCRYPTION_KEY=<new-key> in your secrets manager
 *   2. Restart the API service
 *   3. Run --verify to confirm no record is still decryptable with the old key:
 *      ENCRYPTION_KEY=<old-key> node src/scripts/rotateKEK.js --verify
 */

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const Database = require('../utils/database');
const { getCacheTtlMs: getRotationLockCacheTtlMs } = require('../middleware/rotationLock');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const LOG_INTERVAL = 100;

function deriveKEK(rawKey) {
  if (!rawKey) throw new Error('Key must not be empty');
  return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptDEK(dek, kek) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

function decryptDEK(encryptedDEK, kek) {
  const parts = encryptedDEK.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted DEK format');
  const [ivHex, ctHex, tagHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, kek, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
}

async function rotate({ oldKey, newKey, verifyOnly }) {
  const oldKEK = deriveKEK(oldKey);
  const newKEK = deriveKEK(newKey);

  // Fetch all memos that need re-encryption (this is a read-only scan)
  const rows = await Database.query(
    'SELECT id, memo FROM donations WHERE memo IS NOT NULL AND deletedAt IS NULL ORDER BY id ASC',
    []
  );

  let rotated = 0;
  let skipped = 0;
  let errors = 0;

  if (verifyOnly) {
    for (const row of rows) {
      let envelope;
      try {
        envelope = JSON.parse(row.memo);
      } catch (_) {
        console.error(`Donation ${row.id}: unparseable memo envelope — skipping`);
        errors++;
        continue;
      }

      // Attempt to decrypt with the OLD key; if it succeeds, rotation is incomplete.
      try {
        decryptDEK(envelope.encryptedDEK, oldKEK);
        console.error(`Donation ${row.id}: still decryptable with old key — rotation incomplete`);
        errors++;
      } catch (_) {
        skipped++; // Cannot decrypt with old key — correctly rotated
      }
    }

    if (errors === 0) {
      console.log(`✓ Verify complete: all ${rows.length} memo(s) are correctly rotated.`);
    } else {
      console.error(`✗ Verify failed: ${errors} memo(s) still decryptable with the old key.`);
      process.exit(1);
    }
    return;
  }

  console.log(`Starting atomic re-encryption of ${rows.length} memo(s)...`);
  console.log('Note: API will return HTTP 503 during this operation.');

  try {
    // Mark rotation as in progress, blocking all donation writes
    await Database.run(
      `UPDATE rotation_locks SET status = ?, startedAt = ?, updatedAt = ? WHERE name = ?`,
      ['in_progress', new Date().toISOString(), new Date().toISOString(), 'memoEncryption']
    );

    // API instances cache the lock status for up to one TTL; wait it out so
    // every instance is rejecting donation writes before memos are rewritten.
    const lockPropagationMs = getRotationLockCacheTtlMs();
    if (lockPropagationMs > 0) {
      console.log(`Waiting ${lockPropagationMs}ms for API instances to observe the rotation lock...`);
      await new Promise((resolve) => setTimeout(resolve, lockPropagationMs)); // eslint-disable-line local/no-bare-timers
    }
    console.log('✓ Rotation lock acquired; API donations now return 503.');

    // Perform all re-encryption inside a single database transaction
    await Database.runTransaction(async (trx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        if (i % LOG_INTERVAL === 0 && i > 0) {
          console.log(`  Progress: ${i}/${rows.length} (${Math.round(100 * i / rows.length)}%)`);
        }

        let envelope;
        try {
          envelope = JSON.parse(row.memo);
        } catch (_) {
          console.error(`  Donation ${row.id}: unparseable memo envelope`);
          errors++;
          continue;
        }

        // Try new key first (idempotency: already rotated memos decrypt with new key)
        let dek;
        try {
          dek = decryptDEK(envelope.encryptedDEK, newKEK);
          // Successfully decrypted with new key — already rotated
          skipped++;
          continue;
        } catch (_) {
          // Expected: memo uses old key, proceed with re-wrap
        }

        try {
          dek = decryptDEK(envelope.encryptedDEK, oldKEK);
        } catch (err) {
          console.error(`  Donation ${row.id}: cannot decrypt with either key`);
          errors++;
          continue;
        }

        const newEncryptedDEK = encryptDEK(dek, newKEK);
        const newEnvelope = JSON.stringify({ ...envelope, encryptedDEK: newEncryptedDEK });

        await trx.run('UPDATE donations SET memo = ?, updatedAt = ? WHERE id = ?',
          [newEnvelope, new Date().toISOString(), row.id]);

        rotated++;
      }
    });

    // Mark rotation as complete
    await Database.run(
      `UPDATE rotation_locks SET status = ?, completedAt = ?, updatedAt = ? WHERE name = ?`,
      ['idle', new Date().toISOString(), new Date().toISOString(), 'memoEncryption']
    );

    console.log(`\n✓ Rotation complete: ${rotated} rotated, ${skipped} already up-to-date, ${errors} error(s).`);
    console.log('✓ Rotation lock released; API donations now accept requests again.');

    if (errors > 0) {
      console.error(`⚠ ${errors} memo(s) could not be rotated. Review the errors above.`);
      process.exit(1);
    }

    console.log('\nNext steps:');
    console.log('  1. Set ENCRYPTION_KEY=<new-key> in your secrets manager');
    console.log('  2. Restart all API instances');
    console.log('  3. Run: ENCRYPTION_KEY=<old-key> node src/scripts/rotateKEK.js --verify');
  } catch (err) {
    // On error, mark rotation as failed and release the lock
    await Database.run(
      `UPDATE rotation_locks SET status = ?, completedAt = ?, error = ?, updatedAt = ? WHERE name = ?`,
      ['failed', new Date().toISOString(), err.message, new Date().toISOString(), 'memoEncryption']
    ).catch(() => {
      // Ignore errors releasing the lock on failure
    });

    throw err;
  }
}

const verifyOnly = process.argv.includes('--verify');
const oldKey = process.env.ENCRYPTION_KEY;
const newKey = verifyOnly ? process.env.ENCRYPTION_KEY : process.env.NEW_ENCRYPTION_KEY;

if (!oldKey) {
  console.error('✗ ENCRYPTION_KEY (old key) is required.');
  process.exit(1);
}
if (!verifyOnly && !newKey) {
  console.error('✗ NEW_ENCRYPTION_KEY is required for rotation.');
  process.exit(1);
}
if (!verifyOnly && oldKey === newKey) {
  console.error('✗ ENCRYPTION_KEY and NEW_ENCRYPTION_KEY must be different.');
  process.exit(1);
}

rotate({ oldKey, newKey, verifyOnly })
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('✗ Rotation failed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
