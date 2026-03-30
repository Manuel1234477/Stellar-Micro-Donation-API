/**
 * Tests for Overpayment Detection
 *
 * Covers:
 *  - detectOverpayment utility (unit)
 *  - buildOverpaymentRecord utility (unit)
 *  - DonationService.createDonationRecord overpayment integration
 *  - GET /stats/overpayments endpoint
 *  - Edge cases and validation errors
 */

const {
  detectOverpayment,
  buildOverpaymentRecord,
  round7,
} = require('../../src/utils/overpaymentDetector');

// ─── Unit: round7 ────────────────────────────────────────────────────────────

describe('round7', () => {
  it('rounds to 7 decimal places', () => {
    expect(round7(1.123456789)).toBe(1.1234568);
  });

  it('leaves values with fewer decimals unchanged', () => {
    expect(round7(10.5)).toBe(10.5);
    expect(round7(100)).toBe(100);
  });
});

// ─── Unit: detectOverpayment ─────────────────────────────────────────────────

describe('detectOverpayment', () => {
  it('returns isOverpayment=false when received equals expected total', () => {
    // donation=100, fee=2 → expectedTotal=102, received=102
    const result = detectOverpayment(102, 100, 2);
    expect(result.isOverpayment).toBe(false);
    expect(result.excessAmount).toBe(0);
    expect(result.expectedTotal).toBe(102);
  });

  it('returns isOverpayment=false when received is less than expected total', () => {
    const result = detectOverpayment(100, 100, 2);
    expect(result.isOverpayment).toBe(false);
    expect(result.excessAmount).toBe(0);
  });

  it('detects overpayment when received exceeds expected total', () => {
    // donation=100, fee=2 → expectedTotal=102, received=110 → excess=8
    const result = detectOverpayment(110, 100, 2);
    expect(result.isOverpayment).toBe(true);
    expect(result.expectedTotal).toBe(102);
    expect(result.excessAmount).toBe(8);
    expect(result.receivedAmount).toBe(110);
  });

  it('calculates overpaymentPercentage correctly', () => {
    // excess=8, expectedTotal=102 → ~7.843%
    const result = detectOverpayment(110, 100, 2);
    expect(result.overpaymentPercentage).toBeCloseTo(7.843, 2);
  });

  it('returns overpaymentPercentage=0 when no overpayment', () => {
    const result = detectOverpayment(102, 100, 2);
    expect(result.overpaymentPercentage).toBe(0);
  });

  it('handles small decimal amounts', () => {
    const result = detectOverpayment(1.05, 1, 0.02);
    expect(result.isOverpayment).toBe(true);
    expect(result.excessAmount).toBeCloseTo(0.03, 7);
  });

  it('handles minimum fee (MIN_FEE applied)', () => {
    // Very small donation: fee would be < 0.01, so MIN_FEE=0.01 applies
    // donation=0.1, fee=0.01 → expectedTotal=0.11, received=0.15 → excess=0.04
    const result = detectOverpayment(0.15, 0.1, 0.01);
    expect(result.isOverpayment).toBe(true);
    expect(result.excessAmount).toBeCloseTo(0.04, 7);
  });

  it('throws on non-numeric receivedAmount', () => {
    expect(() => detectOverpayment('110', 100, 2)).toThrow('receivedAmount must be a finite number');
  });

  it('throws on non-numeric donationAmount', () => {
    expect(() => detectOverpayment(110, '100', 2)).toThrow('donationAmount must be a finite number');
  });

  it('throws on non-numeric expectedFee', () => {
    expect(() => detectOverpayment(110, 100, '2')).toThrow('expectedFee must be a finite number');
  });

  it('throws on Infinity receivedAmount', () => {
    expect(() => detectOverpayment(Infinity, 100, 2)).toThrow('receivedAmount must be a finite number');
  });

  it('handles zero excess (exact payment)', () => {
    const result = detectOverpayment(50.01, 50, 0.01);
    expect(result.isOverpayment).toBe(false);
    expect(result.excessAmount).toBe(0);
  });
});

// ─── Unit: buildOverpaymentRecord ────────────────────────────────────────────

describe('buildOverpaymentRecord', () => {
  it('returns null when no overpayment', () => {
    expect(buildOverpaymentRecord(102, 100, 2)).toBeNull();
    expect(buildOverpaymentRecord(50, 100, 2)).toBeNull();
  });

  it('returns a record object when overpayment detected', () => {
    const record = buildOverpaymentRecord(110, 100, 2);
    expect(record).not.toBeNull();
    expect(record.flagged).toBe(true);
    expect(record.excessAmount).toBe(8);
    expect(record.expectedTotal).toBe(102);
    expect(record.receivedAmount).toBe(110);
    expect(record.overpaymentPercentage).toBeCloseTo(7.843, 2);
  });

  it('includes a detectedAt ISO timestamp', () => {
    const record = buildOverpaymentRecord(110, 100, 2);
    expect(record.detectedAt).toBeDefined();
    expect(() => new Date(record.detectedAt)).not.toThrow();
    expect(new Date(record.detectedAt).toISOString()).toBe(record.detectedAt);
  });
});

// ─── Integration: DonationService ────────────────────────────────────────────

describe('DonationService — overpayment detection', () => {
  let DonationService;
  let MockStellarService;

  beforeEach(() => {
    jest.resetModules();

    // Isolate JSON storage per test
    process.env.DB_JSON_PATH = require('path').join(
      require('os').tmpdir(),
      `overpayment-test-${Date.now()}.json`
    );

    DonationService = require('../../src/services/DonationService');
    MockStellarService = { sendDonation: jest.fn(), verifyTransaction: jest.fn() };
  });

  afterEach(() => {
    const fs = require('fs');
    try { fs.unlinkSync(process.env.DB_JSON_PATH); } catch (_) {}
  });

  it('stores overpaymentFlagged=false when no receivedAmount provided', async () => {
    const service = new DonationService(MockStellarService);
    const tx = await service.createDonationRecord({
      amount: 10,
      donor: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      recipient: 'GRECIPIENTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
    expect(tx.overpaymentFlagged).toBe(false);
    expect(tx.overpaymentDetails).toBeNull();
  });

  it('stores overpaymentFlagged=false when receivedAmount equals expected total', async () => {
    const service = new DonationService(MockStellarService);
    // donation=10, fee=0.2 → expectedTotal=10.2
    const tx = await service.createDonationRecord({
      amount: 10,
      donor: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      recipient: 'GRECIPIENTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      receivedAmount: 10.2,
    });
    expect(tx.overpaymentFlagged).toBe(false);
    expect(tx.overpaymentDetails).toBeNull();
  });

  it('flags overpayment and stores excess when receivedAmount exceeds expected total', async () => {
    const service = new DonationService(MockStellarService);
    // donation=10, fee=0.2 → expectedTotal=10.2, received=12 → excess=1.8
    const tx = await service.createDonationRecord({
      amount: 10,
      donor: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      recipient: 'GRECIPIENTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      receivedAmount: 12,
    });
    expect(tx.overpaymentFlagged).toBe(true);
    expect(tx.overpaymentDetails).not.toBeNull();
    expect(tx.overpaymentDetails.flagged).toBe(true);
    expect(tx.overpaymentDetails.excessAmount).toBeCloseTo(1.8, 5);
    expect(tx.overpaymentDetails.expectedTotal).toBeCloseTo(10.2, 5);
    expect(tx.overpaymentDetails.receivedAmount).toBe(12);
    expect(tx.overpaymentDetails.detectedAt).toBeDefined();
  });

  it('stores the donation amount unchanged regardless of overpayment', async () => {
    const service = new DonationService(MockStellarService);
    const tx = await service.createDonationRecord({
      amount: 10,
      donor: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      recipient: 'GRECIPIENTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      receivedAmount: 15,
    });
    // The stored donation amount must not be inflated
    expect(tx.amount).toBe(10);
  });

  it('still stores analyticsFee alongside overpayment data', async () => {
    const service = new DonationService(MockStellarService);
    const tx = await service.createDonationRecord({
      amount: 10,
      donor: 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      recipient: 'GRECIPIENTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      receivedAmount: 15,
    });
    expect(tx.analyticsFee).toBeDefined();
    expect(tx.analyticsFeePercentage).toBeDefined();
  });
});

// ─── Integration: GET /stats/overpayments ────────────────────────────────────

describe('GET /stats/overpayments', () => {
  const request = require('supertest');
  const path = require('path');
  const os = require('os');
  const fs = require('fs');

  let app;
  let tmpDb;

  beforeEach(() => {
    jest.resetModules();
    tmpDb = path.join(os.tmpdir(), `overpayment-stats-${Date.now()}.json`);
    process.env.DB_JSON_PATH = tmpDb;
    process.env.NODE_ENV = 'test';

    app = require('../../src/routes/app');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  });

  it('returns 200 with empty overpayments when no transactions exist', async () => {
    const res = await request(app)
      .get('/stats/overpayments')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalOverpayments).toBe(0);
    expect(res.body.data.totalExcessAmount).toBe(0);
    expect(res.body.data.transactions).toEqual([]);
  });

  it('returns overpayment records after a flagged donation', async () => {
    // Seed a flagged transaction directly into the JSON store
    const flaggedTx = {
      id: 'test-op-1',
      amount: 10,
      donor: 'GDONOR',
      recipient: 'GRECIPIENT',
      timestamp: new Date().toISOString(),
      status: 'pending',
      analyticsFee: 0.2,
      analyticsFeePercentage: 0.02,
      overpaymentFlagged: true,
      overpaymentDetails: {
        flagged: true,
        expectedTotal: 10.2,
        receivedAmount: 12,
        excessAmount: 1.8,
        overpaymentPercentage: 17.647,
        detectedAt: new Date().toISOString(),
      },
    };
    fs.writeFileSync(tmpDb, JSON.stringify([flaggedTx], null, 2));

    const res = await request(app)
      .get('/stats/overpayments')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.data.totalOverpayments).toBe(1);
    expect(res.body.data.totalExcessAmount).toBeCloseTo(1.8, 5);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].excessAmount).toBeCloseTo(1.8, 5);
    expect(res.body.data.transactions[0].id).toBe('test-op-1');
  });

  it('filters by date range', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const recent = new Date();

    const txOld = {
      id: 'old-tx',
      amount: 5,
      donor: 'A',
      recipient: 'B',
      timestamp: old.toISOString(),
      status: 'pending',
      analyticsFee: 0.1,
      overpaymentFlagged: true,
      overpaymentDetails: { flagged: true, expectedTotal: 5.1, receivedAmount: 6, excessAmount: 0.9, overpaymentPercentage: 17.6, detectedAt: old.toISOString() },
    };
    const txRecent = {
      id: 'recent-tx',
      amount: 10,
      donor: 'C',
      recipient: 'D',
      timestamp: recent.toISOString(),
      status: 'pending',
      analyticsFee: 0.2,
      overpaymentFlagged: true,
      overpaymentDetails: { flagged: true, expectedTotal: 10.2, receivedAmount: 12, excessAmount: 1.8, overpaymentPercentage: 17.6, detectedAt: recent.toISOString() },
    };
    fs.writeFileSync(tmpDb, JSON.stringify([txOld, txRecent], null, 2));

    const startDate = '2025-01-01';
    const res = await request(app)
      .get(`/stats/overpayments?startDate=${startDate}`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.data.totalOverpayments).toBe(1);
    expect(res.body.data.transactions[0].id).toBe('recent-tx');
  });

  it('returns 400 for invalid startDate', async () => {
    const res = await request(app)
      .get('/stats/overpayments?startDate=not-a-date')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE');
  });

  it('returns 400 when startDate is after endDate', async () => {
    const res = await request(app)
      .get('/stats/overpayments?startDate=2026-01-01&endDate=2025-01-01')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('includes metadata note in response', async () => {
    const res = await request(app)
      .get('/stats/overpayments')
      .set('x-api-key', 'test-key');

    expect(res.body.metadata.note).toBeDefined();
  });

  it('calculates averageExcessAmount correctly', async () => {
    const txs = [
      { id: '1', amount: 10, donor: 'A', recipient: 'B', timestamp: new Date().toISOString(), status: 'pending', analyticsFee: 0.2, overpaymentFlagged: true, overpaymentDetails: { flagged: true, expectedTotal: 10.2, receivedAmount: 11, excessAmount: 0.8, overpaymentPercentage: 7.8, detectedAt: new Date().toISOString() } },
      { id: '2', amount: 20, donor: 'C', recipient: 'D', timestamp: new Date().toISOString(), status: 'pending', analyticsFee: 0.4, overpaymentFlagged: true, overpaymentDetails: { flagged: true, expectedTotal: 20.4, receivedAmount: 22, excessAmount: 1.6, overpaymentPercentage: 7.8, detectedAt: new Date().toISOString() } },
    ];
    fs.writeFileSync(tmpDb, JSON.stringify(txs, null, 2));

    const res = await request(app)
      .get('/stats/overpayments')
      .set('x-api-key', 'test-key');

    expect(res.body.data.totalOverpayments).toBe(2);
    expect(res.body.data.totalExcessAmount).toBeCloseTo(2.4, 5);
    expect(res.body.data.averageExcessAmount).toBeCloseTo(1.2, 5);
  });

  it('does not include non-flagged transactions', async () => {
    const txs = [
      { id: 'normal', amount: 10, donor: 'A', recipient: 'B', timestamp: new Date().toISOString(), status: 'pending', analyticsFee: 0.2, overpaymentFlagged: false, overpaymentDetails: null },
      { id: 'flagged', amount: 10, donor: 'C', recipient: 'D', timestamp: new Date().toISOString(), status: 'pending', analyticsFee: 0.2, overpaymentFlagged: true, overpaymentDetails: { flagged: true, expectedTotal: 10.2, receivedAmount: 12, excessAmount: 1.8, overpaymentPercentage: 17.6, detectedAt: new Date().toISOString() } },
    ];
    fs.writeFileSync(tmpDb, JSON.stringify(txs, null, 2));

    const res = await request(app)
      .get('/stats/overpayments')
      .set('x-api-key', 'test-key');

    expect(res.body.data.totalOverpayments).toBe(1);
    expect(res.body.data.transactions[0].id).toBe('flagged');
  });
});
