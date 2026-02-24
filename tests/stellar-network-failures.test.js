/**
 * Stellar Network Failure Simulation Tests
 * Comprehensive tests for network failures, timeouts, and retry logic
 */

const { getStellarService } = require('../src/config/stellar');
const MockStellarService = require('../src/services/MockStellarService');

describe('Stellar Network Failure Simulations', () => {
  let stellarService;

  beforeEach(() => {
    process.env.MOCK_STELLAR = 'true';
    stellarService = getStellarService();
  });

  afterEach(() => {
    if (stellarService.disableFailureSimulation) {
      stellarService.disableFailureSimulation();
    }
  });

  describe('Timeout Failures', () => {
    test('should handle timeout on balance query', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      stellarService.enableFailureSimulation('timeout', 1.0);

      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow(/timeout/i);
    });

    test('should handle timeout on transaction submission', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('timeout', 1.0);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Timeout test'
        })
      ).rejects.toThrow(/timeout/i);
    });

    test('should handle intermittent timeouts', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      stellarService.enableFailureSimulation('timeout', 0.5); // 50% failure rate

      const attempts = 10;
      const results = [];

      for (let i = 0; i < attempts; i++) {
        try {
          await stellarService.getBalance(wallet.publicKey);
          results.push('success');
        } catch (error) {
          results.push('failure');
        }
      }

      const failures = results.filter(r => r === 'failure').length;
      expect(failures).toBeGreaterThan(0);
      expect(failures).toBeLessThan(attempts);
    });

    test('should include retry information in timeout error', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      stellarService.enableFailureSimulation('timeout', 1.0);

      try {
        await stellarService.getBalance(wallet.publicKey);
        fail('Should have thrown timeout error');
      } catch (error) {
        expect(error.message).toContain('timeout');
        expect(error.details).toBeDefined();
        expect(error.details.retryable).toBe(true);
        expect(error.details.retryAfter).toBeGreaterThan(0);
      }
    });
  });

  describe('Network Error Failures', () => {
    test('should handle network connection error', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('network_error', 1.0);

      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow(/network error/i);
    });

    test('should handle connection refused', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('connection_refused', 1.0);

      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow(/connection refused/i);
    });

    test('should mark network errors as retryable', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('network_error', 1.0);

      try {
        await stellarService.getBalance(wallet.publicKey);
        fail('Should have thrown network error');
      } catch (error) {
        expect(error.details).toBeDefined();
        expect(error.details.retryable).toBe(true);
      }
    });
  });

  describe('Service Unavailable Failures', () => {
    test('should handle service unavailable error', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('service_unavailable', 1.0);

      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow(/service.*unavailable/i);
    });

    test('should suggest longer retry delay for service unavailable', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('service_unavailable', 1.0);

      try {
        await stellarService.getBalance(wallet.publicKey);
        fail('Should have thrown service unavailable error');
      } catch (error) {
        expect(error.details.retryAfter).toBeGreaterThanOrEqual(10000);
      }
    });
  });

  describe('Transaction-Specific Failures', () => {
    test('should handle bad sequence number error', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('bad_sequence', 1.0);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Bad sequence test'
        })
      ).rejects.toThrow(/bad_seq/i);
    });

    test('should handle transaction failed error', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('tx_failed', 1.0);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'TX failed test'
        })
      ).rejects.toThrow(/tx_failed/i);
    });

    test('should handle insufficient fee error', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('tx_insufficient_fee', 1.0);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Insufficient fee test'
        })
      ).rejects.toThrow(/insufficient.*fee/i);
    });

    test('should handle ledger closed error', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('ledger_closed', 1.0);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Ledger closed test'
        })
      ).rejects.toThrow(/ledger.*closed/i);
    });
  });

  describe('Rate Limiting Failures', () => {
    test('should handle Horizon rate limit error', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('rate_limit_horizon', 1.0);

      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow(/rate limit/i);
    });

    test('should suggest long retry delay for rate limit', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('rate_limit_horizon', 1.0);

      try {
        await stellarService.getBalance(wallet.publicKey);
        fail('Should have thrown rate limit error');
      } catch (error) {
        expect(error.details.retryAfter).toBeGreaterThanOrEqual(60000);
      }
    });
  });

  describe('Partial Response Failures', () => {
    test('should handle partial response error', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('partial_response', 1.0);

      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow(/incomplete.*response|partial.*response/i);
    });
  });

  describe('Consecutive Failure Scenarios', () => {
    test('should track consecutive failures', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      stellarService.enableFailureSimulation('timeout', 1.0);

      let consecutiveFailures = 0;
      for (let i = 0; i < 5; i++) {
        try {
          await stellarService.getBalance(wallet.publicKey);
        } catch (error) {
          consecutiveFailures++;
        }
      }

      expect(consecutiveFailures).toBe(5);
    });

    test('should auto-recover after max consecutive failures', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      stellarService.enableFailureSimulation('timeout', 1.0);
      stellarService.setMaxConsecutiveFailures(3);

      const results = [];
      for (let i = 0; i < 5; i++) {
        try {
          await stellarService.getBalance(wallet.publicKey);
          results.push('success');
        } catch (error) {
          results.push('failure');
        }
      }

      const failures = results.filter(r => r === 'failure').length;
      const successes = results.filter(r => r === 'success').length;

      expect(failures).toBe(3);
      expect(successes).toBeGreaterThan(0);
    });
  });

  describe('Mixed Operation Failures', () => {
    test('should handle failures across different operations', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      stellarService.enableFailureSimulation('network_error', 0.5);

      const operations = [
        () => stellarService.fundTestnetWallet(donor.publicKey),
        () => stellarService.fundTestnetWallet(recipient.publicKey),
        () => stellarService.getBalance(donor.publicKey),
        () => stellarService.getBalance(recipient.publicKey),
      ];

      const results = await Promise.allSettled(
        operations.map(op => op())
      );

      const failures = results.filter(r => r.status === 'rejected').length;
      expect(failures).toBeGreaterThan(0);
    });

    test('should handle transaction failure without corrupting state', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      const initialBalance = await stellarService.getBalance(donor.publicKey);

      stellarService.enableFailureSimulation('tx_failed', 1.0);

      try {
        await stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Should fail'
        });
        fail('Should have thrown error');
      } catch (error) {
        // Verify state is not corrupted
        stellarService.disableFailureSimulation();
        const finalBalance = await stellarService.getBalance(donor.publicKey);
        expect(finalBalance.balance).toBe(initialBalance.balance);
      }
    });
  });

  describe('Recurring Donation Failure Scenarios', () => {
    test('should handle sendPayment failures', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('timeout', 1.0);

      await expect(
        stellarService.sendPayment(donor.publicKey, recipient.publicKey, 50, 'Recurring')
      ).rejects.toThrow(/timeout/i);
    });

    test('should handle intermittent failures in recurring payments', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      stellarService.enableFailureSimulation('tx_failed', 0.3);

      const attempts = 10;
      const results = [];

      for (let i = 0; i < attempts; i++) {
        try {
          await stellarService.sendPayment(donor.publicKey, recipient.publicKey, 10, `Payment ${i}`);
          results.push('success');
        } catch (error) {
          results.push('failure');
        }
      }

      const failures = results.filter(r => r === 'failure').length;
      const successes = results.filter(r => r === 'success').length;

      expect(failures).toBeGreaterThan(0);
      expect(successes).toBeGreaterThan(0);
    });
  });

  describe('Error Message Quality', () => {
    test('should provide clear error messages for all failure types', async () => {
      const wallet = await stellarService.createWallet();

      const failureTypes = [
        'timeout',
        'network_error',
        'service_unavailable',
        'connection_refused',
        'rate_limit_horizon',
        'partial_response',
      ];

      for (const failureType of failureTypes) {
        stellarService.enableFailureSimulation(failureType, 1.0);

        try {
          await stellarService.getBalance(wallet.publicKey);
          fail(`Should have thrown ${failureType} error`);
        } catch (error) {
          expect(error.message).toBeDefined();
          expect(error.message.length).toBeGreaterThan(10);
          expect(error.details).toBeDefined();
        }

        stellarService.disableFailureSimulation();
      }
    });

    test('should include retry guidance in error details', async () => {
      const wallet = await stellarService.createWallet();

      stellarService.enableFailureSimulation('timeout', 1.0);

      try {
        await stellarService.getBalance(wallet.publicKey);
        fail('Should have thrown error');
      } catch (error) {
        expect(error.details.retryable).toBe(true);
        expect(error.details.retryAfter).toBeDefined();
        expect(typeof error.details.retryAfter).toBe('number');
      }
    });
  });

  describe('Failure Simulation Control', () => {
    test('should enable and disable failure simulation', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      // Enable
      stellarService.enableFailureSimulation('timeout', 1.0);
      await expect(
        stellarService.getBalance(wallet.publicKey)
      ).rejects.toThrow();

      // Disable
      stellarService.disableFailureSimulation();
      const balance = await stellarService.getBalance(wallet.publicKey);
      expect(balance).toBeDefined();
      expect(balance.balance).toBe('10000.0000000');
    });

    test('should respect failure probability', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      stellarService.enableFailureSimulation('timeout', 0.0); // 0% failure

      // Should never fail
      for (let i = 0; i < 10; i++) {
        const balance = await stellarService.getBalance(wallet.publicKey);
        expect(balance).toBeDefined();
      }
    });
  });

  describe('Real-World Failure Patterns', () => {
    test('should simulate network congestion scenario', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      // Simulate high congestion with multiple failure types
      const failureTypes = ['tx_failed', 'tx_insufficient_fee', 'timeout'];
      const randomFailure = failureTypes[Math.floor(Math.random() * failureTypes.length)];

      stellarService.enableFailureSimulation(randomFailure, 0.7);

      const attempts = 5;
      let successCount = 0;

      for (let i = 0; i < attempts; i++) {
        try {
          await stellarService.sendDonation({
            sourceSecret: donor.secretKey,
            destinationPublic: recipient.publicKey,
            amount: '10',
            memo: `Congestion test ${i}`
          });
          successCount++;
        } catch (error) {
          expect(error.details.retryable).toBe(true);
        }
      }

      // Some should succeed, some should fail
      expect(successCount).toBeLessThan(attempts);
    });

    test('should simulate service degradation and recovery', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      // Phase 1: Service degradation
      stellarService.enableFailureSimulation('service_unavailable', 0.8);

      let phase1Failures = 0;
      for (let i = 0; i < 5; i++) {
        try {
          await stellarService.getBalance(wallet.publicKey);
        } catch (error) {
          phase1Failures++;
        }
      }

      // Phase 2: Recovery
      stellarService.enableFailureSimulation('service_unavailable', 0.2);

      let phase2Failures = 0;
      for (let i = 0; i < 5; i++) {
        try {
          await stellarService.getBalance(wallet.publicKey);
        } catch (error) {
          phase2Failures++;
        }
      }

      expect(phase1Failures).toBeGreaterThan(phase2Failures);
    });
  });
});
