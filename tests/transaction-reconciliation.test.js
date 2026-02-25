const TransactionReconciliationService = require('../src/services/TransactionReconciliationService');
const Transaction = require('../src/routes/models/transaction');
const { TRANSACTION_STATES } = require('../src/utils/transactionStateMachine');

describe('TransactionReconciliationService', () => {
  let reconciliationService;
  let mockStellarService;

  beforeEach(() => {
    Transaction._clearAllData();

    mockStellarService = {
      verifyTransaction: jest.fn()
    };

    reconciliationService = new TransactionReconciliationService(mockStellarService);
  });

  afterEach(() => {
    reconciliationService.stop();
    jest.clearAllMocks();
  });

  describe('Service Lifecycle', () => {
    test('should start and stop service', () => {
      expect(reconciliationService.isRunning).toBe(false);

      reconciliationService.start();
      expect(reconciliationService.isRunning).toBe(true);

      reconciliationService.stop();
      expect(reconciliationService.isRunning).toBe(false);
    });

    test('should not start if already running', () => {
      reconciliationService.start();
      const firstIntervalId = reconciliationService.intervalId;

      reconciliationService.start();
      expect(reconciliationService.intervalId).toBe(firstIntervalId);
    });

    test('should return status', () => {
      const status = reconciliationService.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('checkIntervalMinutes');
      expect(status).toHaveProperty('reconciliationInProgress');
    });
  });

  describe('Transaction Reconciliation', () => {
    test('should reconcile pending transaction to confirmed', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar_tx_123'
      });

      mockStellarService.verifyTransaction.mockResolvedValue({
        verified: true,
        transaction: {
          hash: 'stellar_tx_123',
          ledger: 12345
        }
      });

      await reconciliationService.reconcileTransaction(tx);

      const updated = Transaction.getById(tx.id);
      expect(updated.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(updated.stellarLedger).toBe(12345);
      expect(mockStellarService.verifyTransaction).toHaveBeenCalledWith('stellar_tx_123');
    });

    test('should reconcile submitted transaction to confirmed', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.SUBMITTED,
        stellarTxId: 'stellar_tx_456'
      });

      mockStellarService.verifyTransaction.mockResolvedValue({
        verified: true,
        transaction: {
          hash: 'stellar_tx_456',
          ledger: 67890
        }
      });

      await reconciliationService.reconcileTransaction(tx);

      const updated = Transaction.getById(tx.id);
      expect(updated.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(updated.stellarLedger).toBe(67890);
    });

    test('should skip transaction without stellarTxId', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING
      });

      const result = await reconciliationService.reconcileTransaction(tx);

      expect(result).toBe(false);
      expect(mockStellarService.verifyTransaction).not.toHaveBeenCalled();
    });

    test('should handle transaction not found on network', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'nonexistent_tx'
      });

      const notFoundError = new Error('Transaction not found');
      notFoundError.status = 404;
      mockStellarService.verifyTransaction.mockRejectedValue(notFoundError);

      const result = await reconciliationService.reconcileTransaction(tx);

      expect(result).toBe(false);
      const unchanged = Transaction.getById(tx.id);
      expect(unchanged.status).toBe(TRANSACTION_STATES.PENDING);
    });

    test('should not update already confirmed transaction', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'stellar_tx_789'
      });

      mockStellarService.verifyTransaction.mockResolvedValue({
        verified: true,
        transaction: {
          hash: 'stellar_tx_789',
          ledger: 11111
        }
      });

      const result = await reconciliationService.reconcileTransaction(tx);

      expect(result).toBe(false);
    });

    test('should throw error for network failures', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'stellar_tx_error'
      });

      const networkError = new Error('Network timeout');
      networkError.status = 503;
      mockStellarService.verifyTransaction.mockRejectedValue(networkError);

      await expect(reconciliationService.reconcileTransaction(tx)).rejects.toThrow('Network timeout');
    });
  });

  describe('Batch Reconciliation', () => {
    test('should reconcile multiple pending transactions', async () => {
      const tx1 = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx1'
      });

      const tx2 = Transaction.create({
        donor: 'donor2',
        recipient: 'recipient2',
        amount: 20,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx2'
      });

      mockStellarService.verifyTransaction.mockResolvedValue({
        verified: true,
        transaction: { ledger: 12345 }
      });

      await reconciliationService.reconcile();

      const updated1 = Transaction.getById(tx1.id);
      const updated2 = Transaction.getById(tx2.id);

      expect(updated1.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(updated2.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(mockStellarService.verifyTransaction).toHaveBeenCalledTimes(2);
    });

    test('should reconcile both pending and submitted transactions', async () => {
      Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'pending_tx'
      });

      Transaction.create({
        donor: 'donor2',
        recipient: 'recipient2',
        amount: 20,
        status: TRANSACTION_STATES.SUBMITTED,
        stellarTxId: 'submitted_tx'
      });

      mockStellarService.verifyTransaction.mockResolvedValue({
        verified: true,
        transaction: { ledger: 12345 }
      });

      await reconciliationService.reconcile();

      expect(mockStellarService.verifyTransaction).toHaveBeenCalledTimes(2);
    });

    test('should handle empty transaction list', async () => {
      await reconciliationService.reconcile();
      expect(mockStellarService.verifyTransaction).not.toHaveBeenCalled();
    });

    test('should handle partial failures gracefully', async () => {
      const tx1 = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx_success'
      });

      const tx2 = Transaction.create({
        donor: 'donor2',
        recipient: 'recipient2',
        amount: 20,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx_fail'
      });

      mockStellarService.verifyTransaction.mockImplementation((txId) => {
        if (txId === 'tx_success') {
          return Promise.resolve({
            verified: true,
            transaction: { ledger: 12345 }
          });
        }
        return Promise.reject(new Error('Network error'));
      });

      await reconciliationService.reconcile();

      const updated1 = Transaction.getById(tx1.id);
      const updated2 = Transaction.getById(tx2.id);

      expect(updated1.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(updated2.status).toBe(TRANSACTION_STATES.PENDING);
    });
  });

  describe('Idempotency and Safety', () => {
    test('should prevent concurrent reconciliation runs', async () => {
      Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx1'
      });

      mockStellarService.verifyTransaction.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ verified: true, transaction: { ledger: 1 } }), 100))
      );

      const promise1 = reconciliationService.reconcile();
      const promise2 = reconciliationService.reconcile();

      await Promise.all([promise1, promise2]);

      expect(mockStellarService.verifyTransaction).toHaveBeenCalledTimes(1);
    });

    test('should be safe to run multiple times', async () => {
      const tx = Transaction.create({
        donor: 'donor1',
        recipient: 'recipient1',
        amount: 10,
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx1'
      });

      mockStellarService.verifyTransaction.mockResolvedValue({
        verified: true,
        transaction: { ledger: 12345 }
      });

      await reconciliationService.reconcile();
      await reconciliationService.reconcile();
      await reconciliationService.reconcile();

      const updated = Transaction.getById(tx.id);
      expect(updated.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(mockStellarService.verifyTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
