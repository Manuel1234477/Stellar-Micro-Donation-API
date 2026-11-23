/**
 * Migration: Fix Invalid Frequencies in Recurring Donations (Issue #888)
 * 
 * Scans recurring_donations table for invalid frequency values and suspends them.
 * Valid frequencies: daily, weekly, monthly
 * Invalid frequencies are marked as suspended with a reason.
 */

const Database = require('../../utils/database');
const log = require('../../utils/log');

async function up() {
  try {
    log.info('MIGRATION', 'Starting: Fix invalid frequencies in recurring_donations');

    // Add suspendReason column if it doesn't exist
    try {
      await Database.run(`
        ALTER TABLE recurring_donations 
        ADD COLUMN suspendReason TEXT DEFAULT NULL
      `);
      log.info('MIGRATION', 'Added suspendReason column');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err;
      }
      log.info('MIGRATION', 'suspendReason column already exists');
    }

    // Find all records with invalid frequencies
    const invalidRecords = await Database.all(`
      SELECT id, frequency, status 
      FROM recurring_donations 
      WHERE frequency NOT IN ('daily', 'weekly', 'monthly')
      AND status != 'suspended'
    `);

    if (invalidRecords.length === 0) {
      log.info('MIGRATION', 'No invalid frequencies found');
      return;
    }

    log.warn('MIGRATION', `Found ${invalidRecords.length} records with invalid frequencies`, {
      frequencies: invalidRecords.map(r => r.frequency)
    });

    // Suspend all invalid records
    for (const record of invalidRecords) {
      await Database.run(`
        UPDATE recurring_donations 
        SET status = 'suspended', suspendReason = 'invalid_frequency'
        WHERE id = ?
      `, [record.id]);
    }

    log.info('MIGRATION', `Suspended ${invalidRecords.length} records with invalid frequencies`);
  } catch (error) {
    log.error('MIGRATION', 'Failed to fix invalid frequencies', { error: error.message });
    throw error;
  }
}

async function down() {
  try {
    log.info('MIGRATION', 'Reversing: Fix invalid frequencies');
    // Restore suspended records (set status back to active)
    await Database.run(`
      UPDATE recurring_donations 
      SET status = 'active', suspendReason = NULL
      WHERE suspendReason = 'invalid_frequency'
    `);
    log.info('MIGRATION', 'Restored suspended records');
  } catch (error) {
    log.error('MIGRATION', 'Failed to reverse migration', { error: error.message });
    throw error;
  }
}

module.exports = { up, down };
