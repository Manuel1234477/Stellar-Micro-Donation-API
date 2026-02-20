/**
 * Memo Integration Tests
 * End-to-end tests for memo functionality in donations
 */

const MockStellarService = require('../src/services/MockStellarService');

describe('Memo Integration Tests', () => {
  let stellarService;

  beforeEach(() => {
    stellarService = new MockStellarService();
  });

  describe('Donation with memo', () => {
    test('should create donation with valid memo', async () => {
      // Create wallets
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      // Fund wallets
      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      // Send donation with memo
      const result = await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '10.0',
        memo: 'For education'
      });

      expect(result.transactionId).toBeDefined();
      expect(result.ledger).toBeDefined();

      // Verify transaction includes memo
      const verification = await stellarService.verifyTransaction(result.transactionId);
      expect(verification.verified).toBe(true);
      expect(verification.transaction.memo).toBe('For education');
    });

    test('should create donation with empty memo', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      // Send donation without memo
      const result = await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '5.0'
      });

      expect(result.transactionId).toBeDefined();

      // Verify transaction has empty memo
      const verification = await stellarService.verifyTransaction(result.transactionId);
      expect(verification.transaction.memo).toBe('');
    });

    test('should handle memo with special characters', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      const memo = 'Donation #123 @charity';
      const result = await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '15.0',
        memo
      });

      const verification = await stellarService.verifyTransaction(result.transactionId);
      expect(verification.transaction.memo).toBe(memo);
    });

    test('should retrieve transaction history with memos', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      // Send multiple donations with different memos
      await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '10.0',
        memo: 'First donation'
      });

      await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '20.0',
        memo: 'Second donation'
      });

      // Get transaction history
      const history = await stellarService.getTransactionHistory(donor.publicKey);
      
      expect(history.length).toBe(2);
      expect(history[0].memo).toBe('Second donation');
      expect(history[1].memo).toBe('First donation');
    });

    test('should handle memo in streamed transactions', (done) => {
      stellarService.createWallet().then(donor => {
        stellarService.createWallet().then(recipient => {
          stellarService.fundTestnetWallet(donor.publicKey).then(() => {
            stellarService.fundTestnetWallet(recipient.publicKey).then(() => {
              
              // Set up stream listener
              const unsubscribe = stellarService.streamTransactions(
                recipient.publicKey,
                (transaction) => {
                  expect(transaction.memo).toBe('Streamed donation');
                  unsubscribe();
                  done();
                }
              );

              // Send donation
              stellarService.sendDonation({
                sourceSecret: donor.secretKey,
                destinationPublic: recipient.publicKey,
                amount: '5.0',
                memo: 'Streamed donation'
              });
            });
          });
        });
      });
    });
  });

  describe('Memo edge cases', () => {
    test('should handle maximum length memo (28 bytes)', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      const maxMemo = 'a'.repeat(28);
      const result = await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '10.0',
        memo: maxMemo
      });

      const verification = await stellarService.verifyTransaction(result.transactionId);
      expect(verification.transaction.memo).toBe(maxMemo);
    });

    test('should handle memo with whitespace', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      const result = await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '10.0',
        memo: '  test  '
      });

      const verification = await stellarService.verifyTransaction(result.transactionId);
      // Memo should be stored as-is (trimming happens at API layer)
      expect(verification.transaction.memo).toBe('  test  ');
    });
  });
});
