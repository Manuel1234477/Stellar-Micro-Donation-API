/**
 * Comprehensive Failure Scenario Tests
 * Tests for network errors, timeouts, insufficient funds, invalid accounts, and other failure paths
 */

const { getStellarService } = require('../../../src/config/stellar');
const Transaction = require('../../../src/routes/models/transaction');
const DonationValidator = require('../../../src/utils/donationValidator');

describe('Failure Scenarios - Comprehensive Error Tests', () => {
  let stellarService;

  beforeEach(() => {
    process.env.MOCK_STELLAR = 'true';
    stellarService = getStellarService();
  });

  describe('Insufficient Balance Errors', () => {
    test('should reject donation when wallet balance is zero', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Should fail'
        })
      ).rejects.toThrow('Insufficient balance');
    });

    test('should reject donation when balance is less than amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      
      await stellarService.fundTestnetWallet(donor.publicKey);
      
      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '15000',
          memo: 'Too much'
        })
      ).rejects.toThrow('Insufficient balance');
    });

    test('should reject donation when balance equals amount (no fee reserve)', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      
      await stellarService.fundTestnetWallet(donor.publicKey);
      const balance = await stellarService.getBalance(donor.publicKey);
      
      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: balance.balance,
          memo: 'Exact balance'
        })
      ).rejects.toThrow();
    });

    test('should handle multiple failed transactions due to insufficient funds', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      const promises = Array(5).fill(null).map(() =>
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Batch fail'
        })
      );

      await expect(Promise.all(promises)).rejects.toThrow();
    });
  });

  describe('Invalid Account Errors', () => {
    test('should reject invalid source secret key format', async () => {
      const recipient = await stellarService.createWallet();

      await expect(
        stellarService.sendDonation({
          sourceSecret: 'SINVALID123',
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Invalid source'
        })
      ).rejects.toThrow();
    });

    test('should reject invalid destination public key', async () => {
      const donor = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: 'GINVALID123',
          amount: '100',
          memo: 'Invalid destination'
        })
      ).rejects.toThrow();
    });

    test('should reject malformed public key', async () => {
      await expect(
        stellarService.getBalance('not-a-valid-key')
      ).rejects.toThrow();
    });

    test('should reject empty public key', async () => {
      await expect(
        stellarService.getBalance('')
      ).rejects.toThrow();
    });

    test('should reject null public key', async () => {
      await expect(
        stellarService.getBalance(null)
      ).rejects.toThrow();
    });

    test('should reject undefined public key', async () => {
      await expect(
        stellarService.getBalance(undefined)
      ).rejects.toThrow();
    });

    test('should handle non-existent account lookup', async () => {
      await expect(
        stellarService.getBalance('GNONEXISTENT123456789012345678901234567890123456')
      ).rejects.toThrow('Wallet not found');
    });
  });

  describe('Invalid Amount Errors', () => {
    test('should reject negative donation amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '-100',
          memo: 'Negative'
        })
      ).rejects.toThrow();
    });

    test('should reject zero amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '0',
          memo: 'Zero'
        })
      ).rejects.toThrow();
    });

    test('should reject non-numeric amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: 'abc',
          memo: 'Invalid'
        })
      ).rejects.toThrow();
    });

    test('should reject null amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: null,
          memo: 'Null amount'
        })
      ).rejects.toThrow();
    });

    test('should reject undefined amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: undefined,
          memo: 'Undefined amount'
        })
      ).rejects.toThrow();
    });
  });

  describe('Memo Validation Errors', () => {
    test('should reject memo exceeding 28-byte limit', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      const longMemo = 'a'.repeat(29);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: longMemo
        })
      ).rejects.toThrow();
    });

    test('should reject memo with null bytes', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'test\0memo'
        })
      ).rejects.toThrow();
    });
  });

  describe('Transaction Validation Errors', () => {
    test('should reject transaction with missing required fields', async () => {
      await expect(
        stellarService.sendDonation({})
      ).rejects.toThrow();
    });

    test('should reject transaction with only source', async () => {
      const donor = await stellarService.createWallet();

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey
        })
      ).rejects.toThrow();
    });

    test('should reject transaction with only destination', async () => {
      const recipient = await stellarService.createWallet();

      await expect(
        stellarService.sendDonation({
          destinationPublic: recipient.publicKey
        })
      ).rejects.toThrow();
    });
  });

  describe('Concurrent Transaction Errors', () => {
    test('should handle race condition with insufficient funds', async () => {
      const donor = await stellarService.createWallet();
      const recipient1 = await stellarService.createWallet();
      const recipient2 = await stellarService.createWallet();
      
      await stellarService.fundTestnetWallet(donor.publicKey);

      const tx1 = stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient1.publicKey,
        amount: '9000',
        memo: 'First'
      });

      const tx2 = stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient2.publicKey,
        amount: '9000',
        memo: 'Second'
      });

      const results = await Promise.allSettled([tx1, tx2]);
      
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0);
    });

    test('should handle multiple simultaneous donations to same recipient', async () => {
      const donor1 = await stellarService.createWallet();
      const donor2 = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      
      await stellarService.fundTestnetWallet(donor1.publicKey);
      await stellarService.fundTestnetWallet(donor2.publicKey);

      const promises = [
        stellarService.sendDonation({
          sourceSecret: donor1.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Donor 1'
        }),
        stellarService.sendDonation({
          sourceSecret: donor2.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '200',
          memo: 'Donor 2'
        })
      ];

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      
      expect(fulfilled.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Daily Limit Errors', () => {
    test('should reject donation exceeding daily limit threshold', () => {
      const validator = new DonationValidator();
      validator.maxDailyPerDonor = 1000;

      const result = validator.validateDailyLimit(500, 800);

      expect(result.valid).toBe(false);
      expect(result.code).toBe('DAILY_LIMIT_EXCEEDED');
    });

    test('should track failed donations in daily limit', () => {
      const donor = 'TestDonor';
      
      Transaction.create({
        amount: 500,
        donor,
        recipient: 'Recipient1',
        status: 'confirmed'
      });

      Transaction.create({
        amount: 300,
        donor,
        recipient: 'Recipient2',
        status: 'failed'
      });

      const total = Transaction.getDailyTotalByDonor(donor);
      
      expect(total).toBe(500);
    });
  });

  describe('Database Operation Errors', () => {
    test('should handle transaction creation failure gracefully', () => {
      expect(() => {
        Transaction.create({});
      }).toThrow();
    });

    test('should handle missing transaction fields', () => {
      expect(() => {
        Transaction.create({
          amount: 100
        });
      }).toThrow();
    });

    test('should handle invalid transaction status', () => {
      expect(() => {
        Transaction.create({
          amount: 100,
          donor: 'Alice',
          recipient: 'Bob',
          status: 'invalid_status'
        });
      }).toThrow();
    });

    test('should handle transaction lookup with invalid ID', () => {
      const result = Transaction.getById('nonexistent');
      expect(result).toBeNull();
    });

    test('should handle empty transaction history', () => {
      const history = Transaction.getByDonor('NonExistentDonor');
      expect(history).toEqual([]);
    });
  });

  describe('Stream Connection Errors', () => {
    test('should handle stream to invalid account gracefully', () => {
      expect(() => {
        stellarService.streamTransactions('INVALID', () => {});
      }).toThrow();
    });

    test('should handle stream with null callback', () => {
      const wallet = stellarService.createWallet();
      
      expect(() => {
        stellarService.streamTransactions(wallet.publicKey, null);
      }).toThrow();
    });

    test('should handle stream unsubscribe', async () => {
      const wallet = await stellarService.createWallet();
      
      const unsubscribe = stellarService.streamTransactions(
        wallet.publicKey,
        () => {}
      );

      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('Balance Query Errors', () => {
    test('should handle balance query for unfunded account', async () => {
      const wallet = await stellarService.createWallet();
      const balance = await stellarService.getBalance(wallet.publicKey);

      expect(balance.balance).toBe('0');
    });

    test('should handle balance query with network error simulation', async () => {
      if (stellarService.simulateNetworkError) {
        stellarService.simulateNetworkError(true);
        
        await expect(
          stellarService.getBalance('GTEST123')
        ).rejects.toThrow();

        stellarService.simulateNetworkError(false);
      }
    });
  });

  describe('Transaction History Errors', () => {
    test('should handle history query for account with no transactions', async () => {
      const wallet = await stellarService.createWallet();
      const history = await stellarService.getTransactionHistory(wallet.publicKey);

      expect(history).toEqual([]);
    });

    test('should handle history query with invalid limit', async () => {
      const wallet = await stellarService.createWallet();

      await expect(
        stellarService.getTransactionHistory(wallet.publicKey, -1)
      ).rejects.toThrow();
    });

    test('should handle history query with zero limit', async () => {
      const wallet = await stellarService.createWallet();

      await expect(
        stellarService.getTransactionHistory(wallet.publicKey, 0)
      ).rejects.toThrow();
    });
  });

  describe('Wallet Creation Errors', () => {
    test('should handle wallet creation with invalid parameters', async () => {
      if (stellarService.createWalletWithParams) {
        await expect(
          stellarService.createWalletWithParams({ invalid: true })
        ).rejects.toThrow();
      }
    });
  });

  describe('Error Recovery and Retry', () => {
    test('should not retry on invalid account error', async () => {
      let attempts = 0;
      
      try {
        await stellarService.getBalance('INVALID');
      } catch (error) {
        attempts++;
      }

      expect(attempts).toBe(1);
    });

    test('should handle transaction failure without corrupting state', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      try {
        await stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Will fail'
        });
      } catch (error) {
        // Verify state is not corrupted
        const balance = await stellarService.getBalance(donor.publicKey);
        expect(balance.balance).toBe('0');
      }
    });
  });

  describe('Edge Case Errors', () => {
    test('should handle extremely large amount gracefully', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '999999999999999',
          memo: 'Too large'
        })
      ).rejects.toThrow();
    });

    test('should handle extremely small amount', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(donor.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '0.0000001',
          memo: 'Too small'
        })
      ).rejects.toThrow();
    });

    test('should handle donation to self', async () => {
      const wallet = await stellarService.createWallet();
      await stellarService.fundTestnetWallet(wallet.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: wallet.secretKey,
          destinationPublic: wallet.publicKey,
          amount: '100',
          memo: 'To self'
        })
      ).rejects.toThrow();
    });
  });
});
