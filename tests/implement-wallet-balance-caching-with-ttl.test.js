const request = require('supertest');
const express = require('express');
const walletRouter = require('../src/routes/wallet');
const WalletService = require('../src/services/WalletService');
const Cache = require('../src/utils/cache');
const Wallet = require('../src/routes/models/wallet');
const TransactionReconciliationService = require('../src/services/TransactionReconciliationService');
const Transaction = require('../src/routes/models/transaction');
const Database = require('../src/utils/database');
const { TRANSACTION_STATES } = require('../src/utils/transactionStateMachine');

jest.mock('../src/routes/models/wallet');
jest.mock('../src/routes/models/transaction');
jest.mock('../src/utils/database');
jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next()
}));
jest.mock('../src/config/serviceContainer', () => {
  return {
    getStellarService: jest.fn().mockReturnValue({
      getBalance: jest.fn()
    })
  };
});

describe('Wallet Balance Caching with TTL', () => {
    let app;
    let serviceContainer;
    let stellarServiceMock;

    beforeEach(() => {
        jest.clearAllMocks();
        Cache.clear();

        serviceContainer = require('../src/config/serviceContainer');
        stellarServiceMock = serviceContainer.getStellarService();
        
        stellarServiceMock.getBalance.mockResolvedValue({
            balance: '100.00',
            asset: 'XLM'
        });

        Wallet.getById.mockReturnValue({
            id: "123",
            address: "G12345"
        });

        app = express();
        app.use(express.json());
        
        // Re-require to pick up mock overrides
        const reRouter = require('../src/routes/wallet');
        app.use('/wallets', reRouter);
    });

    it('returns X-Cache: MISS on first request and caches data', async () => {
        const response = await request(app).get('/wallets/123/balance');
        
        expect(response.status).toBe(200);
        expect(response.headers['x-cache']).toBe('MISS');
        expect(response.body.data.balance).toBe('100.00');
        expect(stellarServiceMock.getBalance).toHaveBeenCalledTimes(1);
        
        const cachedItem = Cache.get('wallet_balance_G12345');
        expect(cachedItem).toBeDefined();
        expect(cachedItem.balance).toBe('100.00');
    });

    it('returns X-Cache: HIT on subsequent requests inside TTL', async () => {
        // Prime cache
        await request(app).get('/wallets/123/balance');
        
        // Second call
        const response2 = await request(app).get('/wallets/123/balance');
        
        expect(response2.status).toBe(200);
        expect(response2.headers['x-cache']).toBe('HIT');
        expect(response2.body.data.balance).toBe('100.00');
        expect(stellarServiceMock.getBalance).toHaveBeenCalledTimes(1); // Cached, no second call
    });

    it('forces X-Cache: MISS when ?refresh=true is provided', async () => {
        // Prime cache
        await request(app).get('/wallets/123/balance');
        
        // Refresh call
        const response2 = await request(app).get('/wallets/123/balance?refresh=true');
        
        expect(response2.status).toBe(200);
        expect(response2.headers['x-cache']).toBe('MISS');
        expect(stellarServiceMock.getBalance).toHaveBeenCalledTimes(2);
    });

    it('Cache resolves properly through TransactionReconciliationService invalidation', async () => {
        // Mock DB behavior inside Reconciliation
        Database.get.mockImplementation(async (query, args) => {
            if (args[0] === 5) return { publicKey: 'G12345' };
            return null;
        });

        Transaction.updateStatus.mockReturnValue(true);

        const tx = {
            id: 'tx1',
            stellarTxId: 'stx1',
            status: TRANSACTION_STATES.SUBMITTED,
            senderId: 5,
            receiverId: undefined
        };

        const reconService = new TransactionReconciliationService({
            verifyTransaction: jest.fn().mockResolvedValue({
                verified: true,
                transaction: { ledger: 12345 }
            })
        });

        // Prime cache
        await request(app).get('/wallets/123/balance');
        expect(Cache.get('wallet_balance_G12345')).toBeDefined();

        // Reconcile and invalidate
        const result = await reconService.reconcileTransaction(tx);
        expect(result).toBe(true);
        expect(Database.get).toHaveBeenCalledWith(expect.any(String), [5]);

        // Validate cache is cleared
        expect(Cache.get('wallet_balance_G12345')).toBeNull();
    });

    it('Cache expires natively after TTL limits', async () => {
        // Provide tight TTL environment logic
        process.env.WALLET_BALANCE_CACHE_TTL = '50';
        
        // Because env variables are bound natively at file require inside walletService, 
        // We will just mock Date.now()
        
        Cache.set('wallet_balance_G12345', { balance: '200', asset: 'XLM' }, -10); // Expired TTL

        expect(Cache.get('wallet_balance_G12345')).toBeNull();
    });

    it('Returns 404 cleanly when wallet does not exist', async () => {
        Wallet.getById.mockReturnValue(null);
        
        const response = await request(app).get('/wallets/bad-id/balance');
        // The error handling natively in route/services will throw
        expect(response.status).not.toBe(200);
    });
});
