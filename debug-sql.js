const db = require('./src/utils/database');
const { createApiKey } = require('./src/models/apiKeys');

async function debug() {
  try {
    process.env.NODE_ENV = 'test'; // Ensure test env
    await db.run('DELETE FROM api_keys');
    const result = await createApiKey({
      keyPrefix: 'test_',
      name: 'Test Key',
      role: 'admin',
      createdBy: 'test_user',
      metadata: { source: 'test' },
      scopes: ['read', 'write'],
      expiresAt: Date.now() + 86400000
    });
    console.log('SUCCESS:', result);
  } catch (err) {
    console.error('FAILURE ERROR:', err);
    if (err.originalError) {
      console.error('ORIGINAL SQL ERROR:', err.originalError);
    }
  } finally {
    await db.close();
  }
}

debug();
