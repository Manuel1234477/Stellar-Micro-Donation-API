/**
 * SQLite single-writer tests (Issue #1959)
 *
 * Covers the writer queue, statement classification, and concurrent writes and
 * transactions against a real temporary database. The concurrency tests fail on
 * the previous pooled design with SQLITE_BUSY.
 */

process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isWriteStatement,
  WriterQueue,
  setWaitObserver,
  writerQueue,
} = require('../../src/utils/sqliteWriter');

describe('isWriteStatement', () => {
  test.each([
    ['SELECT * FROM users', false],
    ['  select id from donations_store where id = ?', false],
    ['EXPLAIN QUERY PLAN SELECT 1', false],
    ['WITH x AS (SELECT 1) SELECT * FROM x', false],
    ['PRAGMA table_info(users)', false],
    ['PRAGMA journal_mode=WAL', true],
    ['INSERT INTO t VALUES (1)', true],
    ['UPDATE t SET a = 1', true],
    ['DELETE FROM t', true],
    ['WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', true],
    ['CREATE TABLE t (id INTEGER)', true],
    ['BEGIN IMMEDIATE', true],
  ])('%s -> write=%s', (sql, expected) => {
    expect(isWriteStatement(sql)).toBe(expected);
  });
});

describe('WriterQueue', () => {
  test('grants the slot in FIFO order and never overlaps holders', async () => {
    const queue = new WriterQueue();
    const order = [];
    let inside = 0;
    let maxInside = 0;

    const task = async (label, holdMs) => {
      const lease = await queue.acquire();
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      order.push(`start:${label}`);
      await new Promise((r) => setTimeout(r, holdMs));
      order.push(`end:${label}`);
      inside -= 1;
      lease.release();
    };

    await Promise.all([task('a', 15), task('b', 1), task('c', 1)]);

    expect(maxInside).toBe(1);
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  test('reports queue depth and wait statistics', async () => {
    const queue = new WriterQueue();
    const first = await queue.acquire();
    const second = queue.acquire();
    const third = queue.acquire();

    expect(queue.getStats().queueDepth).toBe(2);

    first.release();
    const secondLease = await second;
    expect(queue.getStats().queueDepth).toBe(1);

    secondLease.release();
    (await third).release();

    const stats = queue.getStats();
    expect(stats.queueDepth).toBe(0);
    expect(stats.acquisitions).toBe(3);
    expect(stats.maxQueueDepth).toBeGreaterThanOrEqual(2);
    expect(stats.maxWaitMs).toBeGreaterThanOrEqual(stats.avgWaitMs);
  });

  test('release() is idempotent and does not free the slot twice', async () => {
    const queue = new WriterQueue();
    const lease = await queue.acquire();
    lease.release();
    lease.release();

    // A second acquirer must still get the slot (not be granted early).
    const next = await queue.acquire();
    expect(next).toBeDefined();
    next.release();
  });

  test('calls the wait observer with seconds for each acquisition', async () => {
    const seen = [];
    setWaitObserver((s) => seen.push(s));
    try {
      (await writerQueue.acquire()).release();
    } finally {
      setWaitObserver(null);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('concurrent writes through the writer connection', () => {
  let Database;
  let tmpDir;
  const originalDbPath = process.env.DB_PATH;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-writer-'));
    process.env.DB_PATH = path.join(tmpDir, 'writer.db');
    jest.isolateModules(() => {
      Database = require('../../src/utils/database');
    });
    await Database.run('CREATE TABLE IF NOT EXISTS writer_test (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
  });

  afterAll(async () => {
    await Database.close();
    process.env.DB_PATH = originalDbPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('many concurrent single-statement writes all succeed without SQLITE_BUSY', async () => {
    const writes = Array.from({ length: 200 }, (_, i) =>
      Database.run('INSERT INTO writer_test (v) VALUES (?)', [`row-${i}`]),
    );
    await expect(Promise.all(writes)).resolves.toHaveLength(200);

    const row = await Database.get('SELECT COUNT(*) AS n FROM writer_test WHERE v LIKE ?', ['row-%']);
    expect(row.n).toBe(200);
  });

  test('concurrent transactions are serialised and each commits fully', async () => {
    const txs = Array.from({ length: 25 }, (_, i) =>
      Database.runTransaction(async (tx) => {
        await tx.run('INSERT INTO writer_test (v) VALUES (?)', [`tx-${i}-a`]);
        await tx.run('INSERT INTO writer_test (v) VALUES (?)', [`tx-${i}-b`]);
        return i;
      }),
    );
    await expect(Promise.all(txs)).resolves.toHaveLength(25);

    const row = await Database.get('SELECT COUNT(*) AS n FROM writer_test WHERE v LIKE ?', ['tx-%']);
    expect(row.n).toBe(50);
  });

  test('a failing transaction rolls back and leaves no rows', async () => {
    await expect(
      Database.runTransaction(async (tx) => {
        await tx.run('INSERT INTO writer_test (v) VALUES (?)', ['rollback-me']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const row = await Database.get('SELECT COUNT(*) AS n FROM writer_test WHERE v = ?', ['rollback-me']);
    expect(row.n).toBe(0);
  });

  test('global Database.run inside a transaction joins it instead of deadlocking', async () => {
    await Database.runTransaction(async () => {
      await Database.run('INSERT INTO writer_test (v) VALUES (?)', ['nested-global']);
    });

    const row = await Database.get('SELECT COUNT(*) AS n FROM writer_test WHERE v = ?', ['nested-global']);
    expect(row.n).toBe(1);
  });

  test('nested runTransaction inside a transaction joins the outer one', async () => {
    await Database.runTransaction(async (outer) => {
      await outer.run('INSERT INTO writer_test (v) VALUES (?)', ['outer']);
      await Database.runTransaction(async (inner) => {
        await inner.run('INSERT INTO writer_test (v) VALUES (?)', ['inner']);
      });
    });

    const row = await Database.get("SELECT COUNT(*) AS n FROM writer_test WHERE v IN ('outer','inner')");
    expect(row.n).toBe(2);
  });

  test('getWriterMetrics reports the connection and queue state', async () => {
    await Database.run('INSERT INTO writer_test (v) VALUES (?)', ['metrics']);
    const metrics = Database.getWriterMetrics();
    expect(metrics.connected).toBe(true);
    expect(metrics.acquisitions).toBeGreaterThan(0);
    expect(metrics.queueDepth).toBe(0);
  });
});
