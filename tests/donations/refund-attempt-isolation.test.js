'use strict';

/**
 * Refund attempt isolation (#1947).
 *
 * Each refund attempt must write its own ledger rows, never share a
 * placeholder reverse id with another attempt, update only its own rows on
 * failure, and clear the signing secret on every path. Database and Stellar
 * are mocked so the SQL and call order can be asserted directly.
 */

jest.mock('../../src/utils/database', () => ({ run: jest.fn(), get: jest.fn(), all: jest.fn() }));
jest.mock('../../src/models/transaction', () => ({ getById: jest.fn(), updateStatus: jest.fn() }));
jest.mock('../../src/utils/log', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/utils/donationValidator', () => ({}));
jest.mock('../../src/utils/stellarAsset', () => ({ parseAssetInput: jest.fn(), isSameAsset: jest.fn(), serializeAsset: jest.fn() }));
jest.mock('../../src/services/stellar/sdk.js', () => ({
  Keypair: { fromSecret: () => ({ publicKey: () => 'GRECIPIENTTESTACCOUNT' }) },
}));
jest.mock('../../src/services/LimitService', () => ({}));
jest.mock('../../src/services/DonationVelocityService', () => ({}));
jest.mock('../../src/services/MatchingProgramService', () => ({}));
jest.mock('../../src/services/CorporateMatchingService', () => ({}));
jest.mock('../../src/services/PriceOracleService', () => ({}));
jest.mock('../../src/services/WebhookService', () => ({ deliver: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  ACTION: new Proxy({}, { get: (_t, key) => String(key) }),
  CATEGORY: new Proxy({}, { get: (_t, key) => String(key) }),
  SEVERITY: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const Database = require('../../src/utils/database');
const Transaction = require('../../src/models/transaction');
const log = require('../../src/utils/log');
const DonationService = require('../../src/services/DonationService');
const { DuplicateError } = require('../../src/utils/errors');

const DONATION_ID = 'don-1947';
const SECRET = 'SBRECIPIENTSECRETFORTESTINGONLY0000000000000000000000000';

function confirmedDonation(overrides = {}) {
  return {
    id: DONATION_ID,
    amount: 10,
    donor: 'GDONORTESTACCOUNT',
    recipient: 'GRECIPIENTTESTACCOUNT',
    status: 'confirmed',
    timestamp: new Date().toISOString(),
    senderId: null,
    ...overrides,
  };
}

/** Scripted Database.run: assigns sequential ids to inserts, records every call. */
function installDatabase({ processingError = null } = {}) {
  let nextId = 100;
  Database.run.mockImplementation(async (sql, params) => {
    if (/^\s*INSERT INTO refunds/.test(sql)) return { id: nextId++, changes: 1 };
    if (/^\s*INSERT INTO refund_transactions/.test(sql)) return { id: nextId++, changes: 1 };
    if (/status = 'processing'/.test(sql) && processingError) throw processingError;
    return { id: null, changes: 1 };
  });
}

function makeStellar({ result, error } = {}) {
  return {
    sendDonation: jest.fn(async () => {
      if (error) throw error;
      return result || { transactionId: 'tx-real-1', ledger: 42, fee: 100 };
    }),
  };
}

function refund(service, overrides = {}) {
  return service.refundDonation(DONATION_ID, {
    reason: 'test',
    notes: null,
    idempotencyKey: null,
    recipientSecret: SECRET,
    requestId: 'req-1947',
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REFUND_WINDOW_HOURS = '24';
  Transaction.getById.mockReturnValue(confirmedDonation());
});

describe('refund attempt placeholders (#1947)', () => {
  test('two refunds created in the same millisecond get distinct placeholder ids', async () => {
    installDatabase();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const stellar = makeStellar();
      const service = new DonationService(stellar);
      await refund(service);
      await refund(service);

      const placeholders = Database.run.mock.calls
        .filter(([sql]) => /^\s*INSERT INTO refund/.test(sql))
        .map(([, params]) => params[1]);

      // Each attempt writes one refunds row and one ledger row sharing its attempt ref.
      expect(placeholders).toHaveLength(4);
      placeholders.forEach((p) => expect(p).toMatch(/^pending_[0-9a-f-]{36}$/));
      expect(placeholders[0]).toBe(placeholders[1]);
      expect(placeholders[2]).toBe(placeholders[3]);
      expect(placeholders[0]).not.toBe(placeholders[2]);
      expect(new Set(placeholders).size).toBe(2);
      expect(placeholders.some((p) => p === `pending_${1_700_000_000_000}`)).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('ledger rows are inserted for this attempt and completed by primary key', async () => {
    installDatabase();
    const service = new DonationService(makeStellar());
    const result = await refund(service);

    const completionSql = Database.run.mock.calls.map(([sql]) => sql).filter((sql) => /status = 'completed'/.test(sql));
    expect(completionSql).toHaveLength(2);
    completionSql.forEach((sql) => {
      expect(sql).toMatch(/WHERE id = \?/);
      expect(sql).not.toMatch(/original_donation_id = \?/);
    });
    expect(result.status).toBe('completed');
    expect(result.reverseTxId).toBe('tx-real-1');
  });
});

describe('failure path only touches its own attempt (#1947)', () => {
  test('a Stellar failure marks this attempt failed by id and rethrows the Stellar error', async () => {
    installDatabase();
    const stellarError = new Error('horizon rejected transaction');
    const service = new DonationService(makeStellar({ error: stellarError }));

    await expect(refund(service)).rejects.toBe(stellarError);

    const failureCalls = Database.run.mock.calls.filter(([sql]) => /status = 'failed'/.test(sql));
    expect(failureCalls.length).toBeGreaterThanOrEqual(2);
    failureCalls.forEach(([sql]) => {
      expect(sql).toMatch(/WHERE id = \?/);
      expect(sql).not.toMatch(/original_donation_id = \?/);
      expect(sql).not.toMatch(/status = 'pending'/);
    });
    expect(Transaction.updateStatus).not.toHaveBeenCalled();
  });

  test('a ledger insert failure surfaces the error and never submits to Stellar', async () => {
    const ledgerError = new Error('disk I/O error');
    let inserts = 0;
    Database.run.mockImplementation(async (sql) => {
      if (/^\s*INSERT INTO refunds/.test(sql)) return { id: 7, changes: 1 };
      if (/^\s*INSERT INTO refund_transactions/.test(sql)) {
        inserts += 1;
        throw ledgerError;
      }
      return { id: null, changes: 1 };
    });
    const stellar = makeStellar();
    const service = new DonationService(stellar);

    await expect(refund(service)).rejects.toBe(ledgerError);
    expect(stellar.sendDonation).not.toHaveBeenCalled();
    expect(inserts).toBe(1);
  });

  test('a concurrent processing refund maps to DuplicateError and submits nothing', async () => {
    installDatabase({ processingError: new Error('UNIQUE constraint failed: refunds.original_donation_id') });
    const stellar = makeStellar();
    const service = new DonationService(stellar);

    await expect(refund(service)).rejects.toBeInstanceOf(DuplicateError);
    expect(stellar.sendDonation).not.toHaveBeenCalled();
  });
});

describe('ledger completion is non-fatal after on-chain success (#1947)', () => {
  test('a completion write failure is logged for reconciliation and the refund still succeeds', async () => {
    let completions = 0;
    Database.run.mockImplementation(async (sql) => {
      if (/^\s*INSERT INTO/.test(sql)) return { id: 5, changes: 1 };
      if (/status = 'completed'/.test(sql)) {
        completions += 1;
        throw new Error('database is locked');
      }
      return { id: null, changes: 1 };
    });
    const service = new DonationService(makeStellar());

    const result = await refund(service);

    expect(result.status).toBe('completed');
    expect(completions).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      'DONATION_SERVICE',
      expect.stringContaining('manual reconciliation required'),
      expect.objectContaining({ reverseTxId: 'tx-real-1', ledger: 42 })
    );
    expect(Transaction.updateStatus).toHaveBeenCalledWith(DONATION_ID, 'refunded', expect.any(Object));
  });
});
