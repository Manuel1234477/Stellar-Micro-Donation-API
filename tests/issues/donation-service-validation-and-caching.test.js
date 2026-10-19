/**
 * Tests for Issues #1311, #1312, #1313, #1314
 * 
 * #1311 - sendCustodialDonation() doesn't reject self-donation
 * #1312 - checkRecipientAccountExists() caching issues
 * #1313 - processBatch() all-or-nothing failure
 * #1314 - processBatch() silent skip of campaign/matching processing
 */

const DonationService = require('../../src/services/DonationService');
const WalletService = require('../../src/services/WalletService');
const Database = require('../../src/utils/database');
const Cache = require('../../src/utils/cache');
const { ValidationError, BusinessLogicError } = require('../../src/utils/errors');

// Mock dependencies
jest.mock('../../src/utils/database');
jest.mock('../../src/utils/cache');
jest.mock('../../src/services/StellarService');
jest.mock('../../src/services/PriceOracleService');

describe('Issues #1311-1314: Donation Service Improvements', () => {
  let donationService;
  let walletService;
  let mockStellarService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock Stellar service
    mockStellarService = {
      getAccountInfo: jest.fn(),
      sendDonation: jest.fn(),
      sendBatchDonations: jest.fn(),
      fundWithFriendbot: jest.fn(),
      getBalance: jest.fn()
    };

    donationService = new DonationService(mockStellarService);
    walletService = new WalletService(mockStellarService);
    
    // Reset Cache before each test
    Cache.get.mockReturnValue(null);
    Cache.set.mockImplementation(() => {});
    Cache.delete.mockImplementation(() => {});
  });

  describe('#1311: sendCustodialDonation() self-donation validation', () => {
    test('should reject self-donation in sendCustodialDonation()', async () => {
      // Mock users with same public key
      const samePublicKey = 'GABC123';
      
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE id = ?')) {
          return Promise.resolve({ 
            id: params[0], 
            publicKey: samePublicKey,
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      Database.runTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          run: jest.fn().mockResolvedValue({ id: 999 })
        };
        return callback(mockTx);
      });

      // Mock other dependencies
      const mockLimitService = {
        checkLimits: jest.fn().mockResolvedValue(),
        getRemainingLimits: jest.fn().mockResolvedValue({ dailyRemaining: 1000, monthlyRemaining: 10000 })
      };
      
      const mockDonationVelocityService = {
        checkVelocityLimits: jest.fn().mockResolvedValue(),
        recordDonation: jest.fn().mockResolvedValue()
      };

      // Replace with mocks
      require('../../src/services/DonationService').LimitService = mockLimitService;
      require('../../src/services/DonationService').DonationVelocityService = mockDonationVelocityService;

      // Mock Stellar service to simulate successful transaction
      mockStellarService.sendDonation.mockResolvedValue({
        hash: 'tx123',
        transactionId: 'tx123',
        ledger: 12345
      });

      mockStellarService.getBalance.mockResolvedValue({
        balance: '1000'
      });

      // Expect ValidationError for self-donation
      await expect(
        donationService.sendCustodialDonation({
          senderId: 1,
          receiverId: 2, // Different IDs but same public key
          amount: 10,
          memo: 'test',
          idempotencyKey: 'test-key',
          requestId: 'test-request'
        })
      ).rejects.toThrow('Sender and recipient cannot be the same wallet');
    });

    test('should accept valid donation with different sender/receiver', async () => {
      // Mock users with different public keys
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE id = ?')) {
          const isSender = params[0] === 1;
          return Promise.resolve({ 
            id: params[0], 
            publicKey: isSender ? 'GABC123' : 'GDEF456', // Different public keys
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      Database.runTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          run: jest.fn().mockResolvedValue({ id: 999 })
        };
        return callback(mockTx);
      });

      // Mock other dependencies
      const mockLimitService = {
        checkLimits: jest.fn().mockResolvedValue(),
        getRemainingLimits: jest.fn().mockResolvedValue({ dailyRemaining: 1000, monthlyRemaining: 10000 })
      };
      
      const mockDonationVelocityService = {
        checkVelocityLimits: jest.fn().mockResolvedValue(),
        recordDonation: jest.fn().mockResolvedValue()
      };

      // Replace with mocks
      require('../../src/services/DonationService').LimitService = mockLimitService;
      require('../../src/services/DonationService').DonationVelocityService = mockDonationVelocityService;

      // Mock Stellar service to simulate successful transaction
      mockStellarService.sendDonation.mockResolvedValue({
        hash: 'tx123',
        transactionId: 'tx123',
        ledger: 12345
      });

      mockStellarService.getBalance.mockResolvedValue({
        balance: '1000'
      });

      const result = await donationService.sendCustodialDonation({
        senderId: 1,
        receiverId: 2,
        amount: 10,
        memo: 'test',
        idempotencyKey: 'test-key',
        requestId: 'test-request'
      });

      expect(result.success).toBeUndefined(); // Not batch, so no success field
      expect(result.id).toBe(999);
      expect(result.stellarTxId).toBe('tx123');
    });
  });

  describe('#1312: checkRecipientAccountExists() caching improvements', () => {
    test('should use positive cache TTL for existing accounts', async () => {
      const publicKey = 'GEXIST123';
      
      // Mock account exists
      mockStellarService.getAccountInfo.mockResolvedValue({
        notFound: false,
        error: null
      });

      // First call - should cache
      await donationService.checkRecipientAccountExists(publicKey);
      
      expect(Cache.set).toHaveBeenCalledWith(
        `recipient_account:${publicKey}`,
        true,
        5 * 60 * 1000 // 5 minutes positive TTL
      );
    });

    test('should use negative cache TTL for non-existing accounts', async () => {
      const publicKey = 'GNONEXIST123';
      
      // Mock account doesn't exist
      mockStellarService.getAccountInfo.mockResolvedValue({
        notFound: true,
        error: null
      });

      // Should throw and cache negative result
      await expect(
        donationService.checkRecipientAccountExists(publicKey)
      ).rejects.toThrow(BusinessLogicError);
      
      expect(Cache.set).toHaveBeenCalledWith(
        `recipient_account:${publicKey}`,
        false,
        30 * 1000 // 30 seconds negative TTL
      );
    });

    test('should invalidate cache when called', () => {
      const publicKey = 'GTEST123';
      
      DonationService.invalidateRecipientAccountCache(publicKey);
      
      expect(Cache.delete).toHaveBeenCalledWith(
        `recipient_account:${publicKey}`
      );
    });

    test('should use cached result for existing accounts', async () => {
      const publicKey = 'GCACHED123';
      
      // Mock cache hit for existing account
      Cache.get.mockReturnValue(true);
      
      // Should not call Stellar service
      await donationService.checkRecipientAccountExists(publicKey);
      
      expect(mockStellarService.getAccountInfo).not.toHaveBeenCalled();
    });

    test('should use cached result for non-existing accounts and throw', async () => {
      const publicKey = 'GCACHEDNEG123';
      
      // Mock cache hit for non-existing account
      Cache.get.mockReturnValue(false);
      
      // Should throw without calling Stellar service
      await expect(
        donationService.checkRecipientAccountExists(publicKey)
      ).rejects.toThrow(BusinessLogicError);
      
      expect(mockStellarService.getAccountInfo).not.toHaveBeenCalled();
    });
  });

  describe('#1313: processBatch() fallback logic', () => {
    test('should fall back to individual donations when batch fails', async () => {
      const donations = [
        { donor: 'GDONOR1', recipient: 'GRECIPIENT1', amount: 10, memo: 'test1', idempotencyKey: 'key1' },
        { donor: 'GDONOR1', recipient: 'GRECIPIENT2', amount: 20, memo: 'test2', idempotencyKey: 'key2' }
      ];

      // Mock database queries
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ 
            id: 1, 
            publicKey: params[0],
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      // Mock batch transaction failure
      mockStellarService.sendBatchDonations.mockRejectedValue(
        new Error('Batch transaction failed')
      );

      // Mock successful individual transactions
      mockStellarService.sendDonation.mockResolvedValue({
        hash: 'tx-individual',
        transactionId: 'tx-individual',
        ledger: 12345
      });

      // Mock price oracle
      const mockPriceOracle = {
        convertToXLM: jest.fn().mockImplementation((amount) => Promise.resolve(amount))
      };
      require('../../src/services/PriceOracleService').default = mockPriceOracle;

      const results = await donationService.processBatch(donations);

      // Verify batch was attempted
      expect(mockStellarService.sendBatchDonations).toHaveBeenCalled();
      
      // Verify individual fallback was attempted for both donations
      expect(mockStellarService.sendDonation).toHaveBeenCalledTimes(2);
      
      // Both should succeed with fallback
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[0].error).toBeUndefined();
      expect(results[1].error).toBeUndefined();
    });

    test('should handle mixed success/failure in fallback mode', async () => {
      const donations = [
        { donor: 'GDONOR1', recipient: 'GRECIPIENT1', amount: 10, memo: 'test1', idempotencyKey: 'key1' },
        { donor: 'GDONOR1', recipient: 'GRECIPIENT2', amount: 20, memo: 'test2', idempotencyKey: 'key2' }
      ];

      // Mock database queries
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ 
            id: 1, 
            publicKey: params[0],
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      // Mock batch transaction failure
      mockStellarService.sendBatchDonations.mockRejectedValue(
        new Error('Batch transaction failed')
      );

      // Mock mixed individual transaction results
      mockStellarService.sendDonation
        .mockResolvedValueOnce({
          hash: 'tx-success',
          transactionId: 'tx-success',
          ledger: 12345
        })
        .mockRejectedValueOnce(new Error('Individual transaction failed'));

      // Mock price oracle
      const mockPriceOracle = {
        convertToXLM: jest.fn().mockImplementation((amount) => Promise.resolve(amount))
      };
      require('../../src/services/PriceOracleService').default = mockPriceOracle;

      const results = await donationService.processBatch(donations);

      // Verify mixed results
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBeDefined();
      expect(results[1].error.fallback).toBe(true); // Should indicate fallback attempt
    });

    test('should succeed with batch transaction when possible', async () => {
      const donations = [
        { donor: 'GDONOR1', recipient: 'GRECIPIENT1', amount: 10, memo: 'test1', idempotencyKey: 'key1' },
        { donor: 'GDONOR1', recipient: 'GRECIPIENT2', amount: 20, memo: 'test2', idempotencyKey: 'key2' }
      ];

      // Mock database queries
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ 
            id: 1, 
            publicKey: params[0],
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      // Mock successful batch transaction
      mockStellarService.sendBatchDonations.mockResolvedValue({
        hash: 'tx-batch',
        transactionId: 'tx-batch',
        ledger: 12345
      });

      // Mock price oracle
      const mockPriceOracle = {
        convertToXLM: jest.fn().mockImplementation((amount) => Promise.resolve(amount))
      };
      require('../../src/services/PriceOracleService').default = mockPriceOracle;

      const results = await donationService.processBatch(donations);

      // Verify batch was used
      expect(mockStellarService.sendBatchDonations).toHaveBeenCalled();
      
      // Individual transactions should not be called
      expect(mockStellarService.sendDonation).not.toHaveBeenCalled();
      
      // Both should succeed
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe('#1314: processBatch() campaign/matching processing', () => {
    test('should process campaign contributions for batch donations', async () => {
      const donations = [
        { 
          donor: 'GDONOR1', 
          recipient: 'GRECIPIENT1', 
          amount: 10, 
          memo: 'test1', 
          idempotencyKey: 'key1',
          campaign_id: 123
        }
      ];

      // Mock dependencies
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ 
            id: 1, 
            publicKey: params[0],
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      Database.run.mockResolvedValue({ changes: 1 });

      // Mock successful batch transaction
      mockStellarService.sendBatchDonations.mockResolvedValue({
        hash: 'tx-batch',
        transactionId: 'tx-batch',
        ledger: 12345
      });

      // Mock price oracle
      const mockPriceOracle = {
        convertToXLM: jest.fn().mockImplementation((amount) => Promise.resolve(amount))
      };
      require('../../src/services/PriceOracleService').default = mockPriceOracle;

      // Mock campaign processing services
      const mockMatchingProgramService = {
        processMatchingDonation: jest.fn().mockResolvedValue([])
      };
      const mockCorporateMatchingService = {
        processCorporateMatching: jest.fn().mockResolvedValue([])
      };

      // Replace with mocks
      require('../../src/services/DonationService').MatchingProgramService = mockMatchingProgramService;
      require('../../src/services/DonationService').CorporateMatchingService = mockCorporateMatchingService;

      const results = await donationService.processBatch(donations);

      // Verify batch was processed successfully
      expect(results[0].success).toBe(true);
      
      // Campaign processing should be called
      expect(Database.run).toHaveBeenCalled(); // Campaign update query
      
      // Matching program processing should be attempted
      expect(mockMatchingProgramService.processMatchingDonation).toHaveBeenCalledWith({
        id: expect.any(String),
        amount: 10,
        campaign_id: 123
      });
    });

    test('should handle donation matching programs for batch donations', async () => {
      const donations = [
        { 
          donor: 'GDONOR1', 
          recipient: 'GRECIPIENT1', 
          amount: 10, 
          memo: 'test1', 
          idempotencyKey: 'key1',
          campaign_id: 123
        }
      ];

      // Mock dependencies
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ 
            id: 1, 
            publicKey: params[0],
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        if (query.includes('SELECT id FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ id: 1 });
        }
        return Promise.resolve(null);
      });

      Database.run.mockResolvedValue({ changes: 1 });

      // Mock successful batch transaction
      mockStellarService.sendBatchDonations.mockResolvedValue({
        hash: 'tx-batch',
        transactionId: 'tx-batch',
        ledger: 12345
      });

      // Mock price oracle
      const mockPriceOracle = {
        convertToXLM: jest.fn().mockImplementation((amount) => Promise.resolve(amount))
      };
      require('../../src/services/PriceOracleService').default = mockPriceOracle;

      // Mock matching results
      const mockMatchingDonations = [
        { id: 'match1', amount: 5, program: 'test-program' }
      ];
      const mockCorporateMatchingResults = [
        { id: 'corp1', amount: 3, company: 'test-corp' }
      ];

      const mockMatchingProgramService = {
        processMatchingDonation: jest.fn().mockResolvedValue(mockMatchingDonations)
      };
      const mockCorporateMatchingService = {
        processCorporateMatching: jest.fn().mockResolvedValue(mockCorporateMatchingResults)
      };

      // Replace with mocks
      require('../../src/services/DonationService').MatchingProgramService = mockMatchingProgramService;
      require('../../src/services/DonationService').CorporateMatchingService = mockCorporateMatchingService;

      const results = await donationService.processBatch(donations);

      // Verify batch was processed successfully
      expect(results[0].success).toBe(true);
      expect(results[0].data).toBeDefined();
      
      // Matching program processing should be called
      expect(mockMatchingProgramService.processMatchingDonation).toHaveBeenCalled();
      expect(mockCorporateMatchingService.processCorporateMatching).toHaveBeenCalled();
    });
  });

  describe('Integration: All issues together', () => {
    test('comprehensive test covering all four issues', async () => {
      // Setup test data covering all scenarios
      const testData = {
        // Issue #1311: Different sender/receiver
        senderId: 1,
        receiverId: 2,
        amount: 10,
        
        // Issue #1312: Caching
        publicKey: 'GTESTINT123',
        
        // Issue #1313: Batch donations  
        batchDonations: [
          { donor: 'GDONOR1', recipient: 'GRECIPIENT1', amount: 10, memo: 'test1', idempotencyKey: 'key1', campaign_id: 123 },
          { donor: 'GDONOR1', recipient: 'GRECIPIENT2', amount: 20, memo: 'test2', idempotencyKey: 'key2', campaign_id: 123 }
        ]
      };

      // Test Issue #1311
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE id = ?')) {
          const isSender = params[0] === testData.senderId;
          return Promise.resolve({ 
            id: params[0], 
            publicKey: isSender ? 'GSENDER123' : 'GRECEIVER456', // Different keys
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      // Should not throw for self-donation (different public keys)
      await expect(
        donationService.sendCustodialDonation({
          senderId: testData.senderId,
          receiverId: testData.receiverId,
          amount: testData.amount,
          memo: 'test',
          idempotencyKey: 'test-key',
          requestId: 'test-request'
        })
      ).resolves.not.toThrow('Sender and recipient cannot be the same wallet');

      // Test Issue #1312
      Cache.get.mockReturnValue(null);
      mockStellarService.getAccountInfo.mockResolvedValue({
        notFound: false,
        error: null
      });

      await donationService.checkRecipientAccountExists(testData.publicKey);
      expect(Cache.set).toHaveBeenCalledWith(
        `recipient_account:${testData.publicKey}`,
        true,
        5 * 60 * 1000
      );

      // Test cache invalidation
      DonationService.invalidateRecipientAccountCache(testData.publicKey);
      expect(Cache.delete).toHaveBeenCalledWith(
        `recipient_account:${testData.publicKey}`
      );

      // Test Issues #1313 and #1314 with batch processing
      Database.get.mockImplementation((query, params) => {
        if (query.includes('SELECT * FROM users WHERE publicKey = ?')) {
          return Promise.resolve({ 
            id: 1, 
            publicKey: params[0],
            encryptedSecret: 'encrypted-secret-123'
          });
        }
        return Promise.resolve(null);
      });

      Database.run.mockResolvedValue({ changes: 1 });

      // Mock batch failure with fallback
      mockStellarService.sendBatchDonations.mockRejectedValue(new Error('Batch failed'));
      mockStellarService.sendDonation.mockResolvedValue({
        hash: 'tx-individual',
        transactionId: 'tx-individual',
        ledger: 12345
      });

      // Mock price oracle
      const mockPriceOracle = {
        convertToXLM: jest.fn().mockImplementation((amount) => Promise.resolve(amount))
      };
      require('../../src/services/PriceOracleService').default = mockPriceOracle;

      // Mock matching services
      const mockMatchingProgramService = {
        processMatchingDonation: jest.fn().mockResolvedValue([])
      };
      const mockCorporateMatchingService = {
        processCorporateMatching: jest.fn().mockResolvedValue([])
      };

      require('../../src/services/DonationService').MatchingProgramService = mockMatchingProgramService;
      require('../../src/services/DonationService').CorporateMatchingService = mockCorporateMatchingService;

      const results = await donationService.processBatch(testData.batchDonations);

      // Verify fallback was used (Issue #1313)
      expect(mockStellarService.sendDonation).toHaveBeenCalledTimes(2);
      
      // Verify campaign/matching processing was attempted (Issue #1314)
      expect(Database.run).toHaveBeenCalled(); // Campaign update
      expect(mockMatchingProgramService.processMatchingDonation).toHaveBeenCalled();
      
      // Verify all donations succeeded
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });
});