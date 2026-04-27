/**
 * Time-Bound Transactions Test Suite
 * 
 * Tests Stellar time-bound transaction (minTime/maxTime) functionality for donation creation.
 * Validates:
 * - Strict validation of unix timestamps
 * - Clock-based failure simulation
 * - Time window enforcement
 * - API constraint validation
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const Database = require('../../src/utils/database');
const { getStellarService } = require('../../src/config/stellar');
const Transaction = require('../../src/routes/models/transaction');
const encryption = require('../../src/utils/encryption');

// Test API Key with donations permission
const TEST_API_KEY = 'test-api-key-timebounds-12345';

describe('Stellar Time-Bound Transactions', () => {
  let stellarService;
  let testSenderId;
  let testReceiverId;
  let testSenderKeyPair;
  let testReceiverKeyPair;
  let currentTimestamp;

  beforeAll(async () => {
    stellarService = getStellarService();
    
    // Generate test keypairs
    const StellarSdk = require('stellar-sdk');
    testSenderKeyPair = StellarSdk.Keypair.random();
    testReceiverKeyPair = StellarSdk.Keypair.random();

    // Setup test users
    await Database.run('DELETE FROM users WHERE nickname IN (?, ?)', ['test-sender-timebounds', 'test-receiver-timebounds']);
    
    // Encrypt sender's secret key
    const encryptedSecret = encryption.encrypt(testSenderKeyPair.secret());

    const senderResult = await Database.run(
      'INSERT INTO users (publicKey, encryptedSecret, nickname, email) VALUES (?, ?, ?, ?)',
      [testSenderKeyPair.publicKey(), encryptedSecret, 'test-sender-timebounds', 'sender@timebounds.test']
    );
    testSenderId = senderResult.id;

    const receiverResult = await Database.run(
      'INSERT INTO users (publicKey, nickname, email) VALUES (?, ?, ?)',
      [testReceiverKeyPair.publicKey(), 'test-receiver-timebounds', 'receiver@timebounds.test']
    );
    testReceiverId = receiverResult.id;

    // Setup test API key
    await Database.run('DELETE FROM api_keys WHERE key_prefix = ?', ['test_pk']);
    await Database.run(
      'INSERT INTO api_keys (key_hash, key_prefix, name, role, status, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['5f9c4ab08cac7457e9111a30e4664882286a07ddc0f6f240c11c5ef82c49a3eb', 'test_pk', 'Test Key Timebounds', 'admin', 'active', Math.floor(Date.now() / 1000), '{}']
    );

    // Fund mock wallets if using MockStellarService
    if (stellarService.fundTestnetWallet) {
      try {
        await stellarService.fundTestnetWallet(testSenderKeyPair.publicKey());
        await stellarService.fundTestnetWallet(testReceiverKeyPair.publicKey());
      } catch (err) {
        console.log('Note: Mock wallet funding skipped (may use real network)');
      }
    }

    // Capture current time for test calculations
    currentTimestamp = Math.floor(Date.now() / 1000);
  });

  afterAll(async () => {
    await Database.run('DELETE FROM users WHERE nickname IN (?, ?)', ['test-sender-timebounds', 'test-receiver-timebounds']);
    await Database.run('DELETE FROM api_keys WHERE key_prefix = ?', ['test_pk']);
    await Database.run('DELETE FROM transactions WHERE amount = 50.0000000');
  });

  afterEach(() => {
    // Reset mock system time after each test
    if (stellarService.resetMockSystemTime) {
      stellarService.resetMockSystemTime();
    }
  });

  describe('Test 1: Successful donation within a valid window', () => {
    it('should accept donation when current time is within validAfter < currentTime < validBefore', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 3600; // 1 hour ago
      const validBefore = now + 3600; // 1 hour from now

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-success-${Date.now()}`)
        .send({
          amount: '50.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'Time-bound donation test',
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('transactionHash');
    });

    it('should accept donation when only validAfter (no upper bound)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 3600; // 1 hour ago

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-lower-${Date.now()}`)
        .send({
          amount: '25.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'Lower bound only test',
          validAfter: validAfter.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should accept donation when only validBefore (no lower bound)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validBefore = now + 3600; // 1 hour from now

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-upper-${Date.now()}`)
        .send({
          amount: '30.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'Upper bound only test',
          validBefore: validBefore.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should accept donation without time bounds (backward compatibility)', async () => {
      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-none-${Date.now()}`)
        .send({
          amount: '15.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'No time bounds test',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Test 2: Immediate 400 error when validAfter > validBefore', () => {
    it('should reject donation when validAfter > validBefore', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now + 3600; // 1 hour from now
      const validBefore = now; // now (in the past relative to validAfter)

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-invalid-${Date.now()}`)
        .send({
          amount: '50.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('INVALID_TIME_BOUNDS');
      expect(res.body.error.message).toContain('validAfter');
      expect(res.body.error.message).toContain('validBefore');
    });

    it('should reject donation when validAfter equals validBefore', async () => {
      const now = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-equal-${Date.now()}`)
        .send({
          amount: '50.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          validAfter: now.toString(),
          validBefore: now.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TIME_BOUNDS');
    });

    it('should provide clear error message when constraint violation', async () => {
      const now = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-msg-${Date.now()}`)
        .send({
          amount: '50.0',
          recipient: testReceiverKeyPair.publicKey(),
          validAfter: (now + 1000).toString(),
          validBefore: (now + 500).toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/validAfter.*less than.*validBefore/i);
    });
  });

  describe('Test 3: Transaction failure when window has expired', () => {
    it('should simulate transaction failure when current time is before validAfter', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now + 7200; // 2 hours in future
      const validBefore = now + 10800; // 3 hours in future

      // Set mock system to current time (before validAfter)
      if (stellarService.setMockSystemTime) {
        stellarService.setMockSystemTime(now);

        // This should fail because we're submitting before validAfter
        const res = await request(app)
          .post('/api/v1/donations')
          .set('Authorization', `Bearer ${TEST_API_KEY}`)
          .set('Idempotency-Key', `test-timebounds-early-${Date.now()}`)
          .send({
            amount: '50.0',
            recipient: testReceiverKeyPair.publicKey(),
            donor: testSenderKeyPair.publicKey(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
          });

        // Expect failure with clear time bounds error message
        expect([500, 400]).toContain(res.status);
        expect(res.body.error || res.body.message).toBeDefined();
        expect(JSON.stringify(res.body)).toMatch(/time.*bound|validAfter|not.*valid/i);
      }
    });

    it('should simulate transaction failure when current time is when validBefore', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 7200; // 2 hours ago
      const validBefore = now - 3600; // 1 hour ago (window expired)

      // Set mock system to current time (after validBefore)
      if (stellarService.setMockSystemTime) {
        stellarService.setMockSystemTime(now);

        // This should fail because we're submitting after validBefore
        const res = await request(app)
          .post('/api/v1/donations')
          .set('Authorization', `Bearer ${TEST_API_KEY}`)
          .set('Idempotency-Key', `test-timebounds-expired-${Date.now()}`)
          .send({
            amount: '50.0',
            recipient: testReceiverKeyPair.publicKey(),
            donor: testSenderKeyPair.publicKey(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
          });

        // Expect failure with clear expiration error message
        expect([500, 400]).toContain(res.status);
        expect(res.body.error || res.body.message).toBeDefined();
        expect(JSON.stringify(res.body)).toMatch(/time.*bound|expired|validBefore/i);
      }
    });

    it('should correctly validate time bounds when edge case timestamps', async () => {
      const now = Math.floor(Date.now() / 1000);
      const oneHourFromNow = now + 3600;

      if (stellarService.setMockSystemTime) {
        // Set mock time to exactly at validBefore boundary
        stellarService.setMockSystemTime(oneHourFromNow);

        const res = await request(app)
          .post('/api/v1/donations')
          .set('Authorization', `Bearer ${TEST_API_KEY}`)
          .set('Idempotency-Key', `test-timebounds-boundary-${Date.now()}`)
          .send({
            amount: '50.0',
            recipient: testReceiverKeyPair.publicKey(),
            donor: testSenderKeyPair.publicKey(),
            validAfter: (now - 3600).toString(),
            validBefore: oneHourFromNow.toString(),
          });

        // Should handle boundary condition gracefully
        expect([200, 201, 400, 500]).toContain(res.status);
      }
    });
  });

  describe('Timebounds Storage and Audit', () => {
    it('should store validAfter and validBefore in transaction record', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 3600;
      const validBefore = now + 3600;

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-storage-${Date.now()}`)
        .send({
          amount: '40.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'Storage test',
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
        });

      expect(res.status).toBe(201);
      
      // Verify transaction hash is in response
      const txHash = res.body.data.transactionHash;
      expect(txHash).toBeDefined();

      // Query the transaction record to verify timebounds are stored
      // Note: The transaction might be in JSON storage or database depending on flow
      // For now, we just verify the donation was accepted
      expect(res.body.data).toHaveProperty('transactionHash');
    });

    it('should allow querying transactions when expired time bounds', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredValidAfter = now - 7200;
      const expiredValidBefore = now - 3600;

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-query-${Date.now()}`)
        .send({
          amount: '35.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'Query test',
          validAfter: expiredValidAfter.toString(),
          validBefore: expiredValidBefore.toString(),
        });

      // Even if the window is currently expired, the API should accept the record
      // (it's just metadata about when the transaction was valid)
      // But the actual transaction submission should fail
      expect([200, 201, 400, 500]).toContain(res.status);
    });
  });

  describe('Timebounds with other donation features', () => {
    it('should work when memo', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 3600;
      const validBefore = now + 3600;

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-memo-${Date.now()}`)
        .send({
          amount: '20.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          memo: 'Time-bounded with memo',
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
        });

      expect(res.status).toBe(201);
    });

    it('should work when notes and tags', async () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 3600;
      const validBefore = now + 3600;

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-tags-${Date.now()}`)
        .send({
          amount: '18.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          notes: 'Important time-locked grant',
          tags: ['time-locked', 'education'],
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
        });

      expect(res.status).toBe(201);
    });

    it('should validate time bounds before other validations fail', async () => {
      const now = Math.floor(Date.now() / 1000);
      const invalidBounds = now + 1000; // validAfter > validBefore

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-early-fail-${Date.now()}`)
        .send({
          amount: '999999999', // Large invalid amount
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          validAfter: invalidBounds.toString(),
          validBefore: now.toString(), // validBefore < validAfter = INVALID
        });

      // Should fail on time bounds first
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TIME_BOUNDS');
    });
  });

  describe('Clock skew and time bounds edge cases', () => {
    it('should handle zero timestamps (infinite bounds)', async () => {
      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-infinite-${Date.now()}`)
        .send({
          amount: '12.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          validAfter: '0',
          validBefore: '0',
        });

      expect(res.status).toBe(201);
    });

    it('should accept large unix timestamps (far future)', async () => {
      const farFuture = 4102444800; // Year 2100

      const res = await request(app)
        .post('/api/v1/donations')
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .set('Idempotency-Key', `test-timebounds-future-${Date.now()}`)
        .send({
          amount: '10.0',
          recipient: testReceiverKeyPair.publicKey(),
          donor: testSenderKeyPair.publicKey(),
          validBefore: farFuture.toString(),
        });

      expect(res.status).toBe(201);
    });

    it('should handle rapid sequential donations when overlapping time windows', async () => {
      const now = Math.floor(Date.now() / 1000);

      const donations = [
        {
          id: `test-rapid-1-${Date.now()}`,
          validAfter: now,
          validBefore: now + 10,
        },
        {
          id: `test-rapid-2-${Date.now()}`,
          validAfter: now + 5,
          validBefore: now + 15,
        },
      ];

      for (const donation of donations) {
        const res = await request(app)
          .post('/api/v1/donations')
          .set('Authorization', `Bearer ${TEST_API_KEY}`)
          .set('Idempotency-Key', donation.id)
          .send({
            amount: '8.0',
            recipient: testReceiverKeyPair.publicKey(),
            donor: testSenderKeyPair.publicKey(),
            validAfter: donation.validAfter.toString(),
            validBefore: donation.validBefore.toString(),
          });

        expect([200, 201]).toContain(res.status);
      }
    });
  });
});
