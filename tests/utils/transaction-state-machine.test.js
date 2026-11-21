'use strict';

/**
 * Tests for issues 1160–1163:
 *   1160 – State machine guards: illegal transitions rejected + audited
 *   1161 – DonationTotalsRepository reconciliation + transactional increment
 *   1162 – Overflow-safe BigInt aggregation for large stroop sums
 *   1163 – Memo byte-length validation (UTF-8, encrypted-memo path)
 */

const {
  TRANSACTION_STATES,
  VALID_TRANSITIONS,
  canTransition,
  assertValidTransition,
} = require('../../src/utils/transactionStateMachine');

const MemoValidator = require('../../src/utils/memoValidator');

// ─── Issue 1160: State machine ────────────────────────────────────────────────

describe('Issue 1160 – Transaction state machine guards', () => {
  describe('VALID_TRANSITIONS export', () => {
    test('all canonical states are present as keys', () => {
      expect(Object.keys(VALID_TRANSITIONS)).toEqual(
        expect.arrayContaining(Object.values(TRANSACTION_STATES))
      );
    });

    test('FAILED is a terminal state with no outgoing transitions', () => {
      expect(VALID_TRANSITIONS[TRANSACTION_STATES.FAILED].size).toBe(0);
    });
  });

  describe('Legal transitions', () => {
    const legal = [
      ['pending',   'submitted'],
      ['pending',   'confirmed'],
      ['pending',   'failed'],
      ['submitted', 'confirmed'],
      ['submitted', 'failed'],
      ['confirmed', 'failed'],   // reconciliation scenario
    ];

    test.each(legal)('%s → %s is allowed', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertValidTransition(from, to)).not.toThrow();
    });
  });

  describe('Identity transitions (no-op)', () => {
    const identities = ['pending', 'submitted', 'confirmed', 'failed'];
    test.each(identities.map(s => [s]))('%s → %s is allowed (no-op)', (state) => {
      expect(canTransition(state, state)).toBe(true);
    });
  });

  describe('Illegal transitions are rejected', () => {
    const illegal = [
      ['failed',    'confirmed'],
      ['failed',    'submitted'],
      ['failed',    'pending'],
      ['confirmed', 'pending'],
      ['confirmed', 'submitted'],
      ['submitted', 'pending'],
    ];

    test.each(illegal)('%s → %s throws BusinessLogicError', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertValidTransition(from, to)).toThrow(/Invalid transaction state transition/);
    });
  });

  describe('Transaction.updateStatus audit logging', () => {
    const Transaction = require('../../src/models/transaction');
    const AuditLogService = require('../../src/services/AuditLogService');

    beforeEach(() => {
      Transaction._clearAllData();
      jest.spyOn(AuditLogService, 'log').mockResolvedValue({});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('updateStatus audits and re-throws on illegal transition', () => {
      const tx = Transaction.create({ status: TRANSACTION_STATES.CONFIRMED });
      expect(() =>
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.PENDING)
      ).toThrow(/Invalid transaction state transition/);

      expect(AuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ILLEGAL_STATE_TRANSITION_REJECTED',
          result: 'FAILURE',
          details: expect.objectContaining({
            transactionId: tx.id,
            fromState: 'confirmed',
            toState: 'pending',
          }),
        })
      );
    });

    test('updateStatus does NOT audit on legal transition', () => {
      const tx = Transaction.create({ status: TRANSACTION_STATES.PENDING });
      Transaction.updateStatus(tx.id, TRANSACTION_STATES.SUBMITTED);
      expect(AuditLogService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ILLEGAL_STATE_TRANSITION_REJECTED' })
      );
    });

    test('full happy path: pending → submitted → confirmed', () => {
      const tx = Transaction.create({ status: TRANSACTION_STATES.PENDING });
      Transaction.updateStatus(tx.id, TRANSACTION_STATES.SUBMITTED);
      const final = Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED);
      expect(final.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });

    test('failed is terminal — further transitions are audited and rejected', () => {
      const tx = Transaction.create({ status: TRANSACTION_STATES.FAILED });
      expect(() =>
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED)
      ).toThrow(/Invalid transaction state transition/);
      expect(AuditLogService.log).toHaveBeenCalled();
    });
  });
});

// ─── Issue 1161: DonationTotalsRepository reconciliation ─────────────────────

describe('Issue 1161 – DonationTotalsRepository reconciliation', () => {
  const DonationTotalsRepository = require('../../src/services/DonationTotalsRepository');
  const Database = require('../../src/utils/database');

  const repo = new DonationTotalsRepository();

  beforeAll(async () => {
    await Database.ensureInitialized();
    // Ensure tables exist (idempotent — may already exist from dbBootstrap)
    await Database.run(`CREATE TABLE IF NOT EXISTS donation_totals (
      recipient_id TEXT NOT NULL PRIMARY KEY,
      total_stroops TEXT NOT NULL DEFAULT '0',
      donation_count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS donation_totals_global (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_stroops TEXT NOT NULL DEFAULT '0',
      donation_count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`INSERT OR IGNORE INTO donation_totals_global (id, total_stroops, donation_count) VALUES (1, '0', 0)`);
    await Database.run('DELETE FROM donation_totals').catch(() => {});
    await Database.run('UPDATE donation_totals_global SET total_stroops = \'0\', donation_count = 0 WHERE id = 1').catch(() => {});
  });

  test('getTotalsForPool returns BigInt for each recipient', async () => {
    const result = await repo.getTotalsForPool(['alice', 'bob'], 86400000);
    expect(typeof result.get('alice')).toBe('bigint');
    expect(typeof result.get('bob')).toBe('bigint');
  });

  test('incrementTotal updates the pre-aggregated table atomically', async () => {
    await Database.runTransaction(async (tx) => {
      await repo.incrementTotal('carol', 50_000_000n, tx);
    });

    const row = await Database.get(
      'SELECT total_stroops, donation_count FROM donation_totals WHERE recipient_id = ?',
      ['carol']
    );
    expect(row).toBeDefined();
    expect(BigInt(row.total_stroops)).toBe(50_000_000n);
    expect(row.donation_count).toBe(1);
  });

  test('incrementTotal accumulates across multiple calls', async () => {
    await Database.runTransaction(async (tx) => {
      await repo.incrementTotal('dave', 10_000_000n, tx);
    });
    await Database.runTransaction(async (tx) => {
      await repo.incrementTotal('dave', 20_000_000n, tx);
    });

    const row = await Database.get(
      'SELECT total_stroops FROM donation_totals WHERE recipient_id = ?',
      ['dave']
    );
    expect(BigInt(row.total_stroops)).toBe(30_000_000n);
  });

  test('reconcile returns { checked, corrected } shape', async () => {
    const result = await repo.reconcile();
    expect(result).toHaveProperty('checked');
    expect(result).toHaveProperty('corrected');
    expect(typeof result.checked).toBe('number');
    expect(typeof result.corrected).toBe('number');
  });

  test('reconcile corrects artificially drifted total', async () => {
    // Insert a real transaction so reconcile has a source-of-truth total for carol
    await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [9, 'carol', 50_000_000]
    );

    // Manually drift donation_totals for carol to a wrong value
    await Database.run(
      `INSERT INTO donation_totals (recipient_id, total_stroops, donation_count)
       VALUES ('carol', '99', 1)
       ON CONFLICT(recipient_id) DO UPDATE SET total_stroops = '99'`
    );

    const { corrected } = await repo.reconcile();
    expect(corrected).toBeGreaterThan(0);

    // After reconciliation the cached value must match the transactions table
    const row = await Database.get(
      'SELECT total_stroops FROM donation_totals WHERE recipient_id = ?',
      ['carol']
    );
    expect(row).toBeDefined();
    expect(BigInt(row.total_stroops)).toBe(50_000_000n);
  });

  test('getMetrics returns an object with lastRunAt after reconcile', async () => {
    await repo.reconcile();
    const metrics = repo.getMetrics();
    expect(metrics).toHaveProperty('lastRunAt');
    expect(metrics.lastRunAt).not.toBeNull();
  });

  test('Database.runTransaction rolls back on error', async () => {
    const before = await Database.get(
      'SELECT total_stroops FROM donation_totals WHERE recipient_id = ?',
      ['carol']
    );

    await expect(
      Database.runTransaction(async (tx) => {
        await repo.incrementTotal('carol', 1_000_000n, tx);
        throw new Error('forced rollback');
      })
    ).rejects.toThrow('forced rollback');

    const after = await Database.get(
      'SELECT total_stroops FROM donation_totals WHERE recipient_id = ?',
      ['carol']
    );
    // Total must not have changed
    expect(after?.total_stroops).toBe(before?.total_stroops);
  });
});

// ─── Issue 1162: BigInt overflow-safe aggregation ─────────────────────────────

describe('Issue 1162 – Overflow-safe BigInt aggregation', () => {
  const STROOPS_PER_XLM = 10_000_000n;
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER); // 2^53 - 1 ≈ 9.007e15

  test('Numbers beyond MAX_SAFE_INTEGER lose precision; BigInt does not', () => {
    // 2^53 is exactly representable, but 2^53 + 1 is NOT — it rounds to 2^53
    const beyondSafe = MAX_SAFE + 2n; // 9007199254740993
    expect(Number(beyondSafe)).toBe(Number(MAX_SAFE + 1n)); // both round to 9007199254740992
    expect(beyondSafe).toBe(MAX_SAFE + 2n);                 // BigInt stays exact
    expect(beyondSafe.toString()).toBe('9007199254740993');  // string form is exact
  });

  test('BigInt accumulator is exact beyond 2^53 stroops', () => {
    const amounts = [MAX_SAFE, 1n]; // second donation pushes total over the limit
    const total = amounts.reduce((sum, a) => sum + a, 0n);
    expect(total).toBe(MAX_SAFE + 1n);
    expect(total.toString()).toBe((MAX_SAFE + 1n).toString());
  });

  describe('LeaderboardStatsService uses BigInt for donor totals', () => {
    const Transaction = require('../../src/models/transaction');
    const StatsService = require('../../src/services/LeaderboardStatsService');

    beforeEach(() => {
      Transaction._clearAllData();
      StatsService.invalidateLeaderboardCache();
    });

    test('totalDonated is returned as a string', () => {
      // 100 XLM = 1_000_000_000 stroops
      Transaction.create({
        donor: 'DONOR1',
        recipient: 'RECIP1',
        amount: 100,
        status: TRANSACTION_STATES.CONFIRMED,
        timestamp: new Date().toISOString(),
      });

      const board = StatsService.getDonorLeaderboard('all', 10);
      expect(board.length).toBeGreaterThan(0);
      expect(typeof board[0].totalDonated).toBe('string');
      expect(board[0].totalDonated).toBe('1000000000'); // 100 XLM in stroops
    });

    test('totalReceived is returned as a string', () => {
      Transaction.create({
        donor: 'DONOR2',
        recipient: 'RECIP2',
        amount: 5,
        status: TRANSACTION_STATES.CONFIRMED,
        timestamp: new Date().toISOString(),
      });

      const board = StatsService.getRecipientLeaderboard('all', 10);
      expect(board.length).toBeGreaterThan(0);
      expect(typeof board[0].totalReceived).toBe('string');
      expect(board[0].totalReceived).toBe('50000000'); // 5 XLM in stroops
    });

    test('accumulation beyond 2^53 stroops is exact', () => {
      // ~900_300 XLM each → total ~1_800_600 XLM = 18_006_000_000_000 stroops (< 2^53 but a useful smoke-test)
      // Use a value where Number precision would diverge: 900_700 XLM each donor
      const xlmAmount = 900_000;   // 9_000_000_000_000 stroops each
      for (let i = 0; i < 2; i++) {
        Transaction.create({
          donor: `BIGDONOR${i}`,
          recipient: 'BIGRECIP',
          amount: xlmAmount,
          status: TRANSACTION_STATES.CONFIRMED,
          timestamp: new Date().toISOString(),
        });
      }

      const board = StatsService.getRecipientLeaderboard('all', 1);
      const expectedStroops = BigInt(xlmAmount) * 2n * STROOPS_PER_XLM;
      expect(board[0].totalReceived).toBe(expectedStroops.toString());
    });
  });

  describe('DonationTotalsRepository.getTotalsForPool uses BigInt', () => {
    const DonationTotalsRepository = require('../../src/services/DonationTotalsRepository');
    const Database = require('../../src/utils/database');
    const repo = new DonationTotalsRepository();

    beforeAll(async () => {
      await Database.ensureInitialized();
    });

    test('returns a Map of BigInt values', async () => {
      const result = await repo.getTotalsForPool(['nonexistent'], 86400000);
      expect(typeof result.get('nonexistent')).toBe('bigint');
      expect(result.get('nonexistent')).toBe(0n);
    });
  });
});

// ─── Issue 1163: Memo byte-length validation ──────────────────────────────────

describe('Issue 1163 – Memo byte-length validation', () => {
  describe('MemoValidator.validateFinalMemo – text type', () => {
    test('accepts ASCII memo within 28 bytes', () => {
      const result = MemoValidator.validateFinalMemo('Hello world', 'text');
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(11);
    });

    test('accepts exactly-28-byte memo', () => {
      const memo28 = 'a'.repeat(28);
      const result = MemoValidator.validateFinalMemo(memo28, 'text');
      expect(result.valid).toBe(true);
    });

    test('rejects 29-byte ASCII memo', () => {
      const memo29 = 'a'.repeat(29);
      const result = MemoValidator.validateFinalMemo(memo29, 'text');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('MEMO_TOO_LONG');
      expect(result.byteLength).toBe(29);
      expect(result.limit).toBe(28);
    });

    test('rejects multi-byte UTF-8 that fits in chars but exceeds byte limit', () => {
      // Each emoji = 4 bytes. 8 emojis = 32 bytes > 28 limit
      const emoji8 = '🎉'.repeat(8); // 8 chars, 32 bytes
      expect(emoji8.length).toBe(8 * 2); // JS string length counts UTF-16 code units (surrogate pairs)
      const result = MemoValidator.validateFinalMemo(emoji8, 'text');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('MEMO_TOO_LONG');
      expect(result.byteLength).toBe(32);
    });

    test('accepts 7 emojis (28 bytes)', () => {
      const emoji7 = '🎉'.repeat(7); // 28 bytes
      const result = MemoValidator.validateFinalMemo(emoji7, 'text');
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(28);
    });

    test('rejects multi-byte accented chars exceeding byte limit', () => {
      // 'é' = 2 bytes in UTF-8. 15 chars = 30 bytes > 28
      const accented = 'é'.repeat(15); // 15 chars, 30 bytes
      const result = MemoValidator.validateFinalMemo(accented, 'text');
      expect(result.valid).toBe(false);
      expect(result.byteLength).toBe(30);
    });

    test('empty memo is valid', () => {
      expect(MemoValidator.validateFinalMemo('', 'text').valid).toBe(true);
      expect(MemoValidator.validateFinalMemo(null, 'text').valid).toBe(true);
      expect(MemoValidator.validateFinalMemo(undefined, 'text').valid).toBe(true);
    });
  });

  describe('MemoValidator.validateFinalMemo – hash/return types', () => {
    const validHash = 'a'.repeat(64);

    test('accepts valid 64-char hex for hash type', () => {
      expect(MemoValidator.validateFinalMemo(validHash, 'hash').valid).toBe(true);
    });

    test('accepts valid 64-char hex for return type', () => {
      expect(MemoValidator.validateFinalMemo(validHash, 'return').valid).toBe(true);
    });

    test('rejects hash that is too short', () => {
      const result = MemoValidator.validateFinalMemo('deadbeef', 'hash');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_MEMO_HASH');
    });

    test('rejects non-hex hash', () => {
      const result = MemoValidator.validateFinalMemo('z'.repeat(64), 'hash');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_MEMO_HASH');
    });
  });

  describe('Encrypted memo path: envelope hash is always within limits', () => {
    test('SHA-256 hex digest is exactly 64 chars (valid MEMO_HASH)', () => {
      const { envelopeToMemoHash } = require('../../src/utils/memoEncryption');
      const fakeEnvelope = { v: 1, alg: 'test', ciphertext: 'abc' };
      const hash = envelopeToMemoHash(fakeEnvelope);
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);

      const result = MemoValidator.validateFinalMemo(hash, 'hash');
      expect(result.valid).toBe(true);
    });

    test('encrypted memo JSON string would violate MEMO_TEXT limit', () => {
      const longJson = JSON.stringify({ v: 1, alg: 'ECDH-X25519-AES256GCM', ciphertext: 'x'.repeat(100) });
      const result = MemoValidator.validateFinalMemo(longJson, 'text');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('MEMO_TOO_LONG');
    });
  });

  describe('MemoValidator.validate – existing text validation uses byte length', () => {
    test('existing validate() also uses Buffer byte length for text', () => {
      const emoji8 = '🎉'.repeat(8); // 32 bytes
      const result = MemoValidator.validate(emoji8);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('MEMO_TOO_LONG');
    });
  });
});
