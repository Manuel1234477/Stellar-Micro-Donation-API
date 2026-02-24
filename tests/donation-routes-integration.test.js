/**
 * Donation Routes Integration Tests
 * End-to-end tests for donation routes using mocked Stellar service
 * Tests do not require live Stellar network
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2';

const request = require('supertest');
const express = require('express');
const donationRouter = require('../src/routes/donation');
const Transaction = require('../src/routes/models/transaction');
const { getStellarService } = require('../src/config/stellar');
const { attachUserRole } = require('../src/middleware/rbacMiddleware');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);

  // Add error handler
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal server error'
      }
    });
  });
  return app;
}

describe('Donation Routes Integration Tests', () => {
  let app;
  let stellarService;
  let testDonor;
  let testRecipient;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();
    
    // Create test wallets
    testDonor = await stellarService.createWallet();
    testRecipient = await stellarService.createWallet();
    
    // Fund wallets
    await stellarService.fundTestnetWallet(testDonor.publicKey);
    await stellarService.fundTestnetWallet(testRecipient.publicKey);
  });

  beforeEach(() => {
    // Clear transaction data before each test
    Transaction._clearAllData();
  });

  describe('POST /donations - Create Donation', () => {
    describe('Successful donation flow', () => {
      test('should create donation with valid data', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-001')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey,
            memo: 'Test donation'
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.verified).toBe(true);
        expect(response.body.data.transactionHash).toBeDefined();
      });

      test('should create donation without memo', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-002')
          .send({
            amount: '50',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      test('should create anonymous donation', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-003')
          .send({
            amount: '25',
            recipient: testRecipient.publicKey,
            memo: 'Anonymous donation'
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      test('should handle decimal amounts correctly', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-004')
          .send({
            amount: '123.456789',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      test('should calculate analytics fee', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-005')
          .send({
            amount: '1000',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(201);
        
        // Verify transaction was created with fee
        const transactions = Transaction.getAll();
        const tx = transactions.find(t => t.donor === testDonor.publicKey);
        expect(tx.analyticsFee).toBeDefined();
        expect(tx.analyticsFeePercentage).toBeDefined();
      });
    });

    describe('Validation failures', () => {
      test('should reject donation without amount', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-006')
          .send({
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBeDefined();
      });

      test('should reject donation without recipient', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-007')
          .send({
            amount: '100',
            donor: testDonor.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      });

      test('should reject negative amount', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-008')
          .send({
            amount: '-100',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/positive number/i);
      });

      test('should reject zero amount', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-009')
          .send({
            amount: '0',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/positive number/i);
      });

      test('should reject invalid amount format', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-010')
          .send({
            amount: 'not-a-number',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/positive number/i);
      });

      test('should reject donation to self', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-011')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: testDonor.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
      });

      test('should reject memo exceeding 28 bytes', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-012')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey,
            memo: 'a'.repeat(29) // 29 bytes, exceeds limit
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toMatch(/MEMO/i);
      });

      test('should reject malformed donor field', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-013')
          .send({
            amount: '100',
            donor: { invalid: 'object' },
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/malformed/i);
      });

      test('should reject malformed recipient field', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-014')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: { invalid: 'object' }
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/malformed/i);
      });
    });

    describe('Amount limit validation', () => {
      test('should reject amount below minimum', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-015')
          .send({
            amount: '0.5', // Below minimum of 1 XLM
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBeDefined();
        expect(response.body.error.limits).toBeDefined();
      });

      test('should reject amount above maximum', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', 'test-idem-016')
          .send({
            amount: '100001', // Above maximum of 100000 XLM
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error.limits).toBeDefined();
      });
    });

    describe('Idempotency', () => {
      test('should return same response for duplicate idempotency key', async () => {
        const idempotencyKey = 'test-idem-duplicate-001';
        const requestData = {
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        };

        // First request
        const response1 = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', idempotencyKey)
          .send(requestData);

        expect(response1.status).toBe(201);

        // Second request with same idempotency key
        const response2 = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', idempotencyKey)
          .send(requestData);

        expect(response2.status).toBe(200); // Returns cached response
        expect(response2.body).toEqual(response1.body);
      });

      test('should reject request without idempotency key', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(400);
      });
    });

    describe('Authentication', () => {
      test('should reject request without API key', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-Idempotency-Key', 'test-idem-017')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(401);
      });

      test('should reject request with invalid API key', async () => {
        const response = await request(app)
          .post('/donations')
          .set('X-API-Key', 'invalid-key')
          .set('X-Idempotency-Key', 'test-idem-018')
          .send({
            amount: '100',
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });

        expect(response.status).toBe(401);
      });
    });
  });

  describe('GET /donations - List All Donations', () => {
    beforeEach(async () => {
      // Create some test donations
      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-list-001')
        .send({
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });

      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-list-002')
        .send({
          amount: '200',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });
    });

    test('should return all donations', async () => {
      const response = await request(app)
        .get('/donations')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.count).toBeGreaterThanOrEqual(2);
    });

    test('should return donations with correct structure', async () => {
      const response = await request(app)
        .get('/donations')
        .set('X-API-Key', 'test-key-1');

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
        await request(app)
          .post('/donations')
          .set('X-API-Key', 'test-key-1')
          .set('X-Idempotency-Key', `test-recent-${i}`)
          .send({
            amount: `${10 + i}`,
            donor: testDonor.publicKey,
            recipient: testRecipient.publicKey
          });
      }
    });

    test('should return recent donations with default limit', async () => {
      const response = await request(app)
        .get('/donations/recent')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
      expect(response.body.limit).toBe(10);
    });

    test('should respect custom limit parameter', async () => {
      const response = await request(app)
        .get('/donations/recent?limit=5')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.body.limit).toBe(5);
    });

    test('should enforce maximum limit of 100', async () => {
      const response = await request(app)
        .get('/donations/recent?limit=200')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(100);
    });

    test('should return donations in descending order by timestamp', async () => {
      const response = await request(app)
        .get('/donations/recent?limit=5')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      const donations = response.body.data;
      
      for (let i = 0; i < donations.length - 1; i++) {
        const current = new Date(donations[i].timestamp);
        const next = new Date(donations[i + 1].timestamp);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });

    test('should reject invalid limit parameter', async () => {
      const response = await request(app)
        .get('/donations/recent?limit=invalid')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(400);
    });

    test('should sanitize sensitive data', async () => {
      const response = await request(app)
        .get('/donations/recent')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      const donation = response.body.data[0];
      expect(donation).not.toHaveProperty('stellarTxId');
    });
  });

  describe('GET /donations/:id - Get Specific Donation', () => {
    let donationId;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-get-specific-001')
        .send({
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });

      const transactions = Transaction.getAll();
      donationId = transactions[transactions.length - 1].id;
    });

    test('should return specific donation by ID', async () => {
      const response = await request(app)
        .get(`/donations/${donationId}`)
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(donationId);
    });

    test('should return 404 for non-existent donation', async () => {
      const response = await request(app)
        .get('/donations/non-existent-id')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /donations/limits - Get Donation Limits', () => {
    test('should return donation limits', async () => {
      const response = await request(app)
        .get('/donations/limits')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('minAmount');
      expect(response.body.data).toHaveProperty('maxAmount');
      expect(response.body.data).toHaveProperty('maxDailyPerDonor');
      expect(response.body.data).toHaveProperty('currency');
      expect(response.body.data.currency).toBe('XLM');
    });

    test('should return numeric limits', async () => {
      const response = await request(app)
        .get('/donations/limits')
        .set('X-API-Key', 'test-key-1');

      expect(response.status).toBe(200);
      expect(typeof response.body.data.minAmount).toBe('number');
      expect(typeof response.body.data.maxAmount).toBe('number');
      expect(typeof response.body.data.maxDailyPerDonor).toBe('number');
    });
  });

  describe('POST /donations/verify - Verify Transaction', () => {
    test('should verify valid transaction hash', async () => {
      // Create a donation first
      const createResponse = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-verify-001')
        .send({
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });

      const transactionHash = createResponse.body.data.transactionHash;

      // Verify the transaction
      const response = await request(app)
        .post('/donations/verify')
        .set('X-API-Key', 'test-key-1')
        .send({
          transactionHash
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    test('should reject verification without transaction hash', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .set('X-API-Key', 'test-key-1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should handle non-existent transaction hash', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .set('X-API-Key', 'test-key-1')
        .send({
          transactionHash: 'non-existent-hash'
        });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /donations/:id/status - Update Donation Status', () => {
    let donationId;

    beforeEach(async () => {
      await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-update-status-001')
        .send({
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });

      const transactions = Transaction.getAll();
      donationId = transactions[transactions.length - 1].id;
    });

    test('should update donation status', async () => {
      const response = await request(app)
        .patch(`/donations/${donationId}/status`)
        .set('X-API-Key', 'test-key-1')
        .send({
          status: 'confirmed',
          stellarTxId: 'test-tx-123',
          ledger: 12345
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('confirmed');
    });

    test('should reject invalid status', async () => {
      const response = await request(app)
        .patch(`/donations/${donationId}/status`)
        .set('X-API-Key', 'test-key-1')
        .send({
          status: 'invalid-status'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should reject update without status', async () => {
      const response = await request(app)
        .patch(`/donations/${donationId}/status`)
        .set('X-API-Key', 'test-key-1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('End-to-End Donation Flow', () => {
    test('should complete full donation lifecycle', async () => {
      // Step 1: Check limits
      const limitsResponse = await request(app)
        .get('/donations/limits')
        .set('X-API-Key', 'test-key-1');

      expect(limitsResponse.status).toBe(200);
      const { minAmount, maxAmount } = limitsResponse.body.data;

      // Step 2: Create donation within limits
      const donationAmount = (minAmount + maxAmount) / 2;
      const createResponse = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-e2e-001')
        .send({
          amount: donationAmount.toString(),
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey,
          memo: 'E2E test donation'
        });

      expect(createResponse.status).toBe(201);
      const transactionHash = createResponse.body.data.transactionHash;

      // Step 3: Verify transaction
      const verifyResponse = await request(app)
        .post('/donations/verify')
        .set('X-API-Key', 'test-key-1')
        .send({ transactionHash });

      expect(verifyResponse.status).toBe(200);

      // Step 4: Check recent donations
      const recentResponse = await request(app)
        .get('/donations/recent?limit=1')
        .set('X-API-Key', 'test-key-1');

      expect(recentResponse.status).toBe(200);
      expect(recentResponse.body.data.length).toBeGreaterThan(0);

      // Step 5: Get all donations
      const allResponse = await request(app)
        .get('/donations')
        .set('X-API-Key', 'test-key-1');

      expect(allResponse.status).toBe(200);
      expect(allResponse.body.count).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-error-001')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test('should handle missing Content-Type header', async () => {
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-error-002')
        .send({
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });

      // Should still work with express.json() middleware
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('Rate Limiting', () => {
    test('should apply rate limiting to donation endpoint', async () => {
      // Note: Rate limiting behavior depends on configuration
      // This test verifies the endpoint accepts requests
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'test-rate-001')
        .send({
          amount: '100',
          donor: testDonor.publicKey,
          recipient: testRecipient.publicKey
        });

      expect(response.status).toBeLessThan(500);
    });
  });
});
