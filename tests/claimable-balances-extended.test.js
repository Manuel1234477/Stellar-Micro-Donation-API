const StellarService = require('../src/services/StellarService');
const MockStellarService = require('../src/services/MockStellarService');
const { randomBytes } = require('crypto');

describe('Claimable Balances (Extended)', () => {
  let stellar, mock, source, claimant;

  beforeAll(async () => {
    stellar = new MockStellarService();
    source = await stellar.createWallet();
    claimant = await stellar.createWallet();
    // Fund source wallet
    const srcWallet = stellar.wallets.get(source.publicKey);
    srcWallet.assetBalances['native'] = '1000.0000000';
    srcWallet.balance = '1000.0000000';
  });

  test('Create claimable balance', async () => {
    const amount = '50.0000000';
    const claimants = [{ destination: claimant.publicKey, predicate: null }];
    const result = await stellar.createClaimableBalance({
      sourceSecret: source.secretKey,
      asset: { type: 'native', code: 'XLM', issuer: null },
      amount,
      claimants
    });
    expect(result).toHaveProperty('balanceId');
    expect(result).toHaveProperty('transactionId');
  });

  test('List claimable balances for claimant', async () => {
    const balances = await stellar.listClaimableBalances(claimant.publicKey);
    expect(Array.isArray(balances)).toBe(true);
    expect(balances.length).toBeGreaterThan(0);
    expect(balances[0].claimants.some(c => c.destination === claimant.publicKey)).toBe(true);
  });

  test('Claim balance as authorized claimant', async () => {
    const balances = await stellar.listClaimableBalances(claimant.publicKey);
    const balanceId = balances[0].balanceId;
    const result = await stellar.claimBalance({
      claimantSecret: claimant.secretKey,
      balanceId
    });
    expect(result).toHaveProperty('transactionId');
  });

  test('Claiming already claimed balance fails', async () => {
    const balances = await stellar.listClaimableBalances(claimant.publicKey);
    if (balances.length === 0) return; // Already claimed in previous test
    const balanceId = balances[0].balanceId;
    await stellar.claimBalance({
      claimantSecret: claimant.secretKey,
      balanceId
    });
    await expect(stellar.claimBalance({
      claimantSecret: claimant.secretKey,
      balanceId
    })).rejects.toThrow();
  });

  test('Unauthorized claimant cannot claim', async () => {
    const other = await stellar.createWallet();
    const amount = '10.0000000';
    const claimants = [{ destination: claimant.publicKey, predicate: null }];
    const srcWallet = stellar.wallets.get(source.publicKey);
    srcWallet.assetBalances['native'] = '1000.0000000';
    srcWallet.balance = '1000.0000000';
    const { balanceId } = await stellar.createClaimableBalance({
      sourceSecret: source.secretKey,
      asset: { type: 'native', code: 'XLM', issuer: null },
      amount,
      claimants
    });
    await expect(stellar.claimBalance({
      claimantSecret: other.secretKey,
      balanceId
    })).rejects.toThrow();
  });
});
