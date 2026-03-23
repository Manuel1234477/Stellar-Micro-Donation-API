/**
 * Tests: Transaction Rollback on Partial Failure
 *
 * Covers:
 *  - stellar_tx_id stored in DB after successful donation
 *  - Orphan detection: Stellar tx exists but no local DB record
 *  - Compensation: local record created for each orphan
 *  - Orphan count metric in stats endpoint
 *  - POST /admin/reconcile endpoint
 *  - Alerting when orphan threshold is exceeded
 *  - Edge cases: duplicate compensation, unknown sender/receiver, empty state
 */

const request = require('supertest');
const app = require('../src/routes/app');
const Database = require('../src/utils/database');
const MockStellarService = require('../src/services/MockStellarService');
const TransactionReconciliationService = require('../src/services/TransactionReconciliationService');
const encryption = require('../src/utils/encryption');

const ADMIN_KEY = 'admin-test-key';
const USER_KEY = 'test-key-1';

// Valid Stellar key format: prefix + 55 base32 chars = 56 total
const SENDER_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SENDER_PUBLIC = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RECEIVER_PUBLIC = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

let senderId;
let receiverId;
let mockStellar;
let reconciler;

beforeAll(async () => {
  const encSecret = encryption.encrypt(SENDER_SECRET);

  const sRes = await Database.run(
    'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
    [SENDER_PUBLIC, encSecret]
  );
  senderId = sRes.id;

  const rRes = await Database.run(
    'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
    [RECEIVER_PUBLIC, encSecret]
  );
  receiverId = rRes.id;

  // Fund both wallets in the mock service used by the app's service container
  const serviceContainer = require('../src/config/serviceContainer');
  mockStellar = serviceContainer.getStellarService();

  mockStellar.wallets.set(SENDER_PUBLIC, {
    publicKey: SENDER_PUBLIC,
    secretKey: SENDER_SECRET,
    balance: '10000.0000000',
    sequence: '1',
  });
  mockStellar.wallets.set(RECEIVER_PUBLIC, {
    publicKey: RECEIVER_PUBLIC,
    secretKey: SENDER_SECRET,
    balance: '1000.0000000',
    sequence: '0',
  });
  mockStellar.transactions.set(SENDER_PUBLIC, []);
  mockStellar.transactions.set(RECEIVER_PUBLIC, []);

  // Build a reconciler that shares the same mock stellar instance
  reconciler = new TransactionReconciliationService(mockStellar);
});

afterEach(async () => {
  // Clean up transactions between tests
  await Database.run(
    'DELETE FROM transactions WHERE senderId = ? OR receiverId = ?',
    [senderId, receiverId]
  );
  // Reset mock stellar transactions
  mockStellar.transactions.set(SENDER_PUBLIC, []);
  mockStellar.transactions.set(RECEIVER_PUBLIC, []);
  // Reset reconciler orphan counter
  reconciler.orphanedTransactionCount = 0;
  mockStellar.disableFailureSimulation();
});

// ─── stellar_tx_id stored in DB ───────────────────────────────────────────────

describe('stellar_tx_id stored in DB', () => {
  let idempotencyCounter = 0;
  const nextKey = () => `idem-rollback-${++idempotencyCounter}-${Date.now()}`;

  test('successful donation stores stellar_tx_id in transactions table', async () => {
    const res = await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 10 });

    expect(res.status).toBe(201);

    const row = await Database.get(
      'SELECT stellar_tx_id FROM transactions WHERE senderId = ?',
      [senderId]
    );
    expect(row).toBeDefined();
    expect(row.stellar_tx_id).toBeTruthy();
    expect(row.stellar_tx_id).toMatch(/^mock_/);
  });

  test('stellar_tx_id is unique per transaction', async () => {
    await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 5 });

    await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 5 });

    const rows = await Database.query(
      'SELECT stellar_tx_id FROM transactions WHERE senderId = ?',
      [senderId]
    );
    expect(rows.length).toBe(2);
    expect(rows[0].stellar_tx_id).not.toBe(rows[1].stellar_tx_id);
  });

  test('is_orphan defaults to 0 for normal donations', async () => {
    await request(app)
      .post('/donations/send')
      .set('Idempotency-Key', nextKey())
      .send({ senderId, receiverId, amount: 10 });

    const row = await Database.get(
      'SELECT is_orphan FROM transactions WHERE senderId = ?',
      [senderId]
    );
    expect(row.is_orphan).toBe(0);
  });
});

// ─── Orphan detection ─────────────────────────────────────────────────────────

describe('TransactionReconciliationService — orphan detection', () => {
  test('returns zero orphans when Stellar and DB are in sync', async () => {
    // Insert a DB record with a matching stellar_tx_id
    const txId = 'mock_sync_' + Date.now();
    mockStellar.transactions.get(SENDER_PUBLIC).push({
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '10.0000000',
      memo: '',
      timestamp: new Date().toISOString(),
      ledger: 1000001,
    });
    mockStellar.transactions.get(RECEIVER_PUBLIC).push({
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '10.0000000',
      memo: '',
      timestamp: new Date().toISOString(),
      ledger: 1000001,
    });

    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, stellar_tx_id) VALUES (?, ?, ?, ?)',
      [senderId, receiverId, 10, txId]
    );

    const { detected } = await reconciler.detectAndCompensateOrphans();
    expect(detected).toBe(0);
  });

  test('detects orphan when Stellar tx has no DB record', async () => {
    const txId = 'mock_orphan_' + Date.now();
    mockStellar.transactions.get(SENDER_PUBLIC).push({
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '20.0000000',
      memo: 'orphan',
      timestamp: new Date().toISOString(),
      ledger: 1000002,
    });

    const { detected } = await reconciler.detectAndCompensateOrphans();
    expect(detected).toBeGreaterThanOrEqual(1);
  });

  test('does not double-count the same Stellar tx from multiple wallet lists', async () => {
    const txId = 'mock_dedup_' + Date.now();
    const tx = {
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '15.0000000',
      memo: '',
      timestamp: new Date().toISOString(),
      ledger: 1000003,
    };
    // Same tx appears in both sender and receiver lists (normal Stellar behaviour)
    mockStellar.transactions.get(SENDER_PUBLIC).push(tx);
    mockStellar.transactions.get(RECEIVER_PUBLIC).push(tx);

    const { detected } = await reconciler.detectAndCompensateOrphans();
    // Should count as exactly 1 orphan, not 2
    expect(detected).toBe(1);
  });

  test('returns zero orphans when Stellar has no transactions', async () => {
    const { detected } = await reconciler.detectAndCompensateOrphans();
    expect(detected).toBe(0);
  });
});

// ─── Compensation ─────────────────────────────────────────────────────────────

describe('TransactionReconciliationService — compensation', () => {
  test('compensateOrphan creates a local DB record', async () => {
    const txId = 'mock_comp_' + Date.now();
    const orphan = {
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '30.0000000',
      memo: 'compensation test',
      timestamp: new Date().toISOString(),
    };

    const success = await reconciler.compensateOrphan(orphan);
    expect(success).toBe(true);

    const row = await Database.get(
      'SELECT * FROM transactions WHERE stellar_tx_id = ?',
      [txId]
    );
    expect(row).toBeDefined();
    expect(row.stellar_tx_id).toBe(txId);
    expect(row.is_orphan).toBe(1);
    expect(row.amount).toBe(30);
    expect(row.senderId).toBe(senderId);
    expect(row.receiverId).toBe(receiverId);
  });

  test('compensation is idempotent — second call does not throw', async () => {
    const txId = 'mock_idem_comp_' + Date.now();
    const orphan = {
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '5.0000000',
      memo: '',
      timestamp: new Date().toISOString(),
    };

    await reconciler.compensateOrphan(orphan);
    // Second call should not throw (INSERT OR IGNORE)
    const success2 = await reconciler.compensateOrphan(orphan);
    expect(success2).toBe(true);

    const rows = await Database.query(
      'SELECT id FROM transactions WHERE stellar_tx_id = ?',
      [txId]
    );
    expect(rows.length).toBe(1);
  });

  test('compensation stores null senderId/receiverId for unknown public keys', async () => {
    const txId = 'mock_unknown_' + Date.now();
    const orphan = {
      transactionId: txId,
      source: 'GUNKNOWNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      destination: 'GUNKNOWNBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amount: '1.0000000',
      memo: '',
      timestamp: new Date().toISOString(),
    };

    const success = await reconciler.compensateOrphan(orphan);
    expect(success).toBe(true);

    const row = await Database.get(
      'SELECT senderId, receiverId, is_orphan FROM transactions WHERE stellar_tx_id = ?',
      [txId]
    );
    expect(row).toBeDefined();
    expect(row.senderId).toBeNull();
    expect(row.receiverId).toBeNull();
    expect(row.is_orphan).toBe(1);
  });

  test('full reconcile cycle detects and compensates orphans', async () => {
    const txId = 'mock_full_' + Date.now();
    mockStellar.transactions.get(SENDER_PUBLIC).push({
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '50.0000000',
      memo: 'full cycle',
      timestamp: new Date().toISOString(),
      ledger: 1000010,
    });

    const result = await reconciler.reconcile();
    expect(result.orphansDetected).toBeGreaterThanOrEqual(1);
    expect(result.orphansCompensated).toBeGreaterThanOrEqual(1);

    const row = await Database.get(
      'SELECT is_orphan FROM transactions WHERE stellar_tx_id = ?',
      [txId]
    );
    expect(row).toBeDefined();
    expect(row.is_orphan).toBe(1);
  });
});

// ─── Alerting ─────────────────────────────────────────────────────────────────

describe('TransactionReconciliationService — alerting', () => {
  test('_emitOrphanAlert does not throw', () => {
    expect(() => {
      reconciler._emitOrphanAlert([
        { transactionId: 'mock_alert_1', source: SENDER_PUBLIC, destination: RECEIVER_PUBLIC, amount: '1' },
      ]);
    }).not.toThrow();
  });

  test('orphanedTransactionCount increments after detection', async () => {
    const txId = 'mock_count_' + Date.now();
    mockStellar.transactions.get(SENDER_PUBLIC).push({
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '10.0000000',
      memo: '',
      timestamp: new Date().toISOString(),
      ledger: 1000020,
    });

    await reconciler.detectAndCompensateOrphans();
    expect(reconciler.orphanedTransactionCount).toBeGreaterThanOrEqual(1);
  });

  test('getOrphanedTransactionCount returns current count', () => {
    reconciler.orphanedTransactionCount = 7;
    expect(reconciler.getOrphanedTransactionCount()).toBe(7);
  });
});

// ─── POST /admin/reconcile endpoint ──────────────────────────────────────────

describe('POST /admin/reconcile', () => {
  test('admin can trigger reconciliation', async () => {
    const res = await request(app)
      .post('/admin/reconcile')
      .set('x-api-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data.corrected).toBe('number');
    expect(typeof res.body.data.orphansDetected).toBe('number');
    expect(typeof res.body.data.orphansCompensated).toBe('number');
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .post('/admin/reconcile')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app)
      .post('/admin/reconcile');

    expect(res.status).toBe(401);
  });

  test('returns 409 when reconciliation already in progress', async () => {
    const serviceContainer = require('../src/config/serviceContainer');
    const svc = serviceContainer.getTransactionReconciliationService();
    svc.reconciliationInProgress = true;

    const res = await request(app)
      .post('/admin/reconcile')
      .set('x-api-key', ADMIN_KEY);

    expect(res.status).toBe(409);
    svc.reconciliationInProgress = false;
  });
});

// ─── GET /stats/orphaned-transactions ────────────────────────────────────────

describe('GET /stats/orphaned-transactions', () => {
  test('returns orphaned_transactions count', async () => {
    // Insert an orphan record directly
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, stellar_tx_id, is_orphan) VALUES (?, ?, ?, ?, 1)',
      [senderId, receiverId, 99, 'mock_stats_orphan_' + Date.now()]
    );

    const res = await request(app)
      .get('/stats/orphaned-transactions')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orphaned_transactions).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.data.totalOrphanedAmount).toBe('number');
  });

  test('returns zero when no orphans exist', async () => {
    const res = await request(app)
      .get('/stats/orphaned-transactions')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.orphaned_transactions).toBe(0);
  });
});

// ─── GET /admin/orphaned-transactions ────────────────────────────────────────

describe('GET /admin/orphaned-transactions', () => {
  test('admin can list orphaned transactions', async () => {
    const txId = 'mock_admin_list_' + Date.now();
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, stellar_tx_id, is_orphan) VALUES (?, ?, ?, ?, 1)',
      [senderId, receiverId, 42, txId]
    );

    const res = await request(app)
      .get('/admin/orphaned-transactions')
      .set('x-api-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
    const found = res.body.data.transactions.find(t => t.stellar_tx_id === txId);
    expect(found).toBeDefined();
  });

  test('non-admin gets 403', async () => {
    const res = await request(app)
      .get('/admin/orphaned-transactions')
      .set('x-api-key', USER_KEY);

    expect(res.status).toBe(403);
  });
});

// ─── getStatus includes orphan count ─────────────────────────────────────────

describe('TransactionReconciliationService.getStatus', () => {
  test('includes orphanedTransactionCount', () => {
    reconciler.orphanedTransactionCount = 3;
    const status = reconciler.getStatus();
    expect(status.orphanedTransactionCount).toBe(3);
    expect(status.isRunning).toBe(false);
    expect(typeof status.checkIntervalMinutes).toBe('number');
  });
});

// ─── _getAllStellarTransactions ───────────────────────────────────────────────

describe('TransactionReconciliationService._getAllStellarTransactions', () => {
  test('returns empty array when no transactions exist', () => {
    const txs = reconciler._getAllStellarTransactions();
    expect(Array.isArray(txs)).toBe(true);
    expect(txs.length).toBe(0);
  });

  test('deduplicates transactions appearing in multiple wallet lists', () => {
    const txId = 'mock_dedup2_' + Date.now();
    const tx = {
      transactionId: txId,
      source: SENDER_PUBLIC,
      destination: RECEIVER_PUBLIC,
      amount: '5.0000000',
    };
    mockStellar.transactions.get(SENDER_PUBLIC).push(tx);
    mockStellar.transactions.get(RECEIVER_PUBLIC).push(tx);

    const txs = reconciler._getAllStellarTransactions();
    const matches = txs.filter(t => t.transactionId === txId);
    expect(matches.length).toBe(1);
  });

  test('returns empty array for non-MockStellarService', () => {
    const fakeReconciler = new TransactionReconciliationService({ transactions: null });
    expect(fakeReconciler._getAllStellarTransactions()).toEqual([]);
  });
});
