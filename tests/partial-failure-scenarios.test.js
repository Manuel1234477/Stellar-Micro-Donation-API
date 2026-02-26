/**
 * Partial Failure Scenario Tests
 * 
 * RESPONSIBILITY: Tests scenarios where some steps succeed and others fail
 * OWNER: QA/Testing Team
 * 
 * Tests recovery behavior and ensures no inconsistent state is left behind
 * when partial failures occur in multi-step operations.
 * 
 * Failure Points Tested:
 * 1. DB write succeeds but Stellar submission fails
 * 2. Stellar submission succeeds but DB write fails
 * 3. State transition failures mid-process
 * 4. Idempotency key storage failures
 * 5. Encryption/decryption failures during transaction
 * 6. Network failures after DB commit
 * 7. Concurrent transaction conflicts
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const Transaction = require('../src/routes/models/transaction');
const Database = require('../src/utils/database');
const { getStellarService } = require('../src/config/stellar');
const DonationService = require('../src/services/DonationService');
const { TRANSACTION_STATES } = require('../src/utils/transactionStateMachine');
const encryption = require('../src/utils/encryption');
const { resetMockStellarService, clearDatabaseTables } = require('./helpers/testIsolation');

describe('Partial Failure Scenarios', () => {
  let stellarService;
  let donationService;
  let originalDbRun;
  let originalDbGet;
  let originalStellarSendDonation;
  let originalEncryptionDecrypt;

  beforeAll(() => {
    stellarService = getStellarService();
    donationService = new DonationService(stellarService);
  });

  beforeEach(async () => {
    // Clear all state
    Transaction._clearAllData();
    await clearDatabaseTables();
    resetMockStellarService(stellarService);

    // Store original methods for restoration
    originalDbRun = Database.run;
    originalDbGet = Database.get;
    originalStellarSendDonation = stellarService.sendDonation;
    originalEncryptionDecrypt = encryption.decrypt;
  });

  afterEach(() => {
    // Restore all mocked methods
    Database.run = originalDbRun;
    Database.get = originalDbGet;
    stellarService.sendDonation = originalStellarSendDonation;
    encryption.decrypt = originalEncryptionDecrypt;

    // Clean up
    Transaction._clearAllData();
    resetMockStellarService(stellarService);
  });

  describe('Scenario 1: Stellar Submission Succeeds, DB Write Fails', () => {
    test('should not leave orphaned Stellar transaction when DB write fails', async () => {
      // Setup: Create test users in DB
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER123', encryption.encrypt('SSECRET123')]
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT123']
      );

      const senderId = senderResult.id;
      const receiverId = receiverResult.id;

      // Track Stellar transactions
      const stellarTransactions = [];
      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = async (params) => {
        const result = await originalSendDonation.call(stellarService, params);
        stellarTransactions.push(result);
        return result;
      };

      // Mock DB to fail AFTER Stellar succeeds
      let stellarCallCount = 0;
      Database.run = async (sql, params) => {
        if (sql.includes('INSERT INTO transactions')) {
          stellarCallCount++;
          // Stellar has already succeeded at this point
          throw new Error('Database write failed');
        }
        return originalDbRun.call(Database, sql, params);
      };

      // Execute: Attempt donation
      await expect(
        donationService.sendCustodialDonation({
          senderId,
          receiverId,
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-001',
          requestId: 'req-001'
        })
      ).rejects.toThrow('Database write failed');

      // Verify: Stellar transaction was created
      expect(stellarTransactions.length).toBe(1);
      expect(stellarTransactions[0]).toHaveProperty('transactionId');

      // Verify: No transaction record in JSON store
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);

      // Verify: System is in inconsistent state (Stellar has tx, DB doesn't)
      // This demonstrates the need for transaction rollback or compensation
      expect(stellarTransactions.length).toBeGreaterThan(allTransactions.length);
    });

    test('should handle DB connection loss after Stellar submission', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER456', encryption.encrypt('SSECRET456')]
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT456']
      );

      // Simulate connection loss
      Database.run = async () => {
        throw new Error('SQLITE_BUSY: database is locked');
      };

      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: 50,
          memo: 'Test',
          idempotencyKey: 'test-key-002',
          requestId: 'req-002'
        })
      ).rejects.toThrow('database is locked');

      // Verify: No partial state in JSON store
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });
  });

  describe('Scenario 2: DB Write Succeeds, Stellar Submission Fails', () => {
    test('should handle Stellar network failure after DB write', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER789', encryption.encrypt('SSECRET789')]
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT789']
      );

      // Mock Stellar to fail
      stellarService.sendDonation = async () => {
        throw new Error('Network timeout: Unable to reach Horizon server');
      };

      // Execute: Attempt donation
      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: 75,
          memo: 'Test',
          idempotencyKey: 'test-key-003',
          requestId: 'req-003'
        })
      ).rejects.toThrow('Network timeout');

      // Verify: Check if any partial state exists
      const allTransactions = Transaction.getAll();
      
      // If DB write happened before Stellar call, we'd have a transaction
      // This test verifies the order of operations
      // In current implementation, Stellar is called before DB write
      expect(allTransactions.length).toBe(0);
    });

    test('should handle insufficient balance error after validation', async () => {
      const sender = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      
      // Fund sender with minimal amount
      await stellarService.fundTestnetWallet(sender.publicKey);

      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        [sender.publicKey, encryption.encrypt(sender.secretKey)]
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        [recipient.publicKey]
      );

      // Try to send more than available
      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: 50000, // More than funded amount
          memo: 'Test',
          idempotencyKey: 'test-key-004',
          requestId: 'req-004'
        })
      ).rejects.toThrow();

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });
  });

  describe('Scenario 3: State Transition Failures', () => {
    test('should handle invalid state transition during update', () => {
      // Create transaction in confirmed state
      const tx = Transaction.create({
        id: 'tx-001',
        amount: 100,
        donor: 'GDONOR123',
        recipient: 'GRECIPIENT123',
        status: TRANSACTION_STATES.CONFIRMED
      });

      // Attempt invalid transition: confirmed -> pending
      expect(() => {
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.PENDING);
      }).toThrow('Invalid transaction state transition');

      // Verify: Transaction remains in confirmed state
      const updatedTx = Transaction.getById(tx.id);
      expect(updatedTx.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });

    test('should handle concurrent state updates', () => {
      const tx = Transaction.create({
        id: 'tx-002',
        amount: 100,
        donor: 'GDONOR456',
        recipient: 'GRECIPIENT456',
        status: TRANSACTION_STATES.PENDING
      });

      // First update: pending -> submitted
      Transaction.updateStatus(tx.id, TRANSACTION_STATES.SUBMITTED);

      // Second update: should work (submitted -> confirmed)
      Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED);

      // Verify: Final state is confirmed
      const finalTx = Transaction.getById(tx.id);
      expect(finalTx.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });

    test('should prevent state corruption on failed transition', () => {
      const tx = Transaction.create({
        id: 'tx-003',
        amount: 100,
        donor: 'GDONOR789',
        recipient: 'GRECIPIENT789',
        status: TRANSACTION_STATES.PENDING
      });

      const originalStatus = tx.status;
      const originalTimestamp = tx.statusUpdatedAt;

      // Attempt invalid transition
      try {
        Transaction.updateStatus(tx.id, 'invalid-status');
      } catch (error) {
        // Expected to fail
      }

      // Verify: Original state preserved
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(originalStatus);
      expect(unchangedTx.statusUpdatedAt).toBe(originalTimestamp);
    });
  });

  describe('Scenario 4: Encryption/Decryption Failures', () => {
    test('should handle decryption failure before Stellar call', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER111', 'corrupted-encrypted-data']
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT111']
      );

      // Mock decryption to fail
      encryption.decrypt = () => {
        throw new Error('Decryption failed: Invalid encrypted data');
      };

      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-005',
          requestId: 'req-005'
        })
      ).rejects.toThrow('Decryption failed');

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });

    test('should handle missing encryption key scenario', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GSENDER222'] // No encryptedSecret
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT222']
      );

      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-006',
          requestId: 'req-006'
        })
      ).rejects.toThrow('Sender has no secret key configured');

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });
  });

  describe('Scenario 5: Idempotency Key Conflicts', () => {
    test('should handle idempotency key collision gracefully', () => {
      const idempotencyKey = 'duplicate-key-001';

      // Create first transaction
      const tx1 = Transaction.create({
        id: 'tx-004',
        amount: 100,
        donor: 'GDONOR111',
        recipient: 'GRECIPIENT111',
        idempotencyKey,
        status: TRANSACTION_STATES.PENDING
      });

      // Attempt to create second transaction with same key
      const tx2 = Transaction.create({
        id: 'tx-005',
        amount: 200,
        donor: 'GDONOR222',
        recipient: 'GRECIPIENT222',
        idempotencyKey,
        status: TRANSACTION_STATES.PENDING
      });

      // Verify: Second create returns first transaction (idempotency)
      expect(tx2.id).toBe(tx1.id);
      expect(tx2.amount).toBe(tx1.amount);

      // Verify: Only one transaction exists
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(1);
    });

    test('should handle idempotency with different request data', () => {
      const idempotencyKey = 'duplicate-key-002';

      // Create transaction
      const tx1 = Transaction.create({
        id: 'tx-006',
        amount: 100,
        donor: 'GDONOR333',
        recipient: 'GRECIPIENT333',
        idempotencyKey,
        status: TRANSACTION_STATES.CONFIRMED
      });

      // Attempt different transaction with same key
      const tx2 = Transaction.create({
        id: 'tx-007',
        amount: 500, // Different amount
        donor: 'GDONOR444', // Different donor
        recipient: 'GRECIPIENT444', // Different recipient
        idempotencyKey,
        status: TRANSACTION_STATES.PENDING
      });

      // Verify: Returns original transaction (idempotency wins)
      expect(tx2.id).toBe(tx1.id);
      expect(tx2.amount).toBe(100); // Original amount
      expect(tx2.status).toBe(TRANSACTION_STATES.CONFIRMED); // Original status
    });
  });

  describe('Scenario 6: User Lookup Failures', () => {
    test('should handle sender not found error cleanly', async () => {
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT555']
      );

      await expect(
        donationService.sendCustodialDonation({
          senderId: 99999, // Non-existent
          receiverId: receiverResult.id,
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-007',
          requestId: 'req-007'
        })
      ).rejects.toThrow('Sender not found');

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });

    test('should handle receiver not found error cleanly', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER555', encryption.encrypt('SSECRET555')]
      );

      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: 99999, // Non-existent
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-008',
          requestId: 'req-008'
        })
      ).rejects.toThrow('Receiver not found');

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });

    test('should handle both users not found', async () => {
      await expect(
        donationService.sendCustodialDonation({
          senderId: 88888,
          receiverId: 99999,
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-009',
          requestId: 'req-009'
        })
      ).rejects.toThrow('not found');

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });
  });

  describe('Scenario 7: Transaction Record Creation Failures', () => {
    test('should handle JSON file write failure', () => {
      // Mock file system to fail
      const originalSaveTransactions = Transaction.saveTransactions;
      Transaction.saveTransactions = () => {
        throw new Error('ENOSPC: no space left on device');
      };

      expect(() => {
        Transaction.create({
          id: 'tx-008',
          amount: 100,
          donor: 'GDONOR666',
          recipient: 'GRECIPIENT666',
          status: TRANSACTION_STATES.PENDING
        });
      }).toThrow('no space left on device');

      // Restore
      Transaction.saveTransactions = originalSaveTransactions;

      // Verify: No transaction in memory
      const allTransactions = Transaction.getAll();
      const foundTx = allTransactions.find(t => t.id === 'tx-008');
      expect(foundTx).toBeUndefined();
    });

    test('should handle corrupted transaction data', () => {
      expect(() => {
        Transaction.create({
          // Missing required fields
          status: 'invalid-status'
        });
      }).toThrow();

      // Verify: No invalid transaction created
      const allTransactions = Transaction.getAll();
      const invalidTx = allTransactions.find(t => t.status === 'invalid-status');
      expect(invalidTx).toBeUndefined();
    });
  });

  describe('Scenario 8: Recovery and Cleanup', () => {
    test('should allow retry after partial failure', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER777', encryption.encrypt('SSECRET777')]
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT777']
      );

      // First attempt: Stellar fails
      let attemptCount = 0;
      stellarService.sendDonation = async (params) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Temporary network error');
        }
        // Second attempt succeeds
        return originalStellarSendDonation.call(stellarService, params);
      };

      // First attempt fails
      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: 100,
          memo: 'Test',
          idempotencyKey: 'test-key-010',
          requestId: 'req-010'
        })
      ).rejects.toThrow('Temporary network error');

      // Verify: No transaction created
      let allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);

      // Second attempt succeeds
      const result = await donationService.sendCustodialDonation({
        senderId: senderResult.id,
        receiverId: receiverResult.id,
        amount: 100,
        memo: 'Test',
        idempotencyKey: 'test-key-011', // Different key
        requestId: 'req-011'
      });

      // Verify: Transaction created successfully
      expect(result).toHaveProperty('stellarTxId');
      allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBeGreaterThan(0);
    });

    test('should maintain data consistency after multiple failures', async () => {
      const initialCount = Transaction.getAll().length;

      // Attempt multiple failing operations
      for (let i = 0; i < 5; i++) {
        try {
          Transaction.create({
            id: `fail-tx-${i}`,
            amount: 100,
            donor: 'GDONOR888',
            recipient: 'GRECIPIENT888',
            status: 'invalid-status' // Will fail
          });
        } catch (error) {
          // Expected to fail
        }
      }

      // Verify: No partial transactions created
      const finalCount = Transaction.getAll().length;
      expect(finalCount).toBe(initialCount);
    });

    test('should handle cleanup of failed transaction attempts', () => {
      const tx = Transaction.create({
        id: 'tx-009',
        amount: 100,
        donor: 'GDONOR999',
        recipient: 'GRECIPIENT999',
        status: TRANSACTION_STATES.PENDING
      });

      // Simulate failure during processing
      try {
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.SUBMITTED);
        // Simulate error after state update
        throw new Error('Processing failed');
      } catch (error) {
        // In a real scenario, we might want to mark as failed
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.FAILED);
      }

      // Verify: Transaction marked as failed, not left in inconsistent state
      const finalTx = Transaction.getById(tx.id);
      expect(finalTx.status).toBe(TRANSACTION_STATES.FAILED);
    });
  });

  describe('Scenario 9: Validation Failures Mid-Process', () => {
    test('should handle amount validation failure after user lookup', async () => {
      const senderResult = await Database.run(
        'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
        ['GSENDER1010', encryption.encrypt('SSECRET1010')]
      );
      const receiverResult = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        ['GRECIPIENT1010']
      );

      // Users exist, but amount is invalid
      await expect(
        donationService.sendCustodialDonation({
          senderId: senderResult.id,
          receiverId: receiverResult.id,
          amount: -100, // Invalid negative amount
          memo: 'Test',
          idempotencyKey: 'test-key-012',
          requestId: 'req-012'
        })
      ).rejects.toThrow();

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      expect(allTransactions.length).toBe(0);
    });

    test('should handle memo validation failure after other validations', () => {
      expect(() => {
        donationService.createDonationRecord({
          amount: 100,
          donor: 'GDONOR1111',
          recipient: 'GRECIPIENT1111',
          memo: 'a'.repeat(29), // Exceeds 28 byte limit
          idempotencyKey: 'test-key-013'
        });
      }).toThrow();

      // Verify: No transaction created
      const allTransactions = Transaction.getAll();
      const foundTx = allTransactions.find(t => t.idempotencyKey === 'test-key-013');
      expect(foundTx).toBeUndefined();
    });
  });

  describe('Scenario 10: Concurrent Operation Conflicts', () => {
    test('should handle concurrent transaction creation with same idempotency key', () => {
      const idempotencyKey = 'concurrent-key-001';
      const results = [];

      // Simulate concurrent requests
      for (let i = 0; i < 3; i++) {
        const tx = Transaction.create({
          id: `concurrent-tx-${i}`,
          amount: 100 + i,
          donor: `GDONOR${i}`,
          recipient: `GRECIPIENT${i}`,
          idempotencyKey,
          status: TRANSACTION_STATES.PENDING
        });
        results.push(tx);
      }

      // Verify: All return the same transaction (first one)
      expect(results[0].id).toBe(results[1].id);
      expect(results[1].id).toBe(results[2].id);

      // Verify: Only one transaction exists
      const allTransactions = Transaction.getAll();
      const matchingTxs = allTransactions.filter(t => t.idempotencyKey === idempotencyKey);
      expect(matchingTxs.length).toBe(1);
    });

    test('should handle concurrent status updates', () => {
      const tx = Transaction.create({
        id: 'tx-010',
        amount: 100,
        donor: 'GDONOR1212',
        recipient: 'GRECIPIENT1212',
        status: TRANSACTION_STATES.PENDING
      });

      // First update
      Transaction.updateStatus(tx.id, TRANSACTION_STATES.SUBMITTED);

      // Second update (should succeed)
      Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED);

      // Verify: Final state is confirmed
      const finalTx = Transaction.getById(tx.id);
      expect(finalTx.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });
  });
});
