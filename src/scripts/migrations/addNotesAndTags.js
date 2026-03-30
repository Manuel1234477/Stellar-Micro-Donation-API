const db = require('../../utils/database');
const log = require('../../utils/log');

async function up() {
  log.info('MIGRATION', 'Adding notes and tags to transactions table...');

  try {
    await db.ensureInitialized();
    await db.run('ALTER TABLE transactions ADD COLUMN notes TEXT');
    await db.run('ALTER TABLE transactions ADD COLUMN tags TEXT');
    log.info('MIGRATION', 'Successfully added notes and tags columns.');
  } catch (error) {
    if (error.message.includes('duplicate column name')) {
      log.info('MIGRATION', 'Columns notes and tags already exist, skipping.');
    } else {
      log.error('MIGRATION', 'Failed to add notes and tags columns', { error: error.message });
      throw error;
    }
  }
}

async function down() {
  log.info('MIGRATION', 'Removing notes and tags is not supported in SQLite ALTER TABLE.');
}

module.exports = {
  up,
  down
};
