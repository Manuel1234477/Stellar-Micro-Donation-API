const MockStellarService = require('../src/services/MockStellarService');

describe('Inflation Destination', () => {
  let stellar, wallet;

  beforeAll(async () => {
    stellar = new MockStellarService();
    wallet = await stellar.createWallet();
  });

  test('Set a valid inflation destination', async () => {
    const destWallet = await stellar.createWallet();
    const result = await stellar.setInflationDestination(wallet.secretKey, destWallet.publicKey);
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('ledger');
    const inflationDest = await stellar.getInflationDestination(wallet.publicKey);
    expect(inflationDest).toBe(destWallet.publicKey);
  });

  test('Getting inflation destination returns current value', async () => {
    const destWallet = await stellar.createWallet();
    await stellar.setInflationDestination(wallet.secretKey, destWallet.publicKey);
    const inflationDest = await stellar.getInflationDestination(wallet.publicKey);
    expect(inflationDest).toBe(destWallet.publicKey);
  });

  test('Invalid public key returns 400', async () => {
    await expect(stellar.setInflationDestination(wallet.secretKey, 'INVALID')).rejects.toThrow();
    await expect(stellar.getInflationDestination('INVALID')).rejects.toThrow();
  });

  test('Unauthorized request returns error', async () => {
    const destWallet = await stellar.createWallet();
    const fakeSecret = 'S' + 'A'.repeat(55);
    await expect(stellar.setInflationDestination(fakeSecret, destWallet.publicKey)).rejects.toThrow();
  });

  test('MockStellarService tracks state changes', async () => {
    const destWallet = await stellar.createWallet();
    await stellar.setInflationDestination(wallet.secretKey, destWallet.publicKey);
    const inflationDest = await stellar.getInflationDestination(wallet.publicKey);
    expect(inflationDest).toBe(destWallet.publicKey);
  });
});
