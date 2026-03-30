const StellarSdk = require('stellar-sdk');
const TransactionSyncService = require('../../src/services/TransactionSyncService');
const Wallet = require('../../src/routes/models/wallet');
const Transaction = require('../../src/routes/models/transaction');
const log = require('../../src/utils/log');

jest.mock('../src/routes/models/wallet');
jest.mock('../src/routes/models/transaction');
jest.mock('../src/utils/log');

const mockServer = {
  transactions: jest.fn().mockReturnThis(),
  forAccount: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  cursor: jest.fn().mockReturnThis(),
  call: jest.fn()
};

jest.mock('stellar-sdk', () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockServer)
    }
  };
});

describe('TransactionSyncService - Horizon API Pagination', () => {
  let syncService;

  const createMockResponse = (records, hasNext = false) => {
    return {
      records,
      next: jest.fn().mockResolvedValue(hasNext ? createMockResponse([]) : { records: [] })
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    syncService = new TransactionSyncService('TESTNET');

    // Default mocks
    Wallet.getByAddress = jest.fn().mockReturnValue({
      id: "wallet123",
      address: "G12345",
      last_synced_cursor: "cursor-10"
    });
    
    Wallet.update = jest.fn().mockReturnValue({});
    Transaction.getByField = jest.fn().mockReturnValue(null); // No existing txs
    Transaction.create = jest.fn().mockImplementation((tx) => tx);
  });

  it('should fetch all transactions when wallets under limit (e.g. 50)', async () => {
    const mockRecords = Array.from({ length: 50 }, (_, i) => ({
      id: `tx-${i}`,
      paging_token: `token-${i}`,
      created_at: new Date().toISOString(),
      operations: [{ amount: '10' }]
    }));

    const page1 = createMockResponse(mockRecords, false);
    mockServer.call.mockResolvedValueOnce(page1);

    const result = await syncService.syncWalletTransactions("G12345");
    
    expect(result.synced).toBe(50);
    expect(mockServer.cursor).toHaveBeenCalledWith("cursor-10");
    expect(mockServer.order).toHaveBeenCalledWith("asc");
    
    expect(Wallet.update).toHaveBeenCalledWith("wallet123", { last_synced_cursor: "token-49" });
    
    expect(log.info).toHaveBeenCalledWith('TX_SYNC', 'Synced transactions for wallet', expect.objectContaining({
      syncedCount: 50,
      fetchedCount: 50,
      walletAddress: "G12345"
    }));
  });

  it('should follow next links to handle 51 transactions', async () => {
    const page1Records = Array.from({ length: 50 }, (_, i) => ({ id: `tx-${i}`, paging_token: `p1-${i}` }));
    const page2Records = [{ id: `tx-50`, paging_token: `p2-0` }];

    const page2 = createMockResponse(page2Records, false);
    const page1 = createMockResponse(page1Records, true);
    page1.next.mockResolvedValueOnce(page2);

    mockServer.call.mockResolvedValueOnce(page1);

    const result = await syncService.syncWalletTransactions("G12345");
    
    expect(result.synced).toBe(51);
    expect(page1.next).toHaveBeenCalled();
    expect(Wallet.update).toHaveBeenCalledWith("wallet123", { last_synced_cursor: "p2-0" });
  });

  it('stops pagination at maxTransactions limit (e.g., handles 500+ properly)', async () => {
    const generateRecords = (start, count) => Array.from({ length: count }, (_, i) => ({ id: `tx-${start+i}`, paging_token: `pt-${start+i}` }));

    const page3 = createMockResponse(generateRecords(400, 150), false); 
    const page2 = createMockResponse(generateRecords(200, 200), true);
    page2.next.mockResolvedValueOnce(page3);
    const page1 = createMockResponse(generateRecords(0, 200), true);
    page1.next.mockResolvedValueOnce(page2);

    mockServer.call.mockResolvedValueOnce(page1);

    const result = await syncService.syncWalletTransactions("G12345", 500);
    
    expect(result.synced).toBe(500); 
    expect(Wallet.update).toHaveBeenCalledWith("wallet123", { last_synced_cursor: "pt-499" });
  });

  it('handles 0 transactions correctly', async () => {
    mockServer.call.mockResolvedValueOnce({ records: [] });
    const result = await syncService.syncWalletTransactions("G12345");
    expect(result.synced).toBe(0);
    expect(Wallet.update).not.toHaveBeenCalled();
  });

  it('fetches full history in descending mode (and flips) if wallet has no prev cursor', async () => {
    Wallet.getByAddress.mockReturnValueOnce(null); 
    const page1Records = [{ id: 'tx-2', paging_token: 'pt-2' }, { id: 'tx-1', paging_token: 'pt-1' }];
    
    mockServer.call.mockResolvedValueOnce(createMockResponse(page1Records, false));

    const result = await syncService.syncWalletTransactions("GNEWW", 50);
    
    expect(result.synced).toBe(2);
    expect(mockServer.order).toHaveBeenCalledWith("desc"); 
    expect(Wallet.update).not.toHaveBeenCalled(); 
  });

  it('handles 404 cleanly by returning 0 transactions', async () => {
    const error = new Error('Not found');
    error.response = { status: 404 };
    mockServer.call.mockRejectedValueOnce(error);

    const result = await syncService.syncWalletTransactions("G12345");
    expect(result.synced).toBe(0);
  });
});
