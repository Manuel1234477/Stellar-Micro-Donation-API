'use strict';

/**
 * Custom Stellar token donations (#1563)
 * Covers trustline-gated issuance and sendDonation with a non-native asset.
 */

const MockStellarService = require('../../src/services/MockStellarService');

describe('StellarService custom asset methods', () => {
  it('exposes issueAsset, addTrustline, and sendDonation on the production service', () => {
    jest.isolateModules(() => {
      const StellarService = require('../../src/services/StellarService');
      expect(typeof StellarService.prototype.issueAsset).toBe('function');
      expect(typeof StellarService.prototype.addTrustline).toBe('function');
      expect(typeof StellarService.prototype.sendDonation).toBe('function');
    });
  });
});

describe('custom asset issuance requires a trustline', () => {
  let stellar;

  beforeEach(() => {
    stellar = new MockStellarService({ strictValidation: false });
  });

  it('rejects issuance when the distributor has no trustline', async () => {
    const issuer = await stellar.createWallet();
    const distributor = await stellar.createWallet();
    stellar.wallets.get(issuer.publicKey).balance = '1000.0000000';
    stellar.wallets.get(distributor.publicKey).balance = '10.0000000';

    await expect(
      stellar.issueAsset(issuer.secretKey, 'IMPACT', '50', distributor.publicKey)
    ).rejects.toThrow(/trustline/i);
  });

  it('issues after the distributor opens a trustline', async () => {
    const issuer = await stellar.createWallet();
    const distributor = await stellar.createWallet();
    stellar.wallets.get(issuer.publicKey).balance = '1000.0000000';
    stellar.wallets.get(distributor.publicKey).balance = '10.0000000';

    const trust = await stellar.addTrustline(distributor.secretKey, 'IMPACT', issuer.publicKey, '1000');
    expect(trust.limit).toBe('1000');

    const issued = await stellar.issueAsset(issuer.secretKey, 'IMPACT', '50', distributor.publicKey);
    expect(issued.assetCode).toBe('IMPACT');
    expect(issued.amount).toBe('50.0000000');
    expect(parseFloat(stellar.getAssetHolders('IMPACT', issuer.publicKey)[0].balance)).toBeCloseTo(50, 4);
  });

  it('rejects issuance when the issuer is below the minimum XLM reserve', async () => {
    const issuer = await stellar.createWallet();
    const distributor = await stellar.createWallet();
    stellar.wallets.get(issuer.publicKey).balance = '0.0000000';
    stellar.wallets.get(distributor.publicKey).balance = '10.0000000';
    await stellar.addTrustline(distributor.secretKey, 'IMPACT', issuer.publicKey);

    await expect(
      stellar.issueAsset(issuer.secretKey, 'IMPACT', '10', distributor.publicKey)
    ).rejects.toThrow(/minimum/i);
  });
});

describe('sendDonation with a custom asset', () => {
  let stellar;
  let issuer;
  let donor;
  let recipient;

  beforeEach(async () => {
    stellar = new MockStellarService({ strictValidation: false });
    issuer = await stellar.createWallet();
    donor = await stellar.createWallet();
    recipient = await stellar.createWallet();
    const native = { type: 'native', code: 'XLM', issuer: null };
    stellar._setWalletAssetBalance(stellar.wallets.get(issuer.publicKey), native, 1000);
    stellar._setWalletAssetBalance(stellar.wallets.get(donor.publicKey), native, 10);
    stellar._setWalletAssetBalance(stellar.wallets.get(recipient.publicKey), native, 10);

    await stellar.addTrustline(donor.secretKey, 'IMPACT', issuer.publicKey);
    await stellar.addTrustline(recipient.secretKey, 'IMPACT', issuer.publicKey);
    await stellar.issueAsset(issuer.secretKey, 'IMPACT', '100', donor.publicKey);
  });

  it('pays the custom asset (not XLM) when asset code and issuer are provided', async () => {
    const asset = { type: 'credit_alphanum', code: 'IMPACT', issuer: issuer.publicKey };
    const result = await stellar.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '25',
      asset,
    });

    expect(result.transactionId).toBeTruthy();
    expect(stellar._getWalletAssetBalance(stellar.wallets.get(donor.publicKey), asset)).toBeCloseTo(75, 4);
    expect(stellar._getWalletAssetBalance(stellar.wallets.get(recipient.publicKey), asset)).toBeCloseTo(25, 4);
    expect(parseFloat(stellar.wallets.get(donor.publicKey).balance)).toBeCloseTo(10, 4);
  });

  it('rejects a custom-asset payment when the recipient has no trustline', async () => {
    const untrusted = await stellar.createWallet();
    stellar.wallets.get(untrusted.publicKey).balance = '10.0000000';

    await expect(stellar.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: untrusted.publicKey,
      amount: '1',
      asset: { type: 'credit_alphanum', code: 'IMPACT', issuer: issuer.publicKey },
    })).rejects.toThrow(/trustline/i);
  });
});
