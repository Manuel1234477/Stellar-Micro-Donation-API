/**
 * Transaction Search and Filtering Tests
 *
 * Tests for GET /donations filter/search query parameters.
 * No live Stellar network required (uses MockStellarService via MOCK_STELLAR=true).
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const donationRouter = require('../src/routes/donation');
const Transaction = require('../src/routes/models/transaction');
const { attachUserRole } = require('../src/middleware/rbac');
const DonationService = require('../src/services/DonationService');
const { ValidationError } = require('../src/utils/errors');

// ─── Test App ────────────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' },
    });
  });
  return app;
}

// ─── Seed Helpers ─────────────────────────────────────────────────────────────

function seed(overrides = {}) {
  return Transaction.create({
    amount: 10,
    donor: 'alice',
    recipient: 'bob',
    memo: 'birthday gift',
    status: 'pending',
    timestamp: new Date().toISOString(),
    ...overrides,
  });
}

// ─── DonationService.applyFilters unit tests ──────────────────────────────────

describe('DonationService.applyFilters', () => {
  const svc = new DonationService({});

  const base = [
    { id: '1', amount: 5,  donor: 'alice',   recipient: 'bob',     memo: 'hello world', status: 'pending',   timestamp: '2024-01-01T00:00:00.000Z' },
    { id: '2', amount: 20, donor: 'bob',     recipient: 'charlie', memo: 'donation',    status: 'confirmed', timestamp: '2024-02-01T00:00:00.000Z' },
    { id: '3', amount: 50, donor: 'charlie', recipient: 'alice',   memo: 'thanks',      status: 'failed',    timestamp: '2024-03-01T00:00:00.000Z' },
    { id: '4', amount: 10, donor: 'alice',   recipient: 'charlie', memo: 'hello again', status: 'confirmed', timestamp: '2024-04-01T00:00:00.000Z' },
  ];

  test('returns all when no filters', () => {
    expect(svc.applyFilters(base, {}).length).toBe(4);
  });

  test('filters by startDate', () => {
    const result = svc.applyFilters(base, { startDate: '2024-02-01' });
    expect(result.every(t => new Date(t.timestamp) >= new Date('2024-02-01'))).toBe(true);
    expect(result.length).toBe(3);
  });

  test('filters by endDate', () => {
    const result = svc.applyFilters(base, { endDate: '2024-02-28' });
    expect(result.length).toBe(2);
  });

  test('filters by startDate and endDate range', () => {
    const result = svc.applyFilters(base, { startDate: '2024-02-01', endDate: '2024-03-31' });
    expect(result.length).toBe(2);
    expect(result.map(t => t.id)).toEqual(expect.arrayContaining(['2', '3']));
  });

  test('filters by minAmount', () => {
    const result = svc.applyFilters(base, { minAmount: 20 });
    expect(result.every(t => t.amount >= 20)).toBe(true);
    expect(result.length).toBe(2);
  });

  test('filters by maxAmount', () => {
    const result = svc.applyFilters(base, { maxAmount: 10 });
    expect(result.every(t => t.amount <= 10)).toBe(true);
    expect(result.length).toBe(2);
  });

  test('filters by minAmount and maxAmount range', () => {
    const result = svc.applyFilters(base, { minAmount: 10, maxAmount: 20 });
    expect(result.length).toBe(2);
  });

  test('filters by exact status', () => {
    const result = svc.applyFilters(base, { status: 'confirmed' });
    expect(result.every(t => t.status === 'confirmed')).toBe(true);
    expect(result.length).toBe(2);
  });

  test('filters by donor substring (case-insensitive)', () => {
    const result = svc.applyFilters(base, { donor: 'ALICE' });
    expect(result.every(t => t.donor.toLowerCase().includes('alice'))).toBe(true);
    expect(result.length).toBe(2);
  });

  test('filters by recipient substring (case-insensitive)', () => {
    const result = svc.applyFilters(base, { recipient: 'Charlie' });
    expect(result.length).toBe(2);
  });

  test('filters by memo full-text search (case-insensitive)', () => {
    const result = svc.applyFilters(base, { memo: 'hello' });
    expect(result.length).toBe(2);
    expect(result.map(t => t.id)).toEqual(expect.arrayContaining(['1', '4']));
  });

  test('combines multiple filters', () => {
    const result = svc.applyFilters(base, { donor: 'alice', status: 'confirmed' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('4');
  });

  test('returns empty array when no matches', () => {
    expect(svc.applyFilters(base, { donor: 'nobody' })).toEqual([]);
  });

  // Sorting
  test('sorts by amount asc', () => {
    const result = svc.applyFilters(base, { sortBy: 'amount', order: 'asc' });
    expect(result.map(t => t.amount)).toEqual([5, 10, 20, 50]);
  });

  test('sorts by amount desc', () => {
    const result = svc.applyFilters(base, { sortBy: 'amount', order: 'desc' });
    expect(result.map(t => t.amount)).toEqual([50, 20, 10, 5]);
  });

  test('sorts by timestamp asc', () => {
    const result = svc.applyFilters(base, { sortBy: 'timestamp', order: 'asc' });
    expect(result[0].id).toBe('1');
    expect(result[3].id).toBe('4');
  });

  test('sorts by status asc', () => {
    const result = svc.applyFilters(base, { sortBy: 'status', order: 'asc' });
    expect(result[0].status <= result[result.length - 1].status).toBe(true);
  });

  // Validation errors
  test('throws on invalid startDate', () => {
    expect(() => svc.applyFilters(base, { startDate: 'not-a-date' })).toThrow(ValidationError);
  });

  test('throws on invalid endDate', () => {
    expect(() => svc.applyFilters(base, { endDate: 'bad' })).toThrow(ValidationError);
  });

  test('throws when startDate is after endDate', () => {
    expect(() => svc.applyFilters(base, { startDate: '2024-12-01', endDate: '2024-01-01' })).toThrow(ValidationError);
  });

  test('throws on invalid minAmount', () => {
    expect(() => svc.applyFilters(base, { minAmount: 'abc' })).toThrow(ValidationError);
  });

  test('throws on invalid maxAmount', () => {
    expect(() => svc.applyFilters(base, { maxAmount: 'abc' })).toThrow(ValidationError);
  });

  test('throws when minAmount > maxAmount', () => {
    expect(() => svc.applyFilters(base, { minAmount: 100, maxAmount: 10 })).toThrow(ValidationError);
  });

  test('throws on invalid sortBy', () => {
    expect(() => svc.applyFilters(base, { sortBy: 'invalid' })).toThrow(ValidationError);
  });

  test('throws on invalid order', () => {
    expect(() => svc.applyFilters(base, { order: 'sideways' })).toThrow(ValidationError);
  });
});

// ─── GET /donations HTTP integration tests ────────────────────────────────────

describe('GET /donations – search and filtering', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    Transaction._clearAllData();
  });

  function get(query = '') {
    return request(app).get(`/donations${query}`);
  }

  test('returns all donations when no filters', async () => {
    seed({ amount: 5 });
    seed({ amount: 10 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
  });

  test('response includes filters and resultCount metadata', async () => {
    seed({ status: 'confirmed' });
    seed({ status: 'pending' });
    const res = await get('?status=confirmed');
    expect(res.status).toBe(200);
    expect(res.body.filters).toEqual({ status: 'confirmed' });
    expect(res.body.resultCount).toBe(1);
  });

  test('filters by status=confirmed', async () => {
    seed({ status: 'confirmed' });
    seed({ status: 'pending' });
    const res = await get('?status=confirmed');
    expect(res.body.data.every(d => d.status === 'confirmed')).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  test('filters by minAmount', async () => {
    seed({ amount: 5 });
    seed({ amount: 50 });
    const res = await get('?minAmount=10');
    expect(res.body.data.every(d => d.amount >= 10)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  test('filters by maxAmount', async () => {
    seed({ amount: 5 });
    seed({ amount: 50 });
    const res = await get('?maxAmount=10');
    expect(res.body.data.every(d => d.amount <= 10)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  test('filters by donor substring', async () => {
    seed({ donor: 'alice' });
    seed({ donor: 'bob' });
    const res = await get('?donor=alice');
    expect(res.body.data.every(d => d.donor.includes('alice'))).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  test('filters by recipient substring', async () => {
    seed({ recipient: 'charlie' });
    seed({ recipient: 'dave' });
    const res = await get('?recipient=charlie');
    expect(res.body.data.length).toBe(1);
  });

  test('filters by memo full-text search', async () => {
    seed({ memo: 'birthday gift' });
    seed({ memo: 'monthly donation' });
    const res = await get('?memo=birthday');
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].memo).toBe('birthday gift');
  });

  test('memo search is case-insensitive', async () => {
    seed({ memo: 'Birthday Gift' });
    const res = await get('?memo=birthday');
    expect(res.body.data.length).toBe(1);
  });

  test('filters by date range', async () => {
    seed({ timestamp: '2024-01-15T00:00:00.000Z' });
    seed({ timestamp: '2024-06-15T00:00:00.000Z' });
    const res = await get('?startDate=2024-01-01&endDate=2024-03-31');
    expect(res.body.data.length).toBe(1);
  });

  test('combines multiple filters', async () => {
    seed({ donor: 'alice', status: 'confirmed', amount: 20 });
    seed({ donor: 'alice', status: 'pending',   amount: 5  });
    seed({ donor: 'bob',   status: 'confirmed', amount: 20 });
    const res = await get('?donor=alice&status=confirmed');
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].donor).toBe('alice');
    expect(res.body.data[0].status).toBe('confirmed');
  });

  test('returns empty data array when no matches', async () => {
    seed({ donor: 'alice' });
    const res = await get('?donor=nobody');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.resultCount).toBe(0);
  });

  test('sorts by amount asc', async () => {
    seed({ amount: 30 });
    seed({ amount: 10 });
    seed({ amount: 20 });
    const res = await get('?sortBy=amount&order=asc');
    const amounts = res.body.data.map(d => d.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  test('sorts by amount desc', async () => {
    seed({ amount: 30 });
    seed({ amount: 10 });
    seed({ amount: 20 });
    const res = await get('?sortBy=amount&order=desc');
    const amounts = res.body.data.map(d => d.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  test('X-Total-Count header reflects filtered count', async () => {
    seed({ status: 'confirmed' });
    seed({ status: 'confirmed' });
    seed({ status: 'pending' });
    const res = await get('?status=confirmed');
    expect(res.headers['x-total-count']).toBe('2');
  });

  // Validation error responses
  test('returns 400 for invalid status value', async () => {
    const res = await get('?status=invalid');
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid sortBy value', async () => {
    const res = await get('?sortBy=invalid');
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid order value', async () => {
    const res = await get('?order=sideways');
    expect(res.status).toBe(400);
  });

  test('returns 400 when startDate is after endDate', async () => {
    const res = await get('?startDate=2024-12-01&endDate=2024-01-01');
    expect(res.status).toBe(400);
  });

  test('returns 400 when minAmount > maxAmount', async () => {
    const res = await get('?minAmount=100&maxAmount=10');
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid minAmount', async () => {
    const res = await get('?minAmount=abc');
    expect(res.status).toBe(400);
  });

  // Edge cases
  test('handles empty database gracefully', async () => {
    const res = await get('?status=confirmed');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('filters object is empty when no filters applied', async () => {
    seed();
    const res = await get();
    expect(res.body.filters).toEqual({});
  });

  test('pagination still works with filters applied', async () => {
    for (let i = 0; i < 5; i++) seed({ status: 'confirmed', amount: i + 1 });
    seed({ status: 'pending' });
    const res = await get('?status=confirmed&limit=3');
    expect(res.body.data.length).toBe(3);
    expect(res.body.resultCount).toBe(5);
    expect(res.body.meta.next_cursor).not.toBeNull();
  });
});
