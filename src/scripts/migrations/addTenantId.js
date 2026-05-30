const db = require('../../utils/database');

async function migrate() {
  const tables = [
    'users',
    'transactions',
    'campaigns',
    'student_fees',
    'fee_payments',
    'api_keys',
    'recurring_donations'
  ];

  console.log('Running migration to add tenant_id...');
  
  for (const table of tables) {
    try {
      await db.run(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
      console.log(`✓ Added tenant_id to ${table}`);
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('duplicate column')) {
        console.log(`- Column tenant_id already exists in ${table}`);
      } else if (msg.includes('no such table')) {
        console.log(`- Table ${table} does not exist yet.`);
      } else {
        console.error(`✗ Error adding to ${table}: ${msg}`);
      }
    }
  }
  console.log('Migration complete.');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
