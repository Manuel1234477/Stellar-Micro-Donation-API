const Transaction = require('../../src/models/transaction');
const { v4: uuidv4 } = require('uuid');

describe('Transaction UUID ID Generation', () => {
  beforeEach(() => {
    Transaction._clearAllData();
  });

  afterEach(() => {
    Transaction._clearAllData();
  });

  describe('ID Generation', () => {
    test('should generate UUID v4 format IDs by default', () => {
      const transaction = Transaction.create({
        amount: 10,
        donor: 'GA123',
        recipient: 'GA456'
      });

      expect(transaction.id).toBeDefined();
      expect(typeof transaction.id).toBe('string');
      expect(transaction.id).toHaveLength(36);
      expect(transaction.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('should accept custom ID when provided', () => {
      const customId = 'custom-transaction-id';
      const transaction = Transaction.create({
        id: customId,
        amount: 10,
        donor: 'GA123',
        recipient: 'GA456'
      });

      expect(transaction.id).toBe(customId);
    });

    test('should generate unique IDs when concurrent transactions', async () => {
      const promises = Array.from({ length: 100 }, (_, i) => 
        Promise.resolve(Transaction.create({
          amount: 10 + i,
          donor: `GA123${i}`,
          recipient: `GA456${i}`
        }))
      );

      const transactions = await Promise.all(promises);
      const ids = transactions.map(t => t.id);

      // Check all IDs are unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);
      expect(ids.length).toBe(100);

      // Verify all IDs are UUID format
      ids.forEach(id => {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      });
    });

    test('should handle rapid successive creation without duplicates', () => {
      const transactions = [];
      for (let i = 0; i < 50; i++) {
        transactions.push(Transaction.create({
          amount: 10,
          donor: 'GA123',
          recipient: 'GA456'
        }));
      }

      const ids = transactions.map(t => t.id);
      const uniqueIds = new Set(ids);
      
      expect(uniqueIds.size).toBe(50);
      expect(ids.length).toBe(50);
    });

    test('should maintain backward compatibility when existing numeric IDs', () => {
      // Simulate existing transaction with numeric ID
      const existingTransaction = {
        id: '1234567890',
        amount: 10,
        donor: 'GA123',
        recipient: 'GA456',
        status: 'completed'
      };

      Transaction.saveTransactions([existingTransaction]);

      const retrieved = Transaction.getById('1234567890');
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe('1234567890');
      expect(retrieved.amount).toBe(10);
    });

    test('should handle idempotency key correctly when UUID IDs', () => {
      const idempotencyKey = 'test-key-123';
      const transaction1 = Transaction.create({
        idempotencyKey: idempotencyKey,
        amount: 10,
        donor: 'GA123',
        recipient: 'GA456'
      });

      const transaction2 = Transaction.create({
        idempotencyKey: idempotencyKey,
        amount: 20, // Different amount
        donor: 'GA789', // Different donor
        recipient: 'GA000'
      });

      expect(transaction1.id).toBeDefined();
      expect(transaction2.id).toBeDefined();
      expect(transaction1.id).toBe(transaction2.id); // Same ID due to idempotency
      expect(transaction1.amount).toBe(10); // Original amount preserved
      expect(transaction1.donor).toBe('GA123'); // Original donor preserved
    });

    test('should validate UUID format when custom IDs', () => {
      // Test with valid UUID
      const validUuid = uuidv4();
      const transaction1 = Transaction.create({
        id: validUuid,
        amount: 10,
        donor: 'GA123',
        recipient: 'GA456'
      });
      expect(transaction1.id).toBe(validUuid);

      // Test with invalid UUID format (should still work as custom ID is accepted)
      const invalidUuid = 'not-a-uuid';
      const transaction2 = Transaction.create({
        id: invalidUuid,
        amount: 20,
        donor: 'GA789',
        recipient: 'GA000'
      });
      expect(transaction2.id).toBe(invalidUuid);
    });

    test('should handle edge case of Date.now() collision scenario', () => {
      // Mock Date.now() to return the same value for multiple calls
      const originalDateNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        return 1234567890; // Fixed timestamp
      });

      const transactions = [];
      for (let i = 0; i < 10; i++) {
        transactions.push(Transaction.create({
          amount: 10,
          donor: 'GA123',
          recipient: 'GA456'
        }));
      }

      const ids = transactions.map(t => t.id);
      const uniqueIds = new Set(ids);

      // Restore original Date.now
      Date.now = originalDateNow;

      expect(uniqueIds.size).toBe(10);
      expect(ids.length).toBe(10);

      // All should be UUID format, not the old Date.now() format.
      // (A UUID's first group is legitimately all digits ~2% of the time, so
      // only reject a 13-digit millisecond-timestamp prefix.)
      ids.forEach(id => {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(id).not.toMatch(/^\d{13}-/); // Should not start with Date.now() timestamp
      });
    });

    test('should handle database persistence when UUID IDs', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'GA123456789',
        recipient: 'GA987654321'
      });

      // Verify transaction is saved
      const savedTransaction = Transaction.getById(transaction.id);
      expect(savedTransaction).toBeDefined();
      expect(savedTransaction.id).toBe(transaction.id);
      expect(savedTransaction.amount).toBe(100);
      expect(savedTransaction.donor).toBe('GA123456789');
      expect(savedTransaction.recipient).toBe('GA987654321');
    });

    test('should handle transaction updates when UUID IDs', () => {
      const transaction = Transaction.create({
        amount: 50,
        donor: 'GA123',
        recipient: 'GA456'
      });

      // Update status — legacy 'completed' is normalized to 'confirmed'
      const updatedTransaction = Transaction.updateStatus(transaction.id, 'completed');
      expect(updatedTransaction.id).toBe(transaction.id);
      expect(updatedTransaction.status).toBe('confirmed');

      // Verify update persisted
      const retrievedTransaction = Transaction.getById(transaction.id);
      expect(retrievedTransaction.status).toBe('confirmed');
    });
  });

  describe('Performance and Security', () => {
    test('should generate IDs efficiently', () => {
      // Time bare ID generation; full Transaction.create persistence cost is
      // dominated by the JSON store rewrite and is covered elsewhere.
      const start = process.hrtime.bigint();

      const ids = [];
      for (let i = 0; i < 1000; i++) {
        ids.push(uuidv4());
      }

      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;

      // Should generate 1000 IDs in reasonable time (< 100ms)
      expect(durationMs).toBeLessThan(100);

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(1000);
    });

    test('should not leak timing information through ID generation', () => {
      // Measure ID generation in batches: single-call durations are dominated
      // by scheduler/GC noise (and Transaction.create by JSON store rewrites,
      // which grow with file size), not by the ID generator itself.
      // Warm up so the first measured batch doesn't pay JIT/allocation costs
      for (let j = 0; j < 1000; j++) {
        uuidv4();
      }

      const durations = [];

      for (let i = 0; i < 10; i++) {
        const start = process.hrtime.bigint();
        for (let j = 0; j < 1000; j++) {
          uuidv4();
        }
        const end = process.hrtime.bigint();
        durations.push(Number(end - start));
      }

      // Compare the slowest batch to the median rather than to the fastest:
      // a single GC pause in one batch should not fail the test.
      const sorted = [...durations].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const maxDuration = Math.max(...durations);
      const ratio = maxDuration / median;

      // Timing should not vary significantly (max < 10x the median batch)
      expect(ratio).toBeLessThan(10);
    });

    test('should generate cryptographically secure IDs', () => {
      // 1000 IDs keeps the per-character frequency variance well inside the
      // asserted 5–15% band (100 IDs sits ~3 standard deviations from the
      // bound and trips intermittently).
      const ids = [];
      for (let i = 0; i < 1000; i++) {
        ids.push(uuidv4());
      }

      // Check for entropy - IDs should not be predictable
      const hexChars = ids.join('').replace(/-/g, '');
      const charCounts = {};
      
      for (const char of hexChars) {
        charCounts[char] = (charCounts[char] || 0) + 1;
      }

      // Each hex character should appear with reasonable frequency
      const totalChars = hexChars.length;
      Object.values(charCounts).forEach(count => {
        const frequency = count / totalChars;
        // Should be roughly evenly distributed (between 5% and 15% for each hex char)
        expect(frequency).toBeGreaterThan(0.05);
        expect(frequency).toBeLessThan(0.15);
      });
    });
  });

  describe('Integration with Existing System', () => {
    test('should work when existing transaction retrieval methods', () => {
      const transactions = [];
      for (let i = 0; i < 5; i++) {
        transactions.push(Transaction.create({
          amount: 10 + i,
          donor: `GA123${i}`,
          recipient: `GA456${i}`
        }));
      }

      // Test getById
      transactions.forEach(tx => {
        const retrieved = Transaction.getById(tx.id);
        expect(retrieved).toBeDefined();
        expect(retrieved.id).toBe(tx.id);
      });

      // Test getByStatus
      const pendingTransactions = Transaction.getByStatus('pending');
      expect(pendingTransactions.length).toBe(5);

      // Test getAll
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(5);
    });

    test('should work when pagination', () => {
      // Create 25 transactions
      for (let i = 0; i < 25; i++) {
        Transaction.create({
          amount: 10 + i,
          donor: `GA123${i}`,
          recipient: `GA456${i}`
        });
      }

      const page1 = Transaction.getPaginated({ limit: 10, offset: 0 });
      const page2 = Transaction.getPaginated({ limit: 10, offset: 10 });
      const page3 = Transaction.getPaginated({ limit: 10, offset: 20 });

      expect(page1.data.length).toBe(10);
      expect(page2.data.length).toBe(10);
      expect(page3.data.length).toBe(5);

      expect(page1.pagination.total).toBe(25);
      expect(page1.pagination.hasMore).toBe(true);
      expect(page2.pagination.hasMore).toBe(true);
      expect(page3.pagination.hasMore).toBe(false);

      // All IDs should be UUID format
      [...page1.data, ...page2.data, ...page3.data].forEach(tx => {
        expect(tx.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      });
    });
  });
});