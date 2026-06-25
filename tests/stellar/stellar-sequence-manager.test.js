/**
 * Tests for Stellar Sequence Number Management (Issue #1105)
 * 
 * Verifies correct reserve/commit/release lifecycle,
 * cross-instance coordination, and reconciliation with Horizon.
 */

const { SequenceManager, initSequenceTables } = require('../../src/services/SequenceManager');
const db = require('../../src/utils/database');

describe('Sequence Number Manager (Issue #1105)', () => {
  const testAccount = 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTUNKNOW5D2DZST2CSXZJMVLSN';

  beforeEach(async () => {
    // Setup test database
    await initSequenceTables();
  });

  afterEach(async () => {
    // Cleanup
    await db.run('DELETE FROM sequence_allocations');
    await db.run('DELETE FROM sequence_locks');
  });

  describe('reserve/commit/release lifecycle', () => {
    test('should reserve next sequence number', async () => {
      const manager = new SequenceManager();
      
      const { sequence, reservationId } = await manager.reserve(testAccount);

      expect(sequence).toBe('1');
      expect(reservationId).toContain(testAccount);
      expect(manager.metrics.reserved).toBe(1);
    });

    test('should increment sequence on consecutive reserves', async () => {
      const manager = new SequenceManager();
      
      const res1 = await manager.reserve(testAccount);
      const res2 = await manager.reserve(testAccount);

      expect(res1.sequence).toBe('1');
      expect(res2.sequence).toBe('2');
      expect(manager.metrics.reserved).toBe(2);
    });

    test('should commit a reserved sequence', async () => {
      const manager = new SequenceManager();
      
      const { reservationId } = await manager.reserve(testAccount);
      await manager.commit(reservationId, 'tx-hash-123');

      expect(manager.metrics.committed).toBe(1);
      expect(manager.cache.get(testAccount)).toBe('1');
    });

    test('should release a reserved sequence', async () => {
      const manager = new SequenceManager();
      
      const { reservationId } = await manager.reserve(testAccount);
      await manager.release(reservationId, 'submission_failed');

      expect(manager.metrics.released).toBe(1);
    });

    test('should fail to commit a released sequence', async () => {
      const manager = new SequenceManager();
      
      const { reservationId } = await manager.reserve(testAccount);
      await manager.release(reservationId);

      await expect(manager.commit(reservationId)).rejects.toThrow();
    });

    test('should recover from crash between reserve and commit', async () => {
      const manager = new SequenceManager();
      
      // Reserve sequence
      const { sequence } = await manager.reserve(testAccount);
      expect(sequence).toBe('1');

      // Simulate crash - cleanup expired reservations
      await manager.cleanupExpiredReservations();

      // Next reserve should use same sequence (now released)
      const { sequence: nextSeq } = await manager.reserve(testAccount);
      expect(nextSeq).toBe('2');
    });
  });

  describe('Cross-instance coordination', () => {
    test('second instance should wait for first lock', async () => {
      const manager1 = new SequenceManager({ lockTimeoutMs: 10000 });
      const manager2 = new SequenceManager({ lockTimeoutMs: 10000 });

      // Instance 1 reserves
      const res1 = await manager1.reserve(testAccount);
      expect(res1.sequence).toBe('1');

      // Instance 2 should get sequence 2 (serialized)
      const res2 = await manager2.reserve(testAccount);
      expect(res2.sequence).toBe('2');
    });

    test('should prevent sequence collision across instances', async () => {
      const manager1 = new SequenceManager();
      const manager2 = new SequenceManager();

      const sequences = new Set();
      
      const res1 = await manager1.reserve(testAccount);
      sequences.add(res1.sequence);

      const res2 = await manager2.reserve(testAccount);
      sequences.add(res2.sequence);

      // Should have 2 unique sequences
      expect(sequences.size).toBe(2);
      expect(sequences.has('1')).toBe(true);
      expect(sequences.has('2')).toBe(true);
    });

    test('should release stale locks after timeout', async () => {
      const manager = new SequenceManager({ lockTimeoutMs: 100 });

      // Create stale lock
      await db.run(`
        INSERT INTO sequence_locks 
        (account_address, locked_by, locked_at, expires_at)
        VALUES (?, ?, ?, ?)
      `, [testAccount, 'stale-instance', Date.now() - 200, Date.now() - 100]);

      // Should be able to acquire lock despite stale entry
      const { sequence } = await manager.reserve(testAccount);
      expect(sequence).toBe('1');
    });
  });

  describe('Reconciliation with Horizon', () => {
    test('should detect gap in sequence numbers', async () => {
      const manager = new SequenceManager();

      // Commit sequence 1
      const { reservationId: res1 } = await manager.reserve(testAccount);
      await manager.commit(res1);

      // Simulate out-of-band transaction that consumed seq 2,3
      manager.cache.set(testAccount, '1');

      // Mock Horizon client
      const horizonClient = {
        accounts: () => ({
          accountId: () => ({
            call: async () => ({ sequence: '4' }), // On-chain is at 4
          }),
        }),
      };

      const result = await manager.reconcile(testAccount, horizonClient);
      
      expect(result.gap_detected).toBe(true);
      expect(result.recovered).toBeGreaterThan(0);
      expect(manager.metrics.gaps_detected).toBe(1);
    });

    test('should handle out-of-band transactions', async () => {
      const manager = new SequenceManager();

      manager.cache.set(testAccount, '5');

      const horizonClient = {
        accounts: () => ({
          accountId: () => ({
            call: async () => ({ sequence: '10' }), // 5 sequences consumed
          }),
        }),
      };

      const result = await manager.reconcile(testAccount, horizonClient);
      expect(result.gap_detected).toBe(true);
    });

    test('should clean up released sequences older than expiry', async () => {
      const manager = new SequenceManager({ reservationExpiryMs: 1000 });

      // Create old released sequence
      const oldTime = Date.now() - 2000;
      await db.run(`
        INSERT INTO sequence_allocations
        (account_address, sequence_number, state, instance_id, reserved_at, released_at)
        VALUES (?, '1', 'released', ?, ?, ?)
      `, [testAccount, 'test-instance', oldTime - 1000, oldTime]);

      // Create recent released sequence
      await db.run(`
        INSERT INTO sequence_allocations
        (account_address, sequence_number, state, instance_id, reserved_at, released_at)
        VALUES (?, '2', 'released', ?, ?, ?)
      `, [testAccount, 'test-instance', Date.now() - 100, Date.now() - 100]);

      const horizonClient = {
        accounts: () => ({
          accountId: () => ({
            call: async () => ({ sequence: '0' }),
          }),
        }),
      };

      await manager.reconcile(testAccount, horizonClient);

      // Old sequence should be deleted
      const oldSeq = await db.get(
        'SELECT * FROM sequence_allocations WHERE sequence_number = ? AND account_address = ?',
        ['1', testAccount]
      );
      expect(oldSeq).toBeUndefined();

      // Recent sequence should remain
      const recentSeq = await db.get(
        'SELECT * FROM sequence_allocations WHERE sequence_number = ? AND account_address = ?',
        ['2', testAccount]
      );
      expect(recentSeq).toBeDefined();
    });
  });

  describe('Metrics', () => {
    test('should track metrics accurately', async () => {
      const manager = new SequenceManager();

      const res1 = await manager.reserve(testAccount);
      const res2 = await manager.reserve(testAccount);
      
      await manager.commit(res1);
      await manager.release(res2);

      const metrics = manager.getMetrics();
      expect(metrics.reserved).toBe(2);
      expect(metrics.committed).toBe(1);
      expect(metrics.released).toBe(1);
    });
  });
});
