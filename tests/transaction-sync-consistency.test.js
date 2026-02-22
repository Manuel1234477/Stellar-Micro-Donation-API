const TransactionSyncService = require('../src/services/TransactionSyncService');
const Transaction = require('../src/routes/models/transaction');

jest.mock('../src/routes/models/transaction');

describe('Transaction Sync Consistency Checks', () => {
  let syncService;
  let mockServer;

  beforeEach(() => {
    mockServer = {
      transactions: jest.fn().mockReturnThis(),
      forAccount: jest.fn().mockReturnThis(),
      transaction: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      call: jest.fn()
    };

    syncService = new TransactionSyncService();
    syncService.server = mockServer;
    jest.clearAllMocks();
  });

  test('should detect missing local transactions', async () => {
    const publicKey = 'GTEST123';
    const horizonTxs = [
      { id: 'tx1', ledger_attr: 12345, created_at: '2024-02-20T10:00:00Z', successful: true, source_account: publicKey },
      { id: 'tx2', ledger_attr: 12346, created_at: '2024-02-20T11:00:00Z', successful: true, source_account: publicKey }
    ];

    Transaction.loadTransactions = jest.fn().mockReturnValue([
      { id: '1', stellarTxId: 'tx1', donor: publicKey, status: 'confirmed' }
    ]);

    const report = await syncService.performConsistencyCheck(publicKey, horizonTxs);

    expect(report.isConsistent).toBe(false);
    expect(report.inconsistencies).toHaveLength(1);
    expect(report.inconsistencies[0].type).toBe('MISSING_LOCAL');
  });

  test('should detect orphaned local transactions', async () => {
    const publicKey = 'GTEST123';
    const horizonTxs = [
      { id: 'tx1', ledger_attr: 12345, created_at: '2024-02-20T10:00:00Z', successful: true, source_account: publicKey }
    ];

    Transaction.loadTransactions = jest.fn().mockReturnValue([
      { id: '1', stellarTxId: 'tx1', donor: publicKey, status: 'confirmed' },
      { id: '2', stellarTxId: 'tx2', donor: publicKey, status: 'confirmed' }
    ]);

    const report = await syncService.performConsistencyCheck(publicKey, horizonTxs);

    expect(report.isConsistent).toBe(false);
    const orphaned = report.inconsistencies.filter(i => i.type === 'ORPHANED_LOCAL');
    expect(orphaned).toHaveLength(1);
  });

  test('should detect status mismatches', async () => {
    const publicKey = 'GTEST123';
    const horizonTxs = [
      { id: 'tx1', ledger_attr: 12345, created_at: '2024-02-20T10:00:00Z', successful: true, source_account: publicKey }
    ];

    Transaction.loadTransactions = jest.fn().mockReturnValue([
      { id: '1', stellarTxId: 'tx1', donor: publicKey, status: 'pending' }
    ]);

    const report = await syncService.performConsistencyCheck(publicKey, horizonTxs);

    expect(report.isConsistent).toBe(false);
    const statusMismatch = report.inconsistencies.filter(i => i.type === 'STATUS_MISMATCH');
    expect(statusMismatch).toHaveLength(1);
  });

  test('should reconcile inconsistencies', async () => {
    const inconsistencies = [
      { type: 'STATUS_MISMATCH', data: { localId: '1', stellarTxId: 'tx1', localStatus: 'pending', onChainStatus: 'confirmed' } }
    ];

    Transaction.updateStatus = jest.fn();

    const results = await syncService.reconcileInconsistencies(inconsistencies);

    expect(results.resolved).toHaveLength(1);
    expect(Transaction.updateStatus).toHaveBeenCalled();
  });

  test('should perform full sync with consistency check', async () => {
    const publicKey = 'GTEST123';
    
    mockServer.call.mockResolvedValue({
      records: [
        { id: 'tx1', ledger_attr: 12345, created_at: '2024-02-20T10:00:00Z', successful: true, source_account: publicKey }
      ]
    });

    Transaction.loadTransactions = jest.fn().mockReturnValue([]);
    Transaction.getByStellarTxId = jest.fn().mockReturnValue(null);
    Transaction.create = jest.fn().mockReturnValue({ id: '1', stellarTxId: 'tx1' });

    const result = await syncService.syncWalletTransactions(publicKey, {
      performConsistencyCheck: true,
      autoReconcile: false
    });

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('consistencyReport');
  });
});
