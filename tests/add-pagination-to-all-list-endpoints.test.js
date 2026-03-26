const fs = require('fs');
const path = require('path');
const request = require('supertest');

const tempDonationsPath = path.join(__dirname, 'tmp-pagination-donations.json');
process.env.DB_JSON_PATH = tempDonationsPath;

const app = require('../src/routes/app');
const Transaction = require('../src/routes/models/transaction');
const Wallet = require('../src/routes/models/wallet');
const Database = require('../src/utils/database');
const { encodeCursor } = require('../src/utils/pagination');

const walletsPath = path.join(__dirname, '../data/wallets.json');
const originalWalletsExists = fs.existsSync(walletsPath);
const originalWalletsContents = originalWalletsExists
  ? fs.readFileSync(walletsPath, 'utf8')
  : null;

function resetJsonFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '[]');
}

function createIsoTimestamp(index) {
  return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

function seedDonations(count) {
  for (let index = 1; index <= count; index += 1) {
    Transaction.create({
      id: String(index),
      amount: index,
      donor: `donor-${index}`,
      recipient: `recipient-${index}`,
      timestamp: createIsoTimestamp(index),
      status: 'pending',
    });
  }
}

function seedWallets(count) {
  for (let index = 1; index <= count; index += 1) {
    Wallet.create({
      id: String(index),
      address: `wallet-${index}`,
      label: `Wallet ${index}`,
      ownerName: `Owner ${index}`,
      createdAt: createIsoTimestamp(index),
    });
  }
}

async function seedAuditLogs(count) {
  for (let index = 1; index <= count; index += 1) {
    await Database.run(
      `INSERT INTO audit_logs (
        timestamp, category, action, severity, result,
        userId, requestId, ipAddress, resource, reason,
        details, integrityHash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createIsoTimestamp(index),
        'AUTHENTICATION',
        `ACTION_${index}`,
        index % 2 === 0 ? 'HIGH' : 'LOW',
        'SUCCESS',
        `user-${index % 3}`,
        `req-${index}`,
        '127.0.0.1',
        '/admin/audit-logs',
        null,
        JSON.stringify({ index }),
        `hash-${index}`,
      ]
    );
  }
}

describe('Cursor pagination for list endpoints', () => {
  beforeAll(async () => {
    resetJsonFile(tempDonationsPath);
    resetJsonFile(walletsPath);
    await Database.run('DROP TABLE IF EXISTS audit_logs');
    await Database.run(`
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        severity TEXT NOT NULL,
        result TEXT NOT NULL,
        userId TEXT,
        requestId TEXT,
        ipAddress TEXT,
        resource TEXT,
        reason TEXT,
        details TEXT,
        integrityHash TEXT NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    resetJsonFile(tempDonationsPath);
    resetJsonFile(walletsPath);
    await Database.run('DELETE FROM audit_logs');
  });

  afterAll(async () => {
    if (fs.existsSync(tempDonationsPath)) {
      fs.unlinkSync(tempDonationsPath);
    }

    if (originalWalletsExists) {
      fs.writeFileSync(walletsPath, originalWalletsContents);
    } else if (fs.existsSync(walletsPath)) {
      fs.unlinkSync(walletsPath);
    }
  });

  test('GET /donations applies the default limit and returns first-page metadata', async () => {
    seedDonations(25);

    const response = await request(app)
      .get('/donations')
      .set('x-api-key', 'test-key');

    expect(response.status).toBe(200);
    expect(response.headers['x-total-count']).toBe('25');
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(20);
    expect(response.body.count).toBe(20);
    expect(response.body.meta).toMatchObject({
      limit: 20,
      direction: 'next',
      prev_cursor: null,
    });
    expect(response.body.meta.next_cursor).toBeTruthy();
    expect(response.body.data[0].id).toBe('25');
    expect(response.body.data[19].id).toBe('6');
  });

  test('GET /donations paginates forward and backward without duplicates or skipped records', async () => {
    seedDonations(9);

    const firstPage = await request(app)
      .get('/donations?limit=3')
      .set('x-api-key', 'test-key');

    const secondPage = await request(app)
      .get(`/donations?limit=3&cursor=${encodeURIComponent(firstPage.body.meta.next_cursor)}&direction=next`)
      .set('x-api-key', 'test-key');

    const previousPage = await request(app)
      .get(`/donations?limit=3&cursor=${encodeURIComponent(secondPage.body.meta.prev_cursor)}&direction=prev`)
      .set('x-api-key', 'test-key');

    const lastPage = await request(app)
      .get(`/donations?limit=3&cursor=${encodeURIComponent(secondPage.body.meta.next_cursor)}&direction=next`)
      .set('x-api-key', 'test-key');

    expect(firstPage.body.data.map((item) => item.id)).toEqual(['9', '8', '7']);
    expect(secondPage.body.data.map((item) => item.id)).toEqual(['6', '5', '4']);
    expect(previousPage.body.data.map((item) => item.id)).toEqual(['9', '8', '7']);
    expect(lastPage.body.data.map((item) => item.id)).toEqual(['3', '2', '1']);
    expect(secondPage.body.meta.prev_cursor).toBeTruthy();
    expect(secondPage.body.meta.next_cursor).toBeTruthy();
    expect(lastPage.body.meta.next_cursor).toBeNull();
    expect(lastPage.body.meta.prev_cursor).toBeTruthy();
  });

  test('GET /donations validates limit, direction, and cursor inputs strictly', async () => {
    seedDonations(5);

    const [limitTooHigh, zeroLimit, nonNumericLimit, invalidDirection, malformedCursor, unknownCursor] = await Promise.all([
      request(app).get('/donations?limit=101').set('x-api-key', 'test-key'),
      request(app).get('/donations?limit=0').set('x-api-key', 'test-key'),
      request(app).get('/donations?limit=abc').set('x-api-key', 'test-key'),
      request(app).get('/donations?direction=forward').set('x-api-key', 'test-key'),
      request(app).get('/donations?cursor=not-a-valid-cursor').set('x-api-key', 'test-key'),
      request(app)
        .get(`/donations?cursor=${encodeURIComponent(encodeCursor({ timestamp: createIsoTimestamp(999), id: '999' }))}`)
        .set('x-api-key', 'test-key'),
    ]);

    expect(limitTooHigh.status).toBe(400);
    expect(zeroLimit.status).toBe(400);
    expect(nonNumericLimit.status).toBe(400);
    expect(invalidDirection.status).toBe(400);
    expect(malformedCursor.status).toBe(400);
    expect(unknownCursor.status).toBe(400);
  });

  test('GET /donations accepts custom limits including 100 and handles empty datasets', async () => {
    seedDonations(105);

    const limitHundred = await request(app)
      .get('/donations?limit=100')
      .set('x-api-key', 'test-key');

    resetJsonFile(tempDonationsPath);

    const emptyResponse = await request(app)
      .get('/donations')
      .set('x-api-key', 'test-key');

    expect(limitHundred.status).toBe(200);
    expect(limitHundred.body.data).toHaveLength(100);
    expect(limitHundred.body.meta.limit).toBe(100);
    expect(limitHundred.headers['x-total-count']).toBe('105');

    expect(emptyResponse.status).toBe(200);
    expect(emptyResponse.headers['x-total-count']).toBe('0');
    expect(emptyResponse.body.data).toEqual([]);
    expect(emptyResponse.body.meta.next_cursor).toBeNull();
    expect(emptyResponse.body.meta.prev_cursor).toBeNull();
  });

  test('GET /wallets returns cursor metadata and page boundaries correctly', async () => {
    seedWallets(5);

    const firstPage = await request(app)
      .get('/wallets?limit=2')
      .set('x-api-key', 'test-key');

    const middlePage = await request(app)
      .get(`/wallets?limit=2&cursor=${encodeURIComponent(firstPage.body.meta.next_cursor)}`)
      .set('x-api-key', 'test-key');

    const lastPage = await request(app)
      .get(`/wallets?limit=2&cursor=${encodeURIComponent(middlePage.body.meta.next_cursor)}`)
      .set('x-api-key', 'test-key');

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers['x-total-count']).toBe('5');
    expect(firstPage.body.data.map((wallet) => wallet.id)).toEqual(['5', '4']);
    expect(firstPage.body.meta.prev_cursor).toBeNull();
    expect(firstPage.body.meta.next_cursor).toBeTruthy();

    expect(middlePage.body.data.map((wallet) => wallet.id)).toEqual(['3', '2']);
    expect(middlePage.body.meta.prev_cursor).toBeTruthy();
    expect(middlePage.body.meta.next_cursor).toBeTruthy();

    expect(lastPage.body.data.map((wallet) => wallet.id)).toEqual(['1']);
    expect(lastPage.body.meta.next_cursor).toBeNull();
    expect(lastPage.body.meta.prev_cursor).toBeTruthy();
  });

  test('GET /wallets rejects malformed pagination parameters and supports empty datasets', async () => {
    const invalidDirection = await request(app)
      .get('/wallets?direction=backward')
      .set('x-api-key', 'test-key');

    const invalidLimit = await request(app)
      .get('/wallets?limit=101')
      .set('x-api-key', 'test-key');

    const emptyResponse = await request(app)
      .get('/wallets')
      .set('x-api-key', 'test-key');

    expect(invalidDirection.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(emptyResponse.status).toBe(200);
    expect(emptyResponse.headers['x-total-count']).toBe('0');
    expect(emptyResponse.body.data).toEqual([]);
  });

  test('GET /admin/audit-logs remains protected for non-admin users', async () => {
    const response = await request(app)
      .get('/admin/audit-logs')
      .set('x-api-key', 'test-key');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  test('GET /admin/audit-logs paginates with headers, metadata, and filters', async () => {
    await seedAuditLogs(6);

    const firstPage = await request(app)
      .get('/admin/audit-logs?limit=2&severity=HIGH&category=AUTHENTICATION')
      .set('x-api-key', 'admin-test-key');

    const secondPage = await request(app)
      .get(`/admin/audit-logs?limit=2&severity=HIGH&category=AUTHENTICATION&cursor=${encodeURIComponent(firstPage.body.meta.next_cursor)}`)
      .set('x-api-key', 'admin-test-key');

    const previousPage = await request(app)
      .get(`/admin/audit-logs?limit=2&severity=HIGH&category=AUTHENTICATION&direction=prev&cursor=${encodeURIComponent(secondPage.body.meta.prev_cursor)}`)
      .set('x-api-key', 'admin-test-key');

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers['x-total-count']).toBe('3');
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data.every((item) => item.severity === 'HIGH')).toBe(true);
    expect(firstPage.body.data[0].details).toEqual({ index: 6 });
    expect(firstPage.body.meta.prev_cursor).toBeNull();
    expect(firstPage.body.meta.next_cursor).toBeTruthy();

    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.meta.next_cursor).toBeNull();
    expect(secondPage.body.meta.prev_cursor).toBeTruthy();

    expect(previousPage.body.data.map((item) => item.id)).toEqual(firstPage.body.data.map((item) => item.id));
  });

  test('GET /admin/audit-logs rejects invalid cursors and invalid limits', async () => {
    await seedAuditLogs(3);

    const invalidCursor = await request(app)
      .get('/admin/audit-logs?cursor=broken')
      .set('x-api-key', 'admin-test-key');

    const invalidLimit = await request(app)
      .get('/admin/audit-logs?limit=0')
      .set('x-api-key', 'admin-test-key');

    expect(invalidCursor.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
  });
});
