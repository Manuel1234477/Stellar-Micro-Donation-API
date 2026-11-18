const Database = require('../src/utils/database');
const Transaction = require('../src/models/transaction');

async function ensureDonationsStore() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS donations_store (
      id TEXT PRIMARY KEY,
      donor TEXT,
      recipient TEXT,
      amount_stroops INTEGER,
      amount_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT UNIQUE,
      stellar_tx_id TEXT UNIQUE,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      status_updated_at TEXT,
      deleted_at TEXT,
      data TEXT NOT NULL DEFAULT '{}'
    )
  `);
}

async function waitForRowCount(sql, params, expectedCount, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await Database.all(sql, params);
    if (rows.length === expectedCount) {
      return rows;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return await Database.all(sql, params);
}

describe('Transaction.create idempotency atomicity', () => {
  beforeAll(async () => {
    await ensureDonationsStore();
  });

  beforeEach(async () => {
    Transaction._clearAllData();
    await Database.run('DELETE FROM donations_store');
  });

  test('concurrent create calls with same idempotencyKey leave one persisted row and one in-memory record', async () => {
    const key = `atomic-idem-${Date.now()}`;
    const payload = {
      amount: 7,
      donor: 'G' + 'C'.repeat(55),
      recipient: 'G' + 'T'.repeat(55),
      idempotencyKey: key,
    };

    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        new Promise(resolve => setImmediate(() => resolve(Transaction.create(payload))))
      )
    );

    const uniqueIds = new Set(results.map(r => r.id));
    expect(uniqueIds.size).toBe(1);

    const inMemoryMatches = Transaction.getAll().filter(t => t.idempotencyKey === key);
    expect(inMemoryMatches).toHaveLength(1);
    expect(inMemoryMatches[0].id).toBe(results[0].id);

    const rows = await waitForRowCount(
      'SELECT * FROM donations_store WHERE idempotency_key = ?',
      [key],
      1
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(results[0].id);
  });
});
