/**
 * Donation Routes Integration Tests (Refactored with Builders)
 * End-to-end tests for donation routes using mocked Stellar service
 * Tests do not require live Stellar network
 * 
 * This is a refactored version demonstrating the use of test data builders
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2';

const request = require('supertest');
const Transaction = require('../src/routes/models/transaction');
const { getStellarService } = require('../src/config/stellar');
const { resetMockStellarService } = require('./helpers/testIsolation');

// Import builders
const {
  WalletBuilder,
  DonationRequestBuilder,
  ApiRequestBuilder,
  TestAppBuilder
} = require('./builders');

describe('Donation Routes Integration Tests (Refactored)', () => {
  let app;
  let stellarService;
  let testDonor;
  let testRecipient;
  let apiRequest;

  beforeAll(async () => {
    // Create test app using builder
    app = TestAppBuilder.forDonationRoutes();
    stellarService = getStellarService();
    
    // Create funded wallets using builder
    ({ donor: testDonor, recipient: testRecipient } = 
      await WalletBuilder.createDonorRecipientPair(stellarService));
    
    // Create API request builder
    apiRequest = ApiRequestBuilder.forDonation(request, app);
  });

  beforeEach(() => {
    Transaction._clearAllData();
  });

  afterEach(() => {
    Transaction._clearAllData();
  });

  afterAll(() => {
    resetMockStellarService(stellarService);
  });

  describe('POST /donations - Create Donation', () => {
    describe('Successful donation flow', () => {
      test('should create donation with valid data', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor, 
          testRecipient, 
          '100', 
          'Test donation'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.verified).toBe(true);
        expect(response.body.data.transactionHash).toBeDefined();
      });

      test('should create donation without memo', async () => {
        const donationData = new DonationRequestBuilder()
          .between(testDonor, testRecipient)
          .withAmount('50')
          .build();

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      test('should create anonymous donation', async () => {
        const donationData = new DonationRequestBuilder()
          .toWallet(testRecipient)
          .withAmount('25')
          .withMemo('Anonymous donation')
          .build();

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      test('should handle decimal amounts correctly', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor,
          testRecipient,
          '123.456789'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      test('should calculate analytics fee', async () => {
        const donationData = new DonationRequestBuilder()
          .between(testDonor, testRecipient)
          .withAmount('1000')
          .build();

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(201);
        
        const transactions = Transaction.getAll();
        const tx = transactions.find(t => t.donor === testDonor.publicKey);
        expect(tx.analyticsFee).toBeDefined();
        expect(tx.analyticsFeePercentage).toBeDefined();
      });
    });

    describe('Validation failures', () => {
      test('should reject donation without amount', async () => {
        const donationData = new DonationRequestBuilder()
          .between(testDonor, testRecipient)
          .build();
        delete donationData.amount;

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
      });

      test('should reject donation without recipient', async () => {
        const donationData = new DonationRequestBuilder()
          .fromWallet(testDonor)
          .withAmount('100')
          .build();

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      });

      test('should reject negative amount', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor,
          testRecipient,
          '-100'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/positive number/i);
      });

      test('should reject zero amount', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor,
          testRecipient,
          '0'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/positive number/i);
      });

      test('should reject invalid amount format', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor,
          testRecipient,
          'not-a-number'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/positive number/i);
      });

      test('should reject donation to self', async () => {
        const donationData = new DonationRequestBuilder()
          .withDonor(testDonor.publicKey)
          .withRecipient(testDonor.publicKey)
          .withAmount('100')
          .build();

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      });

      test('should reject memo exceeding 28 bytes', async () => {
        const donationData = new DonationRequestBuilder()
          .between(testDonor, testRecipient)
          .withAmount('100')
          .withMemo('a'.repeat(29))
          .build();

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toMatch(/MEMO/i);
      });

      test('should reject malformed donor field', async () => {
        const donationData = {
          amount: '100',
          donor: { invalid: 'object' },
          recipient: testRecipient.publicKey
        };

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/malformed/i);
      });

      test('should reject malformed recipient field', async () => {
        const donationData = {
          amount: '100',
          donor: testDonor.publicKey,
          recipient: { invalid: 'object' }
        };

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/malformed/i);
      });
    });

    describe('Amount limit validation', () => {
      test('should reject amount below minimum', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor,
          testRecipient,
          '0.5'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBeDefined();
        expect(response.body.error.limits).toBeDefined();
      });

      test('should reject amount above maximum', async () => {
        const donationData = DonationRequestBuilder.complete(
          testDonor,
          testRecipient,
          '100001'
        );

        const response = await apiRequest.post('/donations', donationData);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.limits).toBeDefined();
      });
    });

    describe('Idempotency', () => {
      test('should return same response for duplicate idempotency key', async () => {
        const idempotencyKey = 'test-idem-duplicate-001';
        const donationData = DonationRequestBuilder.minimal(testDonor, testRecipient);

        // First request
        const response1 = await ApiRequestBuilder
          .create(request, app)
          .withIdempotencyKey(idempotencyKey)
          .post('/donations', donationData);

        expect(response1.status).toBe(201);

        // Second request with same idempotency key
        const response2 = await ApiRequestBuilder
          .create(request, app)
          .withIdempotencyKey(idempotencyKey)
          .post('/donations', donationData);

        expect(response2.status).toBe(200);
        expect(response2.body).toEqual(response1.body);
      });

      test('should reject request without idempotency key', async () => {
        const donationData = DonationRequestBuilder.minimal(testDonor, testRecipient);

        const response = await ApiRequestBuilder
          .create(request, app)
          .withApiKey('test-key-1')
          .post('/donations', donationData);

        expect(response.status).toBe(400);
      });
    });

    describe('Authentication', () => {
      test('should reject request without API key', async () => {
        const donationData = DonationRequestBuilder.minimal(testDonor, testRecipient);

        const response = await request(app)
          .post('/donations')
          .set('X-Idempotency-Key', 'test-idem-017')
          .send(donationData);

        expect(response.status).toBe(401);
      });

      test('should reject request with invalid API key', async () => {
        const donationData = DonationRequestBuilder.minimal(testDonor, testRecipient);

        const response = await ApiRequestBuilder
          .create(request, app)
          .withApiKey('invalid-key')
          .withAutoIdempotency()
          .post('/donations', donationData);

        expect(response.status).toBe(401);
      });
    });
  });

  describe('GET /donations - List All Donations', () => {
    beforeEach(async () => {
      // Create test donations using builders
      await apiRequest.post('/donations', 
        DonationRequestBuilder.complete(testDonor, testRecipient, '100'));
      await apiRequest.post('/donations', 
        DonationRequestBuilder.complete(testDonor, testRecipient, '200'));
    });

    test('should return all donations', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.count).toBeGreaterThanOrEqual(2);
    });

    test('should return donations with correct structure', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations');

      expect(response.status).toBe(200);
      const donation = response.body.data[0];
      expect(donation).toHaveProperty('id');
      expect(donation).toHaveProperty('amount');
      expect(donation).toHaveProperty('donor');
      expect(donation).toHaveProperty('recipient');
      expect(donation).toHaveProperty('timestamp');
    });
  });

  describe('GET /donations/recent - Get Recent Donations', () => {
    beforeEach(async () => {
      // Create multiple donations
      for (let i = 0; i < 15; i++) {
        await apiRequest.post('/donations',
          DonationRequestBuilder.complete(testDonor, testRecipient, `${10 + i}`));
      }
    });

    test('should return recent donations with default limit', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/recent');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
      expect(response.body.limit).toBe(10);
    });

    test('should respect custom limit parameter', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/recent', { limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.body.limit).toBe(5);
    });

    test('should enforce maximum limit of 100', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/recent', { limit: 200 });

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(100);
    });

    test('should return donations in descending order by timestamp', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/recent', { limit: 5 });

      expect(response.status).toBe(200);
      const donations = response.body.data;
      
      for (let i = 0; i < donations.length - 1; i++) {
        const current = new Date(donations[i].timestamp);
        const next = new Date(donations[i + 1].timestamp);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });

    test('should reject invalid limit parameter', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/recent', { limit: 'invalid' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /donations/:id - Get Specific Donation', () => {
    let donationId;

    beforeEach(async () => {
      await apiRequest.post('/donations',
        DonationRequestBuilder.minimal(testDonor, testRecipient));

      const transactions = Transaction.getAll();
      donationId = transactions[transactions.length - 1].id;
    });

    test('should return specific donation by ID', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get(`/donations/${donationId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(donationId);
    });

    test('should return 404 for non-existent donation', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/non-existent-id');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /donations/limits - Get Donation Limits', () => {
    test('should return donation limits', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/limits');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('minAmount');
      expect(response.body.data).toHaveProperty('maxAmount');
      expect(response.body.data).toHaveProperty('maxDailyPerDonor');
      expect(response.body.data).toHaveProperty('currency');
      expect(response.body.data.currency).toBe('XLM');
    });

    test('should return numeric limits', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .get('/donations/limits');

      expect(response.status).toBe(200);
      expect(typeof response.body.data.minAmount).toBe('number');
      expect(typeof response.body.data.maxAmount).toBe('number');
      expect(typeof response.body.data.maxDailyPerDonor).toBe('number');
    });
  });

  describe('POST /donations/verify - Verify Transaction', () => {
    test('should verify valid transaction hash', async () => {
      const createResponse = await apiRequest.post('/donations',
        DonationRequestBuilder.minimal(testDonor, testRecipient));

      const transactionHash = createResponse.body.data.transactionHash;

      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .post('/donations/verify', { transactionHash });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    test('should reject verification without transaction hash', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .post('/donations/verify', {});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /donations/:id/status - Update Donation Status', () => {
    let donationId;

    beforeEach(async () => {
      await apiRequest.post('/donations',
        DonationRequestBuilder.minimal(testDonor, testRecipient));

      const transactions = Transaction.getAll();
      donationId = transactions[transactions.length - 1].id;
    });

    test('should update donation status', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .patch(`/donations/${donationId}/status`, {
          status: 'confirmed',
          stellarTxId: 'test-tx-123',
          ledger: 12345
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('confirmed');
    });

    test('should reject invalid status', async () => {
      const response = await ApiRequestBuilder
        .create(request, app)
        .asUser()
        .patch(`/donations/${donationId}/status`, {
          status: 'invalid-status'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('End-to-End Donation Flow', () => {
    test('should complete full donation lifecycle', async () => {
      const apiReq = ApiRequestBuilder.create(request, app).asUser();

      // Step 1: Check limits
      const limitsResponse = await apiReq.get('/donations/limits');
      expect(limitsResponse.status).toBe(200);
      const { minAmount, maxAmount } = limitsResponse.body.data;

      // Step 2: Create donation within limits
      const donationAmount = (minAmount + maxAmount) / 2;
      const donationData = new DonationRequestBuilder()
        .between(testDonor, testRecipient)
        .withAmount(donationAmount.toString())
        .withMemo('E2E test donation')
        .build();

      const createResponse = await apiRequest.post('/donations', donationData);
      expect(createResponse.status).toBe(201);
      const transactionHash = createResponse.body.data.transactionHash;

      // Step 3: Verify transaction
      const verifyResponse = await apiReq.post('/donations/verify', { transactionHash });
      expect(verifyResponse.status).toBe(200);

      // Step 4: Check recent donations
      const recentResponse = await apiReq.get('/donations/recent', { limit: 1 });
      expect(recentResponse.status).toBe(200);
      expect(recentResponse.body.data.length).toBeGreaterThan(0);

      // Step 5: Get all donations
      const allResponse = await apiReq.get('/donations');
      expect(allResponse.status).toBe(200);
      expect(allResponse.body.count).toBeGreaterThan(0);
    });
  });
});
