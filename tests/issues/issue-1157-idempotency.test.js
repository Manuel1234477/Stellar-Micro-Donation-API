'use strict';

/**
 * Tests for #1157: Unique constraints / idempotency keys for donation creation
 *
 * Acceptance criteria:
 * 1. Duplicate submissions return the original donation (not a second record)
 * 2. A unique constraint at the DB layer enforces at-most-once persistence
 * 3. Concurrent identical requests resolve to a single record
 */

const Database = require('../../src/utils/database');
const Transaction = require('../../src/models/transaction');

// donations_store enforces 56-character G... addresses (migration 033)
const VALID_DONOR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_RECIPIENT = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureSchema() {
  // donations_store (migration 019)
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

  // transactions (migration 028 / initDB)
  await Database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicKey TEXT NOT NULL UNIQUE,
      encryptedSecret TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await Database.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      amount REAL NOT NULL,
      memo TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      idempotencyKey TEXT UNIQUE,
      stellar_tx_id TEXT
    )
  `);
}

async function clearTables() {
  for (const t of ['donations_store', 'transactions', 'idempotency_keys']) {
    await Database.run(`DELETE FROM ${t}`).catch(() => {});
  }
  Transaction._clearAllData && Transaction._clearAllData();
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('#1157 Idempotency keys / unique constraints for donation creation', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await clearTables();
  });

  // ── 1. DB-level unique constraint on donations_store ───────────────────────

  describe('DB-level unique constraint (donations_store.idempotency_key)', () => {
    it('rejects a second INSERT with the same idempotency_key', async () => {
      const key = 'idem-key-unique-test-001';
      const ts = new Date().toISOString();

      await Database.run(
        `INSERT INTO donations_store (id, amount_text, status, idempotency_key, timestamp, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['tx-1', '10', 'pending', key, ts, '{}']
      );

      await expect(
        Database.run(
          `INSERT INTO donations_store (id, amount_text, status, idempotency_key, timestamp, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['tx-2', '10', 'pending', key, ts, '{}']
        )
      ).rejects.toThrow(/UNIQUE constraint failed/i);
    });

    it('allows two rows with different idempotency keys', async () => {
      const ts = new Date().toISOString();

      await Database.run(
        `INSERT INTO donations_store (id, amount_text, status, idempotency_key, timestamp, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['tx-a', '10', 'pending', 'key-a', ts, '{}']
      );
      await Database.run(
        `INSERT INTO donations_store (id, amount_text, status, idempotency_key, timestamp, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['tx-b', '10', 'pending', 'key-b', ts, '{}']
      );

      const rows = await Database.all(
        'SELECT id FROM donations_store WHERE idempotency_key IN (?, ?)',
        ['key-a', 'key-b']
      );
      expect(rows).toHaveLength(2);
    });

    it('allows rows with NULL idempotency_key (no key provided)', async () => {
      const ts = new Date().toISOString();

      await Database.run(
        `INSERT INTO donations_store (id, amount_text, status, timestamp, data)
         VALUES (?, ?, ?, ?, ?)`,
        ['tx-null-1', '5', 'pending', ts, '{}']
      );
      await Database.run(
        `INSERT INTO donations_store (id, amount_text, status, timestamp, data)
         VALUES (?, ?, ?, ?, ?)`,
        ['tx-null-2', '5', 'pending', ts, '{}']
      );

      const rows = await Database.all(
        'SELECT id FROM donations_store WHERE idempotency_key IS NULL'
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 2. DB-level unique constraint on transactions.idempotencyKey ───────────

  describe('DB-level unique constraint (transactions.idempotencyKey)', () => {
    it('rejects a second INSERT with the same idempotencyKey', async () => {
      const key = 'idem-key-tx-test-001';

      // Insert a dummy sender/receiver first to satisfy FK if enabled
      await Database.run(
        `INSERT OR IGNORE INTO users (id, publicKey) VALUES (1, 'GA_SENDER'), (2, 'GA_RECEIVER')`
      ).catch(() => {});

      await Database.run(
        `INSERT INTO transactions (senderId, receiverId, amount, idempotencyKey) VALUES (1, 2, 10, ?)`,
        [key]
      );

      await expect(
        Database.run(
          `INSERT INTO transactions (senderId, receiverId, amount, idempotencyKey) VALUES (1, 2, 10, ?)`,
          [key]
        )
      ).rejects.toThrow(/UNIQUE constraint failed/i);
    });

    it('returns one row when selecting by idempotencyKey', async () => {
      const key = 'idem-key-select-test';

      await Database.run(
        `INSERT OR IGNORE INTO users (id, publicKey) VALUES (1, 'GA_SENDER'), (2, 'GA_RECEIVER')`
      ).catch(() => {});

      await Database.run(
        `INSERT INTO transactions (senderId, receiverId, amount, idempotencyKey) VALUES (1, 2, 5, ?)`,
        [key]
      );

      const row = await Database.get(
        'SELECT * FROM transactions WHERE idempotencyKey = ?',
        [key]
      );
      expect(row).toBeTruthy();
      expect(row.amount).toBe(5);
    });
  });

  // ── 3. Transaction.create in-memory replay ─────────────────────────────────

  describe('Transaction.create — in-memory idempotency', () => {
    it('returns existing record for duplicate idempotencyKey', () => {
      const key = `idem-create-${Date.now()}`;

      const first = Transaction.create({
        amount: 1.5,
        donor: VALID_DONOR,
        recipient: VALID_RECIPIENT,
        idempotencyKey: key,
      });

      const second = Transaction.create({
        amount: 99,
        donor: VALID_DONOR,
        recipient: VALID_RECIPIENT,
        idempotencyKey: key,
      });

      // Must be the same record — same id, original amount
      expect(second.id).toBe(first.id);
      expect(second.amount).toBe(1.5);
    });

    it('creates distinct records for different idempotency keys', () => {
      const first = Transaction.create({
        amount: 2,
        donor: VALID_DONOR,
        recipient: VALID_RECIPIENT,
        idempotencyKey: `key-first-${Date.now()}`,
      });

      const second = Transaction.create({
        amount: 2,
        donor: VALID_DONOR,
        recipient: VALID_RECIPIENT,
        idempotencyKey: `key-second-${Date.now()}`,
      });

      expect(second.id).not.toBe(first.id);
    });
  });

  // ── 4. Concurrent race: only one record created ────────────────────────────

  describe('Concurrent identical requests yield a single record', () => {
    it('donations_store: concurrent inserts with same key produce only one row', async () => {
      const key = `concurrent-idem-${Date.now()}`;
      const ts = new Date().toISOString();

      // Simulate N concurrent attempts by racing DB inserts
      const attempts = Array.from({ length: 5 }, (_, i) =>
        Database.run(
          `INSERT OR IGNORE INTO donations_store (id, amount_text, status, idempotency_key, timestamp, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [`race-tx-${i}`, '10', 'pending', key, ts, JSON.stringify({ amount: 10, i })]
        ).catch(() => null) // absorb UNIQUE errors
      );

      await Promise.all(attempts);

      const rows = await Database.all(
        'SELECT id FROM donations_store WHERE idempotency_key = ?',
        [key]
      );
      // Exactly one row survives regardless of concurrency
      expect(rows).toHaveLength(1);
    });

    it('Transaction.create: concurrent creates with same key return the same object', async () => {
      const key = `concurrent-create-${Date.now()}`;

      // Simulate concurrent synchronous calls (JS single-threaded; tests the idempotency guard)
      const results = Array.from({ length: 10 }, () =>
        Transaction.create({
          amount: 3,
          donor: VALID_DONOR,
          recipient: VALID_RECIPIENT,
          idempotencyKey: key,
        })
      );

      const uniqueIds = new Set(results.map(r => r.id));
      expect(uniqueIds.size).toBe(1);
      expect(results[0].amount).toBe(3);
    });

    it('Transaction.create: concurrent same-key creates leave one persisted record and one in-memory record', async () => {
      const key = `concurrent-idem-agreement-${Date.now()}`;
      const payload = {
        amount: 4,
        donor: VALID_DONOR,
        recipient: VALID_RECIPIENT,
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

      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      await new Promise(resolve => setTimeout(resolve, 100));
      const rows = await Database.all(
        'SELECT * FROM donations_store WHERE idempotency_key = ?',
        [key]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(results[0].id);
    });

    it('transactions table: concurrent inserts produce exactly one row via OR IGNORE', async () => {
      const key = `tx-race-${Date.now()}`;

      await Database.run(
        `INSERT OR IGNORE INTO users (id, publicKey) VALUES (1, 'GA_SENDER'), (2, 'GA_RECEIVER')`
      ).catch(() => {});

      const attempts = Array.from({ length: 5 }, (_, i) =>
        Database.run(
          `INSERT OR IGNORE INTO transactions (senderId, receiverId, amount, idempotencyKey) VALUES (1, 2, ?, ?)`,
          [10 + i, key]  // different amounts — only first wins
        ).catch(() => null)
      );

      await Promise.all(attempts);

      const rows = await Database.all(
        'SELECT * FROM transactions WHERE idempotencyKey = ?',
        [key]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(10); // first insert amount
    });
  });
});
