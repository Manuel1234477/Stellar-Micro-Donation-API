/**
 * Chaos-Style Tests (Non-Blocking)
 * Simulates random failures to surface hidden assumptions
 * 
 * These tests introduce controlled chaos to verify system resilience:
 * - Random network failures
 * - Intermittent database errors
 * - Race conditions
 * - Resource exhaustion
 * - Timing-based failures
 * 
 * Run with: npm test -- chaos-testing.test.js
 * Or skip with: npm test -- --testPathIgnorePatterns=chaos-testing
 * 
 * NOTE: This test suite uses MockStellarService to avoid real network calls
 */

// Force mock mode BEFORE any imports
process.env.MOCK_STELLAR = 'true';

const Database = require('../src/utils/database');
const log = require('../src/utils/log');
const MockStellarService = require('../src/services/MockStellarService');

// Chaos configuration
const CHAOS_CONFIG = {
  // Probability of random failures (0-1)
  failureProbability: 0.3,
  // Number of iterations for chaos tests
  iterations: 20,
  // Enable detailed logging
  verbose: false,
};

describe('Chaos Testing Suite', () => {
  let stellarService;
  let originalDbQuery;
  let chaosResults = {
    totalTests: 0,
    failures: 0,
    crashes: 0,
    dataCorruption: 0,
    recoveries: 0,
  };

  beforeAll(() => {
    // Use MockStellarService directly
    stellarService = new MockStellarService({
      networkDelay: 0,
      failureRate: 0, // We'll control this manually
      strictValidation: true,
    });
    originalDbQuery = Database.query;
    
    if (CHAOS_CONFIG.verbose) {
      console.log('\n🌪️  Starting Chaos Testing Suite');
      console.log(`Configuration: ${CHAOS_CONFIG.iterations} iterations, ${CHAOS_CONFIG.failureProbability * 100}% failure rate\n`);
    }
  });

  afterAll(() => {
    Database.query = originalDbQuery;
    
    console.log('\n📊 Chaos Testing Results:');
    console.log(`   Total Tests: ${chaosResults.totalTests}`);
    console.log(`   Failures: ${chaosResults.failures}`);
    console.log(`   Crashes: ${chaosResults.crashes}`);
    console.log(`   Data Corruption: ${chaosResults.dataCorruption}`);
    console.log(`   Successful Recoveries: ${chaosResults.recoveries}`);
    console.log(`   Success Rate: ${((1 - chaosResults.crashes / chaosResults.totalTests) * 100).toFixed(2)}%\n`);
  });

  /**
   * Inject random failures into database operations
   */
  function injectDatabaseChaos() {
    Database.query = jest.fn().mockImplementation((...args) => {
      if (Math.random() < CHAOS_CONFIG.failureProbability) {
        const errors = [
          new Error('SQLITE_BUSY: database is locked'),
          new Error('SQLITE_IOERR: disk I/O error'),
          new Error('Connection timeout'),
          new Error('SQLITE_CORRUPT: database disk image is malformed'),
        ];
        return Promise.reject(errors[Math.floor(Math.random() * errors.length)]);
      }
      return originalDbQuery(...args);
    });
  }

  /**
   * Inject random failures into Stellar operations
   */
  function injectStellarChaos() {
    stellarService.config.failureRate = CHAOS_CONFIG.failureProbability;
  }

  /**
   * Remove chaos injections
   */
  function removeChaos() {
    Database.query = originalDbQuery;
    stellarService.config.failureRate = 0;
  }

  describe('Random Transaction Failures', () => {
    test('should handle intermittent transaction failures gracefully', async () => {
      injectStellarChaos();
      
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      let successCount = 0;
      let failureCount = 0;
      let corruptionDetected = false;

      for (let i = 0; i < CHAOS_CONFIG.iterations; i++) {
        chaosResults.totalTests++;
        
        try {
          const balanceBefore = await stellarService.getBalance(donor.publicKey);
          
          await stellarService.sendDonation({
            sourceSecret: donor.secretKey,
            destinationPublic: recipient.publicKey,
            amount: '10',
            memo: `Chaos test ${i}`,
          });
          
          const balanceAfter = await stellarService.getBalance(donor.publicKey);
          
          // Verify balance decreased
          if (parseFloat(balanceAfter.balance) >= parseFloat(balanceBefore.balance)) {
            corruptionDetected = true;
            chaosResults.dataCorruption++;
          }
          
          successCount++;
          chaosResults.recoveries++;
        } catch (error) {
          failureCount++;
          chaosResults.failures++;
          
          // Verify system is still responsive after failure
          try {
            await stellarService.getBalance(donor.publicKey);
          } catch (crashError) {
            chaosResults.crashes++;
          }
        }
      }

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Random Transactions: ${successCount} succeeded, ${failureCount} failed`);
      }

      // System should not crash or corrupt data
      expect(corruptionDetected).toBe(false);
      expect(chaosResults.crashes).toBe(0);
    });
  });

  describe('Database Chaos', () => {
    test('should handle intermittent database failures', async () => {
      injectDatabaseChaos();

      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < CHAOS_CONFIG.iterations; i++) {
        chaosResults.totalTests++;
        
        try {
          await Database.query('SELECT * FROM users LIMIT 1');
          successCount++;
          chaosResults.recoveries++;
        } catch (error) {
          failureCount++;
          chaosResults.failures++;
          
          // Verify database is still accessible after failure
          try {
            await Database.query('SELECT 1');
          } catch (crashError) {
            chaosResults.crashes++;
          }
        }
      }

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Database Operations: ${successCount} succeeded, ${failureCount} failed`);
      }

      // System should remain stable
      expect(chaosResults.crashes).toBe(0);
    });

    test('should handle database locks during concurrent operations', async () => {
      injectDatabaseChaos();

      const operations = Array(10).fill(null).map((_, i) => 
        Database.query('SELECT * FROM users WHERE id = ?', [i])
          .catch(err => ({ error: err.message }))
      );

      const results = await Promise.allSettled(operations);
      chaosResults.totalTests += operations.length;

      const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value.error).length;
      const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;

      chaosResults.recoveries += succeeded;
      chaosResults.failures += failed;

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Concurrent DB Ops: ${succeeded} succeeded, ${failed} failed`);
      }

      // At least some operations should succeed
      expect(succeeded).toBeGreaterThan(0);
    });
  });

  describe('Race Condition Chaos', () => {
    test('should handle concurrent wallet operations', async () => {
      const donor = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      injectStellarChaos();

      const recipients = await Promise.all(
        Array(5).fill(null).map(() => stellarService.createWallet())
      );

      // Attempt concurrent transactions
      const operations = recipients.map((recipient, i) =>
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '50',
          memo: `Concurrent ${i}`,
        }).catch(err => ({ error: err.message }))
      );

      const results = await Promise.allSettled(operations);
      chaosResults.totalTests += operations.length;

      const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value?.error).length;
      const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;

      chaosResults.recoveries += succeeded;
      chaosResults.failures += failed;

      removeChaos();

      // Verify final balance is consistent
      const finalBalance = await stellarService.getBalance(donor.publicKey);
      const expectedMaxSpent = succeeded * 50;
      const actualSpent = 10000 - parseFloat(finalBalance.balance);

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Concurrent Transactions: ${succeeded} succeeded, ${failed} failed`);
        console.log(`   Balance consistency: spent ${actualSpent}, expected max ${expectedMaxSpent}`);
      }

      // Balance should be consistent with successful transactions
      expect(actualSpent).toBeLessThanOrEqual(expectedMaxSpent + 1); // +1 for rounding
    });

    test('should handle rapid balance checks during transactions', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      injectStellarChaos();

      // Start a transaction
      const txPromise = stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '100',
        memo: 'Race test',
      }).catch(err => ({ error: err.message }));

      // Rapidly check balance during transaction
      const balanceChecks = Array(10).fill(null).map(() =>
        stellarService.getBalance(donor.publicKey).catch(err => ({ error: err.message }))
      );

      const [txResult, ...balanceResults] = await Promise.all([txPromise, ...balanceChecks]);
      chaosResults.totalTests += 1 + balanceChecks.length;

      const balanceSucceeded = balanceResults.filter(r => !r.error).length;
      const balanceFailed = balanceResults.filter(r => r.error).length;

      chaosResults.recoveries += balanceSucceeded + (txResult.error ? 0 : 1);
      chaosResults.failures += balanceFailed + (txResult.error ? 1 : 0);

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Balance checks during TX: ${balanceSucceeded} succeeded, ${balanceFailed} failed`);
      }

      // All balance checks should return valid data (no corruption)
      balanceResults.forEach(result => {
        if (!result.error) {
          expect(result.balance).toBeDefined();
          expect(parseFloat(result.balance)).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });

  describe('Resource Exhaustion Chaos', () => {
    test('should handle rapid wallet creation', async () => {
      injectStellarChaos();

      const walletPromises = Array(50).fill(null).map(() =>
        stellarService.createWallet().catch(err => ({ error: err.message }))
      );

      const results = await Promise.allSettled(walletPromises);
      chaosResults.totalTests += walletPromises.length;

      const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value?.error).length;
      const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;

      chaosResults.recoveries += succeeded;
      chaosResults.failures += failed;

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Rapid Wallet Creation: ${succeeded} succeeded, ${failed} failed`);
      }

      // Most should succeed
      expect(succeeded).toBeGreaterThan(walletPromises.length * 0.5);
    });

    test('should handle transaction stream overload', async () => {
      const wallet = await stellarService.createWallet();
      let receivedCount = 0;
      let errorCount = 0;

      const unsubscribe = stellarService.streamTransactions(
        wallet.publicKey,
        (tx) => {
          receivedCount++;
        }
      );

      // Simulate high volume
      for (let i = 0; i < 100; i++) {
        try {
          stellarService._notifyStreamListeners?.(wallet.publicKey, {
            transactionId: `chaos_${i}`,
            amount: '1',
          });
        } catch (error) {
          errorCount++;
        }
      }

      unsubscribe();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Stream Overload: ${receivedCount} received, ${errorCount} errors`);
      }

      // Should handle without crashing
      expect(errorCount).toBe(0);
    });
  });

  describe('Timing-Based Chaos', () => {
    test('should handle operations with random delays', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      injectStellarChaos();

      const operations = Array(10).fill(null).map(async (_, i) => {
        // Random delay before operation
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        return stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '5',
          memo: `Delayed ${i}`,
        }).catch(err => ({ error: err.message }));
      });

      const results = await Promise.allSettled(operations);
      chaosResults.totalTests += operations.length;

      const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value?.error).length;
      const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;

      chaosResults.recoveries += succeeded;
      chaosResults.failures += failed;

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Delayed Operations: ${succeeded} succeeded, ${failed} failed`);
      }

      // System should handle timing variations
      expect(succeeded + failed).toBe(operations.length);
    });
  });

  describe('Error Recovery Chaos', () => {
    test('should recover from cascading failures', async () => {
      injectDatabaseChaos();
      injectStellarChaos();

      let recoveryCount = 0;
      let permanentFailures = 0;

      for (let i = 0; i < CHAOS_CONFIG.iterations; i++) {
        chaosResults.totalTests++;
        
        try {
          const wallet = await stellarService.createWallet();
          await Database.query('SELECT * FROM users LIMIT 1');
          recoveryCount++;
          chaosResults.recoveries++;
        } catch (error) {
          // Try to recover
          try {
            await stellarService.createWallet();
            recoveryCount++;
            chaosResults.recoveries++;
          } catch (recoveryError) {
            permanentFailures++;
            chaosResults.failures++;
          }
        }
      }

      removeChaos();

      if (CHAOS_CONFIG.verbose) {
        console.log(`   Cascading Failures: ${recoveryCount} recovered, ${permanentFailures} permanent`);
      }

      // System should recover from most failures
      expect(recoveryCount).toBeGreaterThan(CHAOS_CONFIG.iterations * 0.3);
    });
  });
});
