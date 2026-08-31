'use strict';

exports.name = '034_campaign_milestone_notifications';

exports.up = async (db) => {
  // Add milestone tracking columns to campaigns table
  // Stores bitmask of reached milestones: 1 = 25%, 2 = 50%, 4 = 75%, 8 = 100%
  await db.run(`
    ALTER TABLE campaigns ADD COLUMN milestones_reached INTEGER NOT NULL DEFAULT 0
  `);
  
  // Add email notification preference
  await db.run(`
    ALTER TABLE campaigns ADD COLUMN notification_email TEXT
  `);
};

exports.down = async (db) => {
  // SQLite doesn't support DROP COLUMN in older versions, so we'd need to recreate the table
  // For now, we'll leave the columns in place during rollback
  console.warn('Rollback: campaign milestone columns will remain (SQLite limitation)');
};
