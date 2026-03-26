/**
 * Migration: Upgrade legacy single-key encrypted secrets to envelope encryption (v2).
 *
 * Safe to run multiple times — already-migrated rows (JSON starting with '{') are skipped.
 *
 * Usage:
 *   node src/scripts/migrations/migrateToEnvelopeEncryption.js
 */

'use strict';

require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { encryptWithDEK, decrypt } = require('../../utils/encryption');

const DB_PATH = path.join(__dirname, '../../../../data/stellar_donations.db');

async function migrate() {
  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(DB_PATH, (err) =>
      err ? reject(err) : resolve(conn)
    );
  });

  const rows = await new Promise((resolve, reject) =>
    db.all('SELECT id, encryptedSecret FROM users WHERE encryptedSecret IS NOT NULL', [], (err, r) =>
      err ? reject(err) : resolve(r)
    )
  );

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    // Already v2 envelope
    if (row.encryptedSecret.startsWith('{')) {
      skipped++;
      continue;
    }

    const plaintext = decrypt(row.encryptedSecret);
    const newEnvelope = await encryptWithDEK(plaintext);

    await new Promise((resolve, reject) =>
      db.run('UPDATE users SET encryptedSecret = ? WHERE id = ?', [newEnvelope, row.id], (err) =>
        err ? reject(err) : resolve()
      )
    );
    migrated++;
  }

  db.close();
  console.log(`Migration complete: ${migrated} migrated, ${skipped} already up-to-date.`);
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
