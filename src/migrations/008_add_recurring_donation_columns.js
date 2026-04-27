'use strict';

exports.name = '008_add_recurring_donation_columns';

exports.up = async (db) => {
  try {
    const columns = await db.all(
      "PRAGMA table_info(recurring_donations)"
    );
    
    const columnNames = columns.map(col => col.name);
    const missingColumns = [
      'customIntervalDays',
      'maxExecutions',
      'webhookUrl',
      'failureCount',
      'lastExecutionDate'
    ].filter(col => !columnNames.includes(col));

    for (const col of missingColumns) {
      let columnDef = '';
      switch (col) {
        case 'customIntervalDays':
          columnDef = 'INTEGER DEFAULT NULL';
          break;
        case 'maxExecutions':
          columnDef = 'INTEGER DEFAULT NULL';
          break;
        case 'webhookUrl':
          columnDef = 'TEXT DEFAULT NULL';
          break;
        case 'failureCount':
          columnDef = 'INTEGER DEFAULT 0';
          break;
        case 'lastExecutionDate':
          columnDef = 'DATETIME DEFAULT NULL';
          break;
      }

      await db.run(
        `ALTER TABLE recurring_donations ADD COLUMN ${col} ${columnDef}`
      );
      console.log(`✓ Added ${col} column to recurring_donations table`);
    }

    if (missingColumns.length === 0) {
      console.log('✓ All required columns already exist on recurring_donations table');
    }
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
};

exports.down = async (db) => {
  console.log('⚠ Rollback not supported for this migration (SQLite limitation)');
};
