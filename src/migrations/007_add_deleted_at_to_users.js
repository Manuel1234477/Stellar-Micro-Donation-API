'use strict';

exports.name = '007_add_deleted_at_to_users';

exports.up = async (db) => {
  try {
    const columns = await db.all(
      "PRAGMA table_info(users)"
    );
    
    const hasDeletedAt = columns.some(col => col.name === 'deleted_at');
    
    if (!hasDeletedAt) {
      await db.run(
        `ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL`
      );
      console.log('✓ Added deleted_at column to users table');
    } else {
      console.log('✓ deleted_at column already exists on users table');
    }
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  }
};

exports.down = async (db) => {
  console.log('⚠ Rollback not supported for this migration (SQLite limitation)');
};
