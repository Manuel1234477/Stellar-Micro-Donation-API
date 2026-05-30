/**
 * Migration: Add notification columns to api_keys table
 *
 * Adds:
 *   - notification_email: optional email address for expiry notifications
 *   - last_expiry_notification_sent_at: tracks which notification threshold was last sent
 *     (stores the threshold in days, e.g. 7 or 1, to prevent duplicate sends)
 */

const db = require('../../utils/database');

async function up() {
  const columns = [
    { name: 'notification_email', def: 'TEXT' },
    { name: 'last_expiry_notification_sent_at', def: 'INTEGER' },
  ];

  for (const col of columns) {
    try {
      await db.run(`ALTER TABLE api_keys ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✓ Added column api_keys.${col.name}`);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('duplicate column') || msg.includes('already exists')) {
        console.log(`  Column api_keys.${col.name} already exists — skipping`);
      } else {
        throw err;
      }
    }
  }
}

if (require.main === module) {
  up()
    .then(() => { console.log('Migration complete'); process.exit(0); })
    .catch(err => { console.error('Migration failed:', err); process.exit(1); });
}

module.exports = { up };
