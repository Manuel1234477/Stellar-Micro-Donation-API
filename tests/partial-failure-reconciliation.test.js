/**
 * Partial Failure Scenarios - Reconciliation Service
 * 
 * RESPONSIBILITY: Tests partial failures in transaction reconciliation process
 * OWNER: QA/Testing Team
 * 
 * Tests scenarios where reconciliation attempts to fix inconsistent state
 * but encounters failures during the recovery process.
 * 
 * Failure Points Tested:
 * 1. Reconciliation finds inconsistency but can't update DB
 * 2. Stellar verification succeeds but state update fails
 * 3. Partial reconciliation with some transactions failing
 * 4. Reconciliation interrupted mid-process
 * 5. Concurrent reconciliation attempts
 */

process.env.MOCK_STELLAR = 'true';

const Transaction = require('../src/routes/models/transaction');
const { getStellarService } = require('../src/config/stellar');
const TransactionReconciliationService = require('../src/services/TransactionReconciliationService');
const { TRANSACTION_STATES } = require('../src/utils/transactionStateMachine');
const { resetMockStellarService } = require('./helpers/testIsolation');

describe('Partial Failure Scenarios - Reconciliation', () => {
  let stellarService;
  let reconciliationService;
  let originalVerifyTransaction;
  let originalUpdateStatus;

  beforeAll(() => {
    stellarService = getStellarService();
    reconciliationService = new TransactionReconciliationService(stellarService);
  });

  beforeEach(() => {
    Transaction._clearAllData();
    resetMockStellarService(stellarService);
    
    // Store original methods
    originalVerifyTransaction = stellarService.verifyTransaction;
    originalUpdateStatus = Transaction.updateStatus;
  });

  afterEach(() => {
    // Restore original methods
    stellarService.verifyTransaction = originalVerifyTransaction;
    Transaction.updateStatus = originalUpdateStatus;
    
    Transaction._clearAllData();
    resetMockStellarService(stellarService);
  });

  describe('Scenario 1: Verification Succeeds, Update Fails', () => {
    test('should handle state update failure after successful verification', async () => {
      // Create pending transaction with Stellar ID
      const tx = Transaction.create({
        id: 'tx-recon-001',
        amount: 100,
        donor: 'GDONOR123',
        recipient: 'GRECIPIENT123',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-001'
      });

      // Mock verification to succeed
      stellarService.verifyTransaction = async () => ({
        verified: true,
        transaction: {
          hash: 'stellar-tx-001',
          ledger: 12345
        }
      });

      // Mock update to fail
      Transaction.updateStatus = () => {
        throw new Error('Database locked during update');
      };

      // Execute reconciliation
      await expect(
        reconciliationService.reconcileTransaction(tx)
      ).rejects.toThrow('Database locked during update');

      // Verify: Transaction still in pending state
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(TRANSACTION_STATES.PENDING);
    });

    test('should handle partial batch reconciliation failure', async () => {
      // Create multiple pending transactions
      const tx1 = Transaction.create({
        id: 'tx-recon-002',
        amount: 100,
        donor: 'GDONOR456',
        recipient: 'GRECIPIENT456',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-002'
      });

      const tx2 = Transaction.create({
        id: 'tx-recon-003',
        amount: 200,
        donor: 'GDONOR789',
        recipient: 'GRECIPIENT789',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-003'
      });

      const tx3 = Transaction.create({
        id: 'tx-recon-004',
        amount: 300,
        donor: 'GDONOR101',
        recipient: 'GRECIPIENT101',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-004'
      });

      // Mock verification to succeed for all
      stellarService.verifyTransaction = async (hash) => ({
        verified: true,
        transaction: {
          hash,
          ledger: 12345
        }
      });

      // Mock update to fail for second transaction only
      let updateCount = 0;
      Transaction.updateStatus = (id, status, data) => {
        updateCount++;
        if (id === 'tx-recon-003') {
          throw new Error('Update failed for tx-recon-003');
        }
        return originalUpdateStatus.call(Transaction, id, status, data);
      };

      // Execute reconciliation for all
      const results = await Promise.allSettled([
        reconciliationService.reconcileTransaction(tx1),
        reconciliationService.reconcileTransaction(tx2),
        reconciliationService.reconcileTransaction(tx3)
      ]);

      // Verify: First and third succeeded, second failed
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');

      // Verify: States reflect partial success
      const finalTx1 = Transaction.getById('tx-recon-002');
      const finalTx2 = Transaction.getById('tx-recon-003');
      const finalTx3 = Transaction.getById('tx-recon-004');

      expect(finalTx1.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(finalTx2.status).toBe(TRANSACTION_STATES.PENDING); // Failed to update
      expect(finalTx3.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });
  });

  describe('Scenario 2: Verification Failures', () => {
    test('should handle Stellar verification timeout', async () => {
      const tx = Transaction.create({
        id: 'tx-recon-005',
        amount: 100,
        donor: 'GDONOR111',
        recipient: 'GRECIPIENT111',
        status: TRANSACTION_STATES.SUBMITTED,
        stellarTxId: 'stellar-tx-005'
      });

      // Mock verification to timeout
      stellarService.verifyTransaction = async () => {
        throw new Error('Request timeout: Horizon server not responding');
      };

      // Execute reconciliation
      const result = await reconciliationService.reconcileTransaction(tx);

      // Verify: Returns false (no correction made)
      expect(result).toBe(false);

      // Verify: Transaction state unchanged
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(TRANSACTION_STATES.SUBMITTED);
    });

    test('should handle transaction not found on network', async () => {
      const tx = Transaction.create({
        id: 'tx-recon-006',
        amount: 100,
        donor: 'GDONOR222',
        recipient: 'GRECIPIENT222',
        status: TRANSACTION_STATES.SUBMITTED,
        stellarTxId: 'non-existent-tx'
      });

      // Mock verification to return 404
      stellarService.verifyTransaction = async () => {
        const error = new Error('Transaction not found');
        error.status = 404;
        throw error;
      };

      // Execute reconciliation
      const result = await reconciliationService.reconcileTransaction(tx);

      // Verify: Returns false (transaction not found is expected for recent txs)
      expect(result).toBe(false);

      // Verify: Transaction state unchanged
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(TRANSACTION_STATES.SUBMITTED);
    });
  });

  describe('Scenario 3: Reconciliation Service State', () => {
    test('should handle reconciliation already in progress', async () => {
      // Set reconciliation in progress
      reconciliationService.reconciliationInProgress = true;

      // Attempt to start reconciliation
      await reconciliationService.reconcile();

      // Verify: Reconciliation was skipped (no error thrown)
      expect(reconciliationService.reconciliationInProgress).toBe(true);
    });

    test('should reset in-progress flag after failure', async () => {
      // Create transaction that will cause error
      const tx = Transaction.create({
        id: 'tx-recon-007',
        amount: 100,
        donor: 'GDONOR333',
        recipient: 'GRECIPIENT333',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-007'
      });

      // Mock verification to throw unexpected error
      stellarService.verifyTransaction = async () => {
        throw new Error('Unexpected system error');
      };

      // Execute reconciliation
      await reconciliationService.reconcile();

      // Verify: In-progress flag is reset even after error
      expect(reconciliationService.reconciliationInProgress).toBe(false);
    });

    test('should handle empty transaction list gracefully', async () => {
      // Ensure no transactions exist
      Transaction._clearAllData();

      // Execute reconciliation
      await reconciliationService.reconcile();

      // Verify: No errors thrown
      expect(reconciliationService.reconciliationInProgress).toBe(false);
    });
  });

  describe('Scenario 4: Transaction Without Stellar ID', () => {
    test('should skip transactions without stellarTxId', async () => {
      const tx = Transaction.create({
        id: 'tx-recon-008',
        amount: 100,
        donor: 'GDONOR444',
        recipient: 'GRECIPIENT444',
        status: TRANSACTION_STATES.PENDING
        // No stellarTxId
      });

      // Execute reconciliation
      const result = await reconciliationService.reconcileTransaction(tx);

      // Verify: Returns false (skipped)
      expect(result).toBe(false);

      // Verify: Transaction unchanged
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(TRANSACTION_STATES.PENDING);
    });
  });

  describe('Scenario 5: State Transition Validation During Reconciliation', () => {
    test('should handle invalid state transition during reconciliation', async () => {
      // Create transaction in failed state
      const tx = Transaction.create({
        id: 'tx-recon-009',
        amount: 100,
        donor: 'GDONOR555',
        recipient: 'GRECIPIENT555',
        status: TRANSACTION_STATES.FAILED,
        stellarTxId: 'stellar-tx-009'
      });

      // Mock verification to succeed (but transition failed->confirmed is invalid)
      stellarService.verifyTransaction = async () => ({
        verified: true,
        transaction: {
          hash: 'stellar-tx-009',
          ledger: 12345
        }
      });

      // Execute reconciliation
      await expect(
        reconciliationService.reconcileTransaction(tx)
      ).rejects.toThrow('Invalid transaction state transition');

      // Verify: Transaction remains in failed state
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(TRANSACTION_STATES.FAILED);
    });

    test('should not update already confirmed transactions', async () => {
      const tx = Transaction.create({
        id: 'tx-recon-010',
        amount: 100,
        donor: 'GDONOR666',
        recipient: 'GRECIPIENT666',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'stellar-tx-010',
        confirmedAt: '2024-01-01T00:00:00.000Z'
      });

      const originalConfirmedAt = tx.confirmedAt;

      // Mock verification to succeed
      stellarService.verifyTransaction = async () => ({
        verified: true,
        transaction: {
          hash: 'stellar-tx-010',
          ledger: 12345
        }
      });

      // Execute reconciliation
      const result = await reconciliationService.reconcileTransaction(tx);

      // Verify: Returns false (no update needed)
      expect(result).toBe(false);

      // Verify: Transaction unchanged
      const unchangedTx = Transaction.getById(tx.id);
      expect(unchangedTx.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(unchangedTx.confirmedAt).toBe(originalConfirmedAt);
    });
  });

  describe('Scenario 6: Concurrent Reconciliation Attempts', () => {
    test('should prevent concurrent reconciliation runs', async () => {
      // Create some pending transactions
      Transaction.create({
        id: 'tx-recon-011',
        amount: 100,
        donor: 'GDONOR777',
        recipient: 'GRECIPIENT777',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-011'
      });

      // Start first reconciliation (don't await)
      const promise1 = reconciliationService.reconcile();

      // Immediately try second reconciliation
      const promise2 = reconciliationService.reconcile();

      // Wait for both
      await Promise.all([promise1, promise2]);

      // Verify: Second call was skipped (no error)
      expect(reconciliationService.reconciliationInProgress).toBe(false);
    });
  });

  describe('Scenario 7: Reconciliation with Mixed States', () => {
    test('should handle reconciliation of transactions in different states', async () => {
      // Create transactions in various states
      const txPending = Transaction.create({
        id: 'tx-recon-012',
        amount: 100,
        donor: 'GDONOR888',
        recipient: 'GRECIPIENT888',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-012'
      });

      const txSubmitted = Transaction.create({
        id: 'tx-recon-013',
        amount: 200,
        donor: 'GDONOR999',
        recipient: 'GRECIPIENT999',
        status: TRANSACTION_STATES.SUBMITTED,
        stellarTxId: 'stellar-tx-013'
      });

      const txConfirmed = Transaction.create({
        id: 'tx-recon-014',
        amount: 300,
        donor: 'GDONOR000',
        recipient: 'GRECIPIENT000',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'stellar-tx-014'
      });

      // Mock verification to succeed for all
      stellarService.verifyTransaction = async () => ({
        verified: true,
        transaction: {
          hash: 'stellar-tx-xxx',
          ledger: 12345
        }
      });

      // Execute reconciliation
      await reconciliationService.reconcile();

      // Verify: Pending and submitted updated, confirmed unchanged
      const finalPending = Transaction.getById('tx-recon-012');
      const finalSubmitted = Transaction.getById('tx-recon-013');
      const finalConfirmed = Transaction.getById('tx-recon-014');

      expect(finalPending.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(finalSubmitted.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(finalConfirmed.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });
  });

  describe('Scenario 8: Error Recovery', () => {
    test('should continue reconciliation after individual transaction error', async () => {
      // Create multiple transactions
      const tx1 = Transaction.create({
        id: 'tx-recon-015',
        amount: 100,
        donor: 'GDONOR1111',
        recipient: 'GRECIPIENT1111',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-015'
      });

      const tx2 = Transaction.create({
        id: 'tx-recon-016',
        amount: 200,
        donor: 'GDONOR2222',
        recipient: 'GRECIPIENT2222',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar-tx-016'
      });

      // Mock verification to fail for first, succeed for second
      let callCount = 0;
      stellarService.verifyTransaction = async (hash) => {
        callCount++;
        if (hash === 'stellar-tx-015') {
          throw new Error('Verification failed for tx-015');
        }
        return {
          verified: true,
          transaction: {
            hash,
            ledger: 12345
          }
        };
      };

      // Execute reconciliation
      await reconciliationService.reconcile();

      // Verify: Second transaction was still processed despite first failing
      const finalTx1 = Transaction.getById('tx-recon-015');
      const finalTx2 = Transaction.getById('tx-recon-016');

      expect(finalTx1.status).toBe(TRANSACTION_STATES.PENDING); // Failed to reconcile
      expect(finalTx2.status).toBe(TRANSACTION_STATES.CONFIRMED); // Successfully reconciled
    });
  });
});
