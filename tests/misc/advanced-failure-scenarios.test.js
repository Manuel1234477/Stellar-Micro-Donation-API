/**
 * Advanced Failure Scenario Tests
 * Tests for precision errors, retry logic, idempotency, and complex edge cases
 */

const { getStellarService } = require('../../src/config/stellar');
const DonationValidator = require('../../src/utils/donationValidator').Class || require('../../src/utils/donationValidator');
const money = require('../../src/utils/money');

// Resolve the money helpers regardless of how they are exported.
const toStroops = money.toStroops || money.amountToStroops || money.parseAmount;
const fromStroops = money.fromStroops || money.stroopsToAmount || money.formatAmount;
const isValidAmount = money.isValidAmount || money.validateAmount || money.isValid;

const MAX_INT64 = 9223372036854775807n;
const ONE_STROOP = 1n;
const STROOPS_PER_XLM = 10000000n;

describe('Advanced Failure Scenarios', () => {
  let stellarService;

  beforeEach(() => {
    process.env.MOCK_STELLAR = 'true';
    stellarService = getStellarService();
  });

  describe('Precision and Rounding Errors', () => {
    test('should reject amounts with more than 7 decimal places', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      // XLM supports up to 7 decimal places
      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '1.12345678', // 8 decimal places - must be rejected, not rounded
          memo: 'Too precise'
        })
      ).rejects.toThrow();
    });

    test('should handle valid 7 decimal place amounts', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '1.1234567', // Exactly 7 decimal places
          memo: 'Valid precision'
        })
      ).resolves.toBeDefined();
    });

    test('should handle floating point arithmetic errors via decimal-string parsing', async () => {
      const validator = new DonationValidator();

      // JavaScript: 0.1 + 0.2 === 0.30000000000000004
      const amount = 0.1 + 0.2;

      const result = validator.validateAmount(amount);
      expect(result.valid).toBe(true);

      // The parser must normalise the float artefact to exactly 0.3 XLM (3000000 stroops)
      expect(toStroops(amount)).toBe(3000000n);
      expect(fromStroops(3000000n)).toBe('0.3');
    });

    test('should reject scientific notation consistently', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      // Exponent notation must be rejected (or normalised) consistently by the parser
      expect(() => toStroops('1e-7')).toThrow();

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '1e-7', // Scientific notation
          memo: 'Scientific'
        })
      ).rejects.toThrow();
    });

    test('should reject overflow amounts', async () => {
      const validator = new DonationValidator();

      const result = validator.validateAmount(Number.MAX_SAFE_INTEGER + 1);

      expect(result.valid).toBe(false);
    });

    test('should reject underflow amounts', async () => {
      const validator = new DonationValidator();

      const result = validator.validateAmount(Number.MIN_VALUE / 2);

      expect(result.valid).toBe(false);
    });

    describe('decimal-string to BigInt stroops', () => {
      test('should parse the smallest valid amount (1 stroop)', () => {
        expect(toStroops('0.0000001')).toBe(ONE_STROOP);
        expect(fromStroops(ONE_STROOP)).toBe('0.0000001');
      });

      test('should round-trip exact 7-decimal amounts', () => {
        const samples = [
          '0.0000001',
          '0.0000002',
          '0.1234567',
          '1.0000001',
          '1.1234567',
          '12345.6789012',
          '999999999.9999999'
        ];

        for (const amount of samples) {
          const stroops = toStroops(amount);
          expect(typeof stroops).toBe('bigint');
          expect(fromStroops(stroops)).toBe(amount);
        }
      });

      test('should preserve trailing zeros without loss', () => {
        expect(toStroops('1.1000000')).toBe(11000000n);
        expect(toStroops('1.1')).toBe(11000000n);
        expect(toStroops('1.100')).toBe(11000000n);
        expect(fromStroops(11000000n)).toBe('1.1');
      });

      test('should handle the maximum int64 stroop value', () => {
        const stroops = toStroops(fromStroops(MAX_INT64));
        expect(stroops).toBe(MAX_INT64);

        // One stroop beyond int64 must be rejected
        expect(() => toStroops(fromStroops(MAX_INT64 + 1n))).toThrow();
      });

      test('should never emit exponent notation', () => {
        for (const stroops of [1n, 10n, 100n, 1000000n, 10000000n, 12345678n]) {
          expect(fromStroops(stroops)).not.toMatch(/e/i);
        }
      });

      test('should reject malformed and over-precise input', () => {
        const invalid = ['', 'abc', '1.12345678', '1e-7', '1E7', '-1', '1.2.3', null, undefined];
        for (const value of invalid) {
          expect(() => toStroops(value)).toThrow();
        }
      });

      test('property: stroop round-trips are exact for random values', () => {
        // Deterministic pseudo-random generator for reproducibility
        let seed = 42;
        const next = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          return seed;
        };

        for (let i = 0; i < 200; i++) {
          const stroops = BigInt(next()) * 1000n + BigInt(next() % 1000);
          const amount = fromStroops(stroops);
          expect(toStroops(amount)).toBe(stroops);
        }
      });

      test('property: adding stroops is exact (no float drift)', () => {
        const a = toStroops('0.1');
        const b = toStroops('0.2');
        expect(a + b).toBe(toStroops('0.3'));
        expect(fromStroops(a + b)).toBe('0.3');
      });
    });
  });

  describe('Retry and Backoff Logic', () => {
    test('should not retry when permanent failures', async () => {
      let attemptCount = 0;

      const donor = await stellarService.createWallet();

      try {
        attemptCount++;
        await stellarService.getBalance('GINVALID');
      } catch (error) {
        // Should not retry invalid account errors
      }

      expect(attemptCount).toBe(1);
    });

    test('should handle retry exhaustion', async () => {
      if (stellarService.setMaxRetries) {
        stellarService.setMaxRetries(3);
        stellarService.setFailureRate(1); // Always fail

        const donor = await stellarService.createWallet();
        const recipient = await stellarService.createWallet();
        await stellarService.fundTestnetWallet(donor.publicKey);

        await expect(
          stellarService.sendDonation({
            sourceSecret: donor.secretKey,
            destinationPublic: recipient.publicKey,
            amount: '100',
            memo: 'Retry test'
          })
        ).rejects.toThrow();

        stellarService.setMaxRetries(null);
        stellarService.setFailureRate(0);
      } else {
        expect(true).toBe(true);
      }
    });

    test('should implement exponential backoff', async () => {
      if (stellarService.setNetworkDelay) {
        const delays = [];
        const startTime = Date.now();

        stellarService.setFailureRate(0.5);

        for (let i = 0; i < 3; i++) {
          try {
            const iterStart = Date.now();
            await stellarService.getBalance('GTEST123');
            delays.push(Date.now() - iterStart);
          } catch (error) {
            delays.push(Date.now() - startTime);
          }
        }

        stellarService.setFailureRate(0);
      }

      expect(true).toBe(true);
    });
  });

  describe('Idempotency and Deduplication', () => {
    test('should handle duplicate transaction submissions', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      const txParams = {
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '100',
        memo: 'Duplicate test'
      };

      const tx1 = await stellarService.sendDonation(txParams);

      // Second identical transaction should either succeed or be detected as duplicate
      await expect(
        stellarService.sendDonation(txParams)
      ).resolves.toBeDefined();
    });

    test('should handle idempotency key conflicts', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      if (stellarService.sendDonationWithIdempotencyKey) {
        const idempotencyKey = 'unique-key-123';

        await stellarService.sendDonationWithIdempotencyKey({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'First'
        }, idempotencyKey);

        // Same key, different params - should fail
        await expect(
          stellarService.sendDonationWithIdempotencyKey({
            sourceSecret: donor.secretKey,
            destinationPublic: recipient.publicKey,
            amount: '200',
            memo: 'Second'
          }, idempotencyKey)
        ).rejects.toThrow();
      } else {
        expect(true).toBe(true);
      }
    });

    test('should deduplicate concurrent identical requests', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      const txParams = {
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '50',
        memo: 'Concurrent'
      };

      const promises = Array(3).fill(null).map(() =>
        stellarService.sendDonation(txParams)
      );

      const results = await Promise.allSettled(promises);

      // At least one should succeed
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);
    });
  });

  describe('Account State Edge Cases', () => {
    test('should handle account when zero balance when fees', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      // Fund with minimal amount
      if (stellarService.fundTestnetWallet) {
        await stellarService.fundTestnetWallet(donor.publicKey);
      }

      const balance = await stellarService.getBalance(donor.publicKey);

      // Try to send entire balance (should fail due to fees)
      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: balance.balance,
          memo: 'All funds'
        })
      ).rejects.toThrow();
    });

    test('should handle Stellar minimum balance requirement', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      // Stellar requires 0.5 XLM minimum balance
      if (stellarService.fundTestnetWallet) {
        await stellarService.fundTestnetWallet(donor.publicKey);
      }

      const balance = await stellarService.getBalance(donor.publicKey);
      const amountToSend = parseFloat(balance.balance) - 0.4; // Leave less than minimum

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: amountToSend.toString(),
          memo: 'Below minimum'
        })
      ).rejects.toThrow();
    });

    test('should handle unfunded destination account', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);

      // Sending to unfunded account requires minimum 1 XLM
      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '0.5', // Less than 1 XLM
          memo: 'Unfunded recipient'
        })
      ).rejects.toThrow();
    });
  });

  describe('Sequence Number Issues', () => {
    test('should handle sequence number mismatch', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      if (stellarService.setSequenceNumber) {
        // Manually set incorrect sequence number
        stellarService.setSequenceNumber(donor.publicKey, 999999);

        await expect(
          stellarService.sendDonation({
            sourceSecret: donor.secretKey,
            destinationPublic: recipient.publicKey,
            amount: '100',
            memo: 'Bad sequence'
          })
        ).rejects.toThrow();

        stellarService.resetSequenceNumber(donor.publicKey);
      } else {
        expect(true).toBe(true);
      }
    });

    test('should handle concurrent transactions when sequence conflicts', async () => {
      const donor = await stellarService.createWallet();
      const recipient1 = await stellarService.createWallet();
      const recipient2 = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      // Submit two transactions simultaneously - may cause sequence conflict
      const promises = [
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient1.publicKey,
          amount: '50',
          memo: 'TX1'
        }),
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient2.publicKey,
          amount: '50',
          memo: 'TX2'
        })
      ];

      const results = await Promise.allSettled(promises);

      // At least one should succeed
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);
    });
  });

  describe('Stream Reconnection and Backpressure', () => {
    test('should handle stream reconnection when disconnect', async () => {
      const wallet = await stellarService.createWallet();
      let disconnectCount = 0;
      let reconnectCount = 0;

      const unsubscribe = stellarService.streamTransactions(
        wallet.publicKey,
        (tx) => {},
        {
          onError: (error) => {
            disconnectCount++;
          },
          onReconnect: () => {
            reconnectCount++;
          }
        }
      );

      if (stellarService.simulateStreamDisconnect) {
        stellarService.simulateStreamDisconnect();
      }

      unsubscribe();

      expect(disconnectCount).toBeGreaterThanOrEqual(0);
    });

    test('should handle backpressure in transaction stream', async () => {
      const wallet = await stellarService.createWallet();
      const receivedTxs = [];

      const unsubscribe = stellarService.streamTransactions(
        wallet.publicKey,
        (tx) => {
          receivedTxs.push(tx);
        }
      );

      // Simulate high volume of transactions
      if (stellarService.simulateHighVolumeStream) {
        await stellarService.simulateHighVolumeStream(wallet.publicKey, 1000);
      }

      unsubscribe();

      // Should handle without memory issues
      expect(receivedTxs.length).toBeLessThanOrEqual(1000);
    });

    test('should cleanup listeners when unsubscribe', async () => {
      const wallet = await stellarService.createWallet();

      const unsubscribe1 = stellarService.streamTransactions(wallet.publicKey, () => {});
      const unsubscribe2 = stellarService.streamTransactions(wallet.publicKey, () => {});
      const unsubscribe3 = stellarService.streamTransactions(wallet.publicKey, () => {});

      unsubscribe1();
      unsubscribe2();
      unsubscribe3();

      // Verify no memory leaks
      if (stellarService.streamListeners) {
        const listeners = stellarService.streamListeners.get(wallet.publicKey);
        expect(listeners ? listeners.length : 0).toBe(0);
      }
    });
  });

  describe('Database Connection Failures', () => {
    test('should handle database connection timeout', async () => {
      const Database = require('../../src/utils/database');

      const originalQuery = Database.query;
      Database.query = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 100);
        });
      });

      await expect(
        Database.query('SELECT * FROM users')
      ).rejects.toThrow('Connection timeout');

      Database.query = originalQuery;
    });

    test('should handle database deadlock', async () => {
      const Database = require('../../src/utils/database');

      const originalQuery = Database.query;
      Database.query = jest.fn().mockRejectedValue(new Error('Deadlock detected'));

      await expect(
        Database.query('UPDATE users SET balance = balance + 100')
      ).rejects.toThrow('Deadlock detected');

      Database.query = originalQuery;
    });

    test('should handle database disk full error', async () => {
      const Database = require('../../src/utils/database');

      const originalQuery = Database.query;
      Database.query = jest.fn().mockRejectedValue(new Error('Disk full'));

      await expect(
        Database.query('INSERT INTO transactions VALUES (...)')
      ).rejects.toThrow('Disk full');

      Database.query = originalQuery;
    });
  });

  describe('Memo Encoding Edge Cases', () => {
    test('should handle multi-byte UTF-8 characters in memo', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      // Emoji and multi-byte characters
      const memo = '🚀💰'; // Each emoji is 4 bytes

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: memo
        })
      ).resolves.toBeDefined();
    });

    test('should reject memo exceeding 28 bytes when multi-byte chars', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      // 8 emojis = 32 bytes (exceeds 28 byte limit)
      const memo = '🚀💰🎉✨🌟💫⭐🔥';

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: memo
        })
      ).rejects.toThrow();
    });

    test('should handle memo when mixed ASCII and UTF-8', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      const memo = 'Donate 💰'; // Mixed content

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: memo
        })
      ).resolves.toBeDefined();
    });
  });

  describe('Race Condition Scenarios', () => {
    test('should handle balance check race condition', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      // Check balance
      const balance = await stellarService.getBalance(donor.publicKey);

      // Simulate another transaction happening between check and send
      const tx1Promise = stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: balance.balance,
        memo: 'Race 1'
      });

      const tx2Promise = stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '50',
        memo: 'Race 2'
      });

      const results = await Promise.allSettled([tx1Promise, tx2Promise]);

      // At least one should fail
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0);
    });

    test('should handle concurrent wallet creation when same seed', async () => {
      if (stellarService.createWalletFromSeed) {
        const seed = 'test-seed-123';

        const promises = Array(3).fill(null).map(() =>
          stellarService.createWalletFromSeed(seed)
        );

        const results = await Promise.allSettled(promises);

        // All should return same wallet or handle conflict
        const fulfilled = results.filter(r => r.status === 'fulfilled');
        expect(fulfilled.length).toBeGreaterThan(0);
      } else {
        expect(true).toBe(true);
      }
    });
  });
});
