const MockStellarService = require('../../src/services/MockStellarService');
const { resetMockStellarService } = require('../helpers/testIsolation');

describe('MockStellarService interface compliance', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  afterEach(() => {
    resetMockStellarService(service);
  });

  test('isValidAddress should validate Stellar public keys', () => {
    expect(service.isValidAddress('GABCDEFGHIJKLMNOPQRSTUVWXY23456789012345678901234567890')).toBe(false); // short
    const valid = 'G' + 'A'.repeat(55);
    expect(service.isValidAddress(valid)).toBe(true);
  });

  test('loadAccount should return account object and throw not found', async () => {
    const wallet = await service.createWallet();
    const account = await service.loadAccount(wallet.publicKey);

    expect(account.accountId()).toBe(wallet.publicKey);
    expect(account.sequenceNumber()).toBe('0');
    expect(Array.isArray(account.balances)).toBe(true);
    await expect(service.loadAccount('G' + 'A'.repeat(55))).rejects.toThrow('Account not found');
  });

  test('getAccountSequence should return mocked sequence', async () => {
    const wallet = await service.createWallet();
    await service.fundTestnetWallet(wallet.publicKey);

    const seq = await service.getAccountSequence(wallet.publicKey);
    expect(seq).toBe('1');
    await expect(service.getAccountSequence('G' + 'A'.repeat(55))).rejects.toThrow('Account not found');
  });

  test('stroopsToXlm and xlmToStroops conversions should be consistent', () => {
    expect(service.stroopsToXlm('10000000')).toBe('1.0000000');
    expect(service.xlmToStroops('2.5')).toBe('25000000');
    expect(service.stroopsToXlm(service.xlmToStroops('3.1234567'))).toBe('3.1234567');
  });

  test('buildTransaction and buildPaymentTransaction should return objects', async () => {
    const source = await service.createWallet();
    const destination = await service.createWallet();

    const tx = await service.buildTransaction(source.publicKey, [{ type: 'noop' }], { memo: 'test' });
    expect(tx.sourcePublicKey).toBe(source.publicKey);
    expect(tx.operations.length).toBe(1);

    const ptx = await service.buildPaymentTransaction(source.publicKey, destination.publicKey, '10', { memo: 'send' });
    expect(ptx.operations[0].type).toBe('payment');
    expect(ptx.operations[0].destination).toBe(destination.publicKey);
  });

  test('signTransaction should produce signature and hash without crypto operations', async () => {
    const tx = { some: 'transaction' };
    const signed = await service.signTransaction(tx, 'S' + 'A'.repeat(55));
    expect(signed.signature).toMatch(/^mock_sign_/);
    expect(signed.hash).toMatch(/^mock_hash_/);
  });

  test('submitTransaction should succeed and allow failure flag', async () => {
    const result = await service.submitTransaction({ any: 'payload' });
    expect(result.successful).toBe(true);

    service.setSubmitTransactionFailure(true);
    await expect(service.submitTransaction({ any: 'payload' })).rejects.toThrow('Mock submitTransaction failure');
  });

  test('getAccountBalances should mirror existing getBalance results', async () => {
    const wallet = await service.createWallet();
    await service.fundTestnetWallet(wallet.publicKey);

    const balances = await service.getAccountBalances(wallet.publicKey);
    expect(balances.balances[0].balance).toBe('10000.0000000');

    await expect(service.getAccountBalances('G' + 'A'.repeat(55))).rejects.toThrow('Account not found');
  });

  test('getTransaction should retrieve transaction by Hash/ID and throw when missing', async () => {
    const source = await service.createWallet();
    const dest = await service.createWallet();
    await service.fundTestnetWallet(source.publicKey);
    await service.fundTestnetWallet(dest.publicKey);

    const donation = await service.sendDonation({ sourceSecret: source.secretKey, destinationPublic: dest.publicKey, amount: '1.00', memo: 'txn test' });

    const tx1 = await service.getTransaction(donation.transactionId);
    expect(tx1.transactionId).toBe(donation.transactionId);

    await expect(service.getTransaction('does_not_exist')).rejects.toThrow('Transaction not found');
/**
 * Bug Condition Exploration Test — Property 1
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11
 *
 * PURPOSE: This test MUST FAIL on unfixed code.
 * Failure confirms the bug exists: eleven methods in MockStellarService throw
 * "must be implemented" instead of returning meaningful mock values.
 *
 * DO NOT fix the code when this test fails — the failure is the expected outcome.
 */

const MockStellarService = require('../../src/services/MockStellarService');

// A valid 56-char Stellar public key (G + 55 base32 chars A-Z,2-7 only)
const KNOWN_PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
// A valid 56-char Stellar secret key (S + 55 base32 chars A-Z,2-7 only)
const KNOWN_SECRET_KEY = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const KNOWN_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

describe('Bug Condition Exploration — Unimplemented Methods (Property 1)', () => {
  let service;

  beforeEach(async () => {
    service = new MockStellarService();
    // Create and fund a wallet so account-lookup methods have something to find
    const wallet = await service.createWallet();
    // Overwrite the map entry with our known key so tests are deterministic
    const walletData = service.wallets.get(wallet.publicKey);
    service.wallets.delete(wallet.publicKey);
    service.wallets.set(KNOWN_PUBLIC_KEY, {
      ...walletData,
      publicKey: KNOWN_PUBLIC_KEY,
      secretKey: KNOWN_SECRET_KEY,
      balance: '100.0000000',
      assetBalances: { native: '100.0000000' },
      sequence: '1',
    });
    service.transactions.set(KNOWN_PUBLIC_KEY, []);
  });

  // ── 1.1 loadAccount ──────────────────────────────────────────────────────────
  test('loadAccount returns object with id, sequence, balances (Req 1.1)', async () => {
    const result = await service.loadAccount(KNOWN_PUBLIC_KEY);
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('sequence');
    expect(result).toHaveProperty('balances');
    expect(Array.isArray(result.balances)).toBe(true);
  });

  // ── 1.2 submitTransaction ────────────────────────────────────────────────────
  test('submitTransaction returns object with hash, ledger, status (Req 1.2)', async () => {
    const mockTx = { source: KNOWN_PUBLIC_KEY, _isMockTransaction: true, _signed: true };
    const result = await service.submitTransaction(mockTx);
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('ledger');
    expect(result).toHaveProperty('status');
  });

  // ── 1.3 buildPaymentTransaction ──────────────────────────────────────────────
  test('buildPaymentTransaction returns unsigned mock transaction (Req 1.3)', async () => {
    const dst = 'GBBB2345678901234567890123456789012345678901234567890123';
    const result = await service.buildPaymentTransaction(KNOWN_PUBLIC_KEY, dst, '10', {});
    expect(result._isMockTransaction).toBe(true);
    expect(result._unsigned).toBe(true);
  });

  // ── 1.4 getAccountSequence ───────────────────────────────────────────────────
  test('getAccountSequence returns a string (Req 1.4)', async () => {
    const result = await service.getAccountSequence(KNOWN_PUBLIC_KEY);
    expect(typeof result).toBe('string');
  });

  // ── 1.5 buildTransaction ─────────────────────────────────────────────────────
  test('buildTransaction returns unsigned mock transaction (Req 1.5)', async () => {
    const result = await service.buildTransaction(KNOWN_PUBLIC_KEY, [], {});
    expect(result._isMockTransaction).toBe(true);
    expect(result._unsigned).toBe(true);
  });

  // ── 1.6 signTransaction ──────────────────────────────────────────────────────
  test('signTransaction returns signed transaction (Req 1.6)', async () => {
    const mockTx = { _isMockTransaction: true, _unsigned: true, source: KNOWN_PUBLIC_KEY };
    const result = await service.signTransaction(mockTx, KNOWN_SECRET_KEY);
    expect(result._signed).toBe(true);
  });

  // ── 1.7 getAccountBalances ───────────────────────────────────────────────────
  test('getAccountBalances returns array with asset_type and balance fields (Req 1.7)', async () => {
    const result = await service.getAccountBalances(KNOWN_PUBLIC_KEY);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('asset_type');
    expect(result[0]).toHaveProperty('balance');
  });

  // ── 1.8 getTransaction ───────────────────────────────────────────────────────
  test('getTransaction returns object with hash or transactionId (Req 1.8)', async () => {
    // First submit a transaction so there is something to retrieve
    const mockTx = { source: KNOWN_PUBLIC_KEY, _isMockTransaction: true, _signed: true };
    const submitted = await service.submitTransaction(mockTx);
    const result = await service.getTransaction(submitted.hash);
    const hasIdentifier = result.hash !== undefined || result.transactionId !== undefined;
    expect(hasIdentifier).toBe(true);
  });

  // ── 1.9 isValidAddress ───────────────────────────────────────────────────────
  test('isValidAddress returns true for a valid G-key (Req 1.9)', () => {
    const validKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
    const result = service.isValidAddress(validKey);
    expect(result).toBe(true);
  });

  // ── 1.10 stroopsToXlm ────────────────────────────────────────────────────────
  test("stroopsToXlm(10000000) returns '1.0000000' (Req 1.10)", () => {
    const result = service.stroopsToXlm(10000000);
    expect(result).toBe('1.0000000');
  });

  // ── 1.11 xlmToStroops ────────────────────────────────────────────────────────
  test('xlmToStroops(1) returns 10000000 (Req 1.11)', () => {
    const result = service.xlmToStroops(1);
    expect(result).toBe(10000000);
  });
});

/**
 * Preservation Property Tests — Property 2
 *
 * Validates: Requirements 3.1, 3.2, 3.4, 3.12
 *
 * PURPOSE: These tests MUST PASS on unfixed code.
 * They capture the baseline behavior of already-implemented methods
 * (where isBugCondition returns false) so we can confirm no regressions
 * after the fix is applied.
 *
 * Observation-first: behavior was observed on unfixed code before writing these tests.
 */

describe('Preservation — Already-Implemented Methods (Property 2)', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  // ── 3.1 createWallet preservation ────────────────────────────────────────────
  describe('createWallet() always returns valid keypair', () => {
    test('publicKey starts with G and secretKey starts with S', async () => {
      const wallet = await service.createWallet();
      expect(wallet.publicKey).toMatch(/^G/);
      expect(wallet.secretKey).toMatch(/^S/);
    });

    test('publicKey is exactly 56 characters', async () => {
      const wallet = await service.createWallet();
      expect(wallet.publicKey).toHaveLength(56);
    });

    test('secretKey is exactly 56 characters', async () => {
      const wallet = await service.createWallet();
      expect(wallet.secretKey).toHaveLength(56);
    });

    test('multiple calls always produce G-prefix publicKey and S-prefix secretKey', async () => {
      // Property-based style: run many iterations to cover the random generation space
      for (let i = 0; i < 20; i++) {
        const wallet = await service.createWallet();
        expect(wallet.publicKey[0]).toBe('G');
        expect(wallet.secretKey[0]).toBe('S');
        expect(wallet.publicKey).toHaveLength(56);
        expect(wallet.secretKey).toHaveLength(56);
      }
    });

    test('publicKey contains only valid base32 characters after prefix', async () => {
      const base32Pattern = /^G[A-Z2-7]{55}$/;
      for (let i = 0; i < 10; i++) {
        const wallet = await service.createWallet();
        expect(wallet.publicKey).toMatch(base32Pattern);
      }
    });
  });

  // ── 3.2 getBalance preservation ──────────────────────────────────────────────
  describe('getBalance() always returns numeric balance for known accounts', () => {
    test('returns object with balance and asset fields', async () => {
      const wallet = await service.createWallet();
      const result = await service.getBalance(wallet.publicKey);
      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('asset');
    });

    test('balance is a numeric string (does not throw)', async () => {
      const wallet = await service.createWallet();
      const result = await service.getBalance(wallet.publicKey);
      expect(() => parseFloat(result.balance)).not.toThrow();
      expect(isNaN(parseFloat(result.balance))).toBe(false);
    });

    test('asset is XLM', async () => {
      const wallet = await service.createWallet();
      const result = await service.getBalance(wallet.publicKey);
      expect(result.asset).toBe('XLM');
    });

    test('multiple wallets each return their own numeric balance', async () => {
      // Property-based style: multiple wallets, each should return valid balance
      for (let i = 0; i < 5; i++) {
        const wallet = await service.createWallet();
        const result = await service.getBalance(wallet.publicKey);
        expect(isNaN(parseFloat(result.balance))).toBe(false);
      }
    });
  });

  // ── 3.4 estimateFee preservation ─────────────────────────────────────────────
  describe('estimateFee(n) always returns feeStroops and feeXLM for any positive integer n', () => {
    test('returns feeStroops and feeXLM fields', async () => {
      const result = await service.estimateFee(1);
      expect(result).toHaveProperty('feeStroops');
      expect(result).toHaveProperty('feeXLM');
    });

    test('feeStroops is a positive number', async () => {
      const result = await service.estimateFee(1);
      expect(typeof result.feeStroops).toBe('number');
      expect(result.feeStroops).toBeGreaterThan(0);
    });

    test('feeXLM is a string with 7 decimal places', async () => {
      const result = await service.estimateFee(1);
      expect(typeof result.feeXLM).toBe('string');
      expect(result.feeXLM).toMatch(/^\d+\.\d{7}$/);
    });

    test('property: feeStroops scales linearly with operationCount', async () => {
      // For any positive integer n, feeStroops(n) = n * feeStroops(1)
      const base = await service.estimateFee(1);
      for (const n of [1, 2, 3, 5, 10]) {
        const result = await service.estimateFee(n);
        expect(result.feeStroops).toBe(base.feeStroops * n);
        expect(result).toHaveProperty('feeStroops');
        expect(result).toHaveProperty('feeXLM');
      }
    });

    test('property: feeXLM is consistent with feeStroops (feeStroops / 1e7)', async () => {
      for (const n of [1, 3, 7]) {
        const result = await service.estimateFee(n);
        const expectedXlm = (result.feeStroops / 1e7).toFixed(7);
        expect(result.feeXLM).toBe(expectedXlm);
      }
    });
  });

});

/**
 * Preservation Tests — isValidAddress false cases (Requirement 3.12)
 *
 * Validates: Requirement 3.12
 *
 * NOTE: isValidAddress is one of the eleven unimplemented methods, so these tests
 * WILL FAIL on unfixed code (the method throws "must be implemented").
 * They are written here to capture the required post-fix behavior:
 * invalid addresses must return false WITHOUT throwing.
 *
 * These tests will PASS after the fix is applied (Task 3).
 */
describe('Preservation — isValidAddress false cases (Req 3.12, passes after fix)', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  test("isValidAddress('invalid') returns false", () => {
    expect(service.isValidAddress('invalid')).toBe(false);
  });

  test('wrong prefix (starts with A) returns false', () => {
    const wrongPrefix = 'AABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
    expect(service.isValidAddress(wrongPrefix)).toBe(false);
  });

  test('wrong prefix (starts with S) returns false', () => {
    const secretKey = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
    expect(service.isValidAddress(secretKey)).toBe(false);
  });

  test('wrong length (too short) returns false', () => {
    const tooShort = 'GABC123';
    expect(service.isValidAddress(tooShort)).toBe(false);
  });

  test('wrong length (too long) returns false', () => {
    const tooLong = 'GABC2345678901234567890123456789012345678901234567890123EXTRA';
    expect(service.isValidAddress(tooLong)).toBe(false);
  });

  test('invalid characters (lowercase) returns false', () => {
    const lowercase = 'Gabc2345678901234567890123456789012345678901234567890123';
    expect(service.isValidAddress(lowercase)).toBe(false);
  });

  test('invalid characters (digits 0,1,8,9) returns false', () => {
    // Base32 only allows 2-7; digits 0,1,8,9 are invalid
    const withInvalidDigit = 'G0BC2345678901234567890123456789012345678901234567890123';
    expect(service.isValidAddress(withInvalidDigit)).toBe(false);
  });

  test('property: none of the invalid address variants throw', () => {
    const invalidAddresses = [
      '',
      'invalid',
      'AABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      'GABC123',
      'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWEXTRA',
      'Gabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvw',
    ];
    for (const addr of invalidAddresses) {
      expect(() => service.isValidAddress(addr)).not.toThrow();
      expect(service.isValidAddress(addr)).toBe(false);
    }
  });
});
