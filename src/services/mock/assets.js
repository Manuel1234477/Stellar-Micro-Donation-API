const crypto = require('crypto');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

const getAssetKey = (asset) => asset.type === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;

class MockAssets {
  constructor(service) {
    this.service = service;
  }

  async addTrustline(accountSecret, assetCode, issuerPublic, limit = null) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._validateSecretKey(accountSecret);
    this.service._validatePublicKey(issuerPublic);
    this.service._simulateFailure();

    if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
      throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
    }

    const STELLAR_MAX_LIMIT = '922337203685.4775807';

    if (limit !== null && limit !== undefined) {
      const limitNum = parseFloat(limit);
      if (isNaN(limitNum) || limitNum <= 0) {
        throw new ValidationError('Trust limit must be a positive numeric string');
      }
      if (parseFloat(limit) > parseFloat(STELLAR_MAX_LIMIT)) {
        throw new ValidationError(`Trust limit cannot exceed Stellar maximum of ${STELLAR_MAX_LIMIT}`);
      }
    }

    let accountPublic = null;
    for (const w of this.service.wallets.values()) {
      if (w.secretKey === accountSecret) { accountPublic = w.publicKey; break; }
    }
    if (!accountPublic) {
      throw new ValidationError('Invalid account secret key. No matching account found.');
    }

    const resolvedLimit = limit !== null && limit !== undefined ? String(limit) : STELLAR_MAX_LIMIT;

    if (!this.service.trustlines) this.service.trustlines = new Map();
    const key = `${accountPublic}:${assetCode}:${issuerPublic}`;
    this.service.trustlines.set(key, { assetCode, issuerPublic, limit: resolvedLimit, accountPublic });

    const hash = 'mock_trustline_' + crypto.randomBytes(16).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    log.info('MOCK_STELLAR_SERVICE', 'Trustline established', {
      assetCode, issuerPublic, limit: resolvedLimit, hash,
    });

    return { hash, ledger, assetCode, issuerPublic, limit: resolvedLimit };
  }

  getTrustline(accountPublic, assetCode, issuerPublic) {
    if (!this.service.trustlines) return undefined;
    return this.service.trustlines.get(`${accountPublic}:${assetCode}:${issuerPublic}`);
  }

  async removeTrustline(publicKey, asset) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validatePublicKey(publicKey);
      this.service._simulateFailure();

      const wallet = this.service.wallets.get(publicKey);
      if (!wallet) {
        throw new NotFoundError('Account not found', ERROR_CODES.WALLET_NOT_FOUND);
      }

      if (!wallet.trustlines) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'No trustlines exist for this account'
        );
      }

      const assetKey = getAssetKey(asset);
      const trustline = wallet.trustlines.get(assetKey);

      if (!trustline) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Trustline does not exist for this asset'
        );
      }

      if (parseFloat(trustline.balance) > 0) {
        throw new ValidationError('Cannot remove trustline with non-zero balance');
      }

      wallet.trustlines.delete(assetKey);

      const hash = `mock_${crypto.randomBytes(16).toString('hex')}`;
      const ledger = Math.floor(Math.random() * 1000000) + 1;

      log.info('MOCK_STELLAR_SERVICE', 'Trustline removed', {
        publicKey,
        assetCode: asset.code,
        issuer: asset.issuer,
        hash
      });

      return { hash, ledger };
    });
  }

  async getTrustlines(publicKey) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validatePublicKey(publicKey);

      const wallet = this.service.wallets.get(publicKey);
      if (!wallet) {
        throw new NotFoundError('Account not found', ERROR_CODES.WALLET_NOT_FOUND);
      }

      if (!wallet.trustlines) {
        return [];
      }

      const trustlines = Array.from(wallet.trustlines.values()).map(trustline => ({
        asset: trustline.asset,
        balance: trustline.balance,
        limit: trustline.limit
      }));

      return trustlines;
    });
  }

  async issueAsset(issuerSecret, assetCode, amount, recipientPublic) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validateSecretKey(issuerSecret);
      this.service._validatePublicKey(recipientPublic);
      this.service._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      let issuerWallet = null;
      for (const w of this.service.wallets.values()) {
        if (w.secretKey === issuerSecret) { issuerWallet = w; break; }
      }
      if (!issuerWallet) {
        throw new ValidationError('Invalid issuer secret key. No matching account found.');
      }

      if (issuerWallet.publicKey === recipientPublic) {
        throw new ValidationError('Issuer and recipient cannot be the same account');
      }

      if (!this.service.wallets.has(recipientPublic)) {
        throw new NotFoundError(
          `Recipient account not found: ${recipientPublic}`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      if (!this.service.assetBalances) this.service.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerWallet.publicKey}`;
      if (!this.service.assetBalances.has(assetKey)) this.service.assetBalances.set(assetKey, new Map());

      const holders = this.service.assetBalances.get(assetKey);
      const current = parseFloat(holders.get(recipientPublic) || '0');
      holders.set(recipientPublic, (current + amountNum).toFixed(7));

      const hash = 'mock_issue_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash, type: 'asset_issuance', assetCode,
        issuer: issuerWallet.publicKey, recipient: recipientPublic,
        amount: amountNum.toFixed(7), timestamp: new Date().toISOString(),
        ledger, status: 'confirmed',
      };

      if (!this.service.transactions.has(issuerWallet.publicKey)) this.service.transactions.set(issuerWallet.publicKey, []);
      if (!this.service.transactions.has(recipientPublic)) this.service.transactions.set(recipientPublic, []);
      this.service.transactions.get(issuerWallet.publicKey).push(tx);
      this.service.transactions.get(recipientPublic).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Asset issued', {
        assetCode, amount: amountNum.toFixed(7),
        issuer: `${issuerWallet.publicKey.substring(0, 8)}...`,
        recipient: `${recipientPublic.substring(0, 8)}...`,
      });

      return {
        hash, ledger, assetCode,
        issuerPublic: issuerWallet.publicKey,
        amount: amountNum.toFixed(7),
      };
    });
  }

  async burnAsset(holderSecret, assetCode, issuerPublic, amount) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validateSecretKey(holderSecret);
      this.service._validatePublicKey(issuerPublic);
      this.service._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      let holderWallet = null;
      for (const w of this.service.wallets.values()) {
        if (w.secretKey === holderSecret) { holderWallet = w; break; }
      }
      if (!holderWallet) {
        throw new ValidationError('Invalid holder secret key. No matching account found.');
      }

      if (holderWallet.publicKey === issuerPublic) {
        throw new ValidationError('Holder and issuer cannot be the same account');
      }

      if (!this.service.assetBalances) this.service.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerPublic}`;
      const holders = this.service.assetBalances.get(assetKey);
      const currentBalance = parseFloat((holders && holders.get(holderWallet.publicKey)) || '0');

      if (currentBalance < amountNum) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Insufficient asset balance. Have ${currentBalance.toFixed(7)}, need ${amountNum.toFixed(7)}`
        );
      }

      if (!holders) this.service.assetBalances.set(assetKey, new Map());
      this.service.assetBalances.get(assetKey).set(
        holderWallet.publicKey,
        (currentBalance - amountNum).toFixed(7)
      );

      const hash = 'mock_burn_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash, type: 'asset_burn', assetCode,
        issuer: issuerPublic, holder: holderWallet.publicKey,
        amount: amountNum.toFixed(7), timestamp: new Date().toISOString(),
        ledger, status: 'confirmed',
      };

      if (!this.service.transactions.has(holderWallet.publicKey)) this.service.transactions.set(holderWallet.publicKey, []);
      this.service.transactions.get(holderWallet.publicKey).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Asset burned', {
        assetCode, amount: amountNum.toFixed(7),
        holder: `${holderWallet.publicKey.substring(0, 8)}...`,
      });

      return { hash, ledger, assetCode, amount: amountNum.toFixed(7) };
    });
  }

  async clawback(issuerSecret, from, assetCode, amount) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validateSecretKey(issuerSecret);
      this.service._validatePublicKey(from);
      this.service._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      const issuerWallet = this.service._findWalletBySecret(issuerSecret);
      if (!issuerWallet) throw new ValidationError('Invalid issuer secret key');

      if (!this.service.assetBalances) this.service.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerWallet.publicKey}`;
      const holders = this.service.assetBalances.get(assetKey) || new Map();
      const currentBalance = parseFloat(holders.get(from) || '0');

      if (currentBalance < amountNum) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Insufficient asset balance for clawback. Have ${currentBalance.toFixed(7)}, need ${amountNum.toFixed(7)}`
        );
      }

      holders.set(from, (currentBalance - amountNum).toFixed(7));
      this.service.assetBalances.set(assetKey, holders);

      const hash = 'mock_clawback_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash, type: 'clawback', assetCode,
        issuer: issuerWallet.publicKey, from,
        amount: amountNum.toFixed(7), timestamp: new Date().toISOString(),
        ledger, status: 'confirmed',
      };
      if (!this.service.transactions.has(issuerWallet.publicKey)) this.service.transactions.set(issuerWallet.publicKey, []);
      this.service.transactions.get(issuerWallet.publicKey).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Asset clawback executed', {
        assetCode, amount: amountNum.toFixed(7), from: `${from.substring(0, 8)}...`,
      });

      return { hash, ledger, assetCode, from, amount: amountNum.toFixed(7) };
    });
  }

  async distributeAsset(distributorSecret, assetCode, issuerPublicKey, recipientPublicKey, amount) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      let distributorPublic = null;
      for (const w of this.service.wallets.values()) {
        if (w.secretKey === distributorSecret) { distributorPublic = w.publicKey; break; }
      }
      if (!distributorPublic) {
        throw new ValidationError('Invalid distributor secret key. No matching account found.');
      }

      if (distributorPublic === recipientPublicKey) {
        throw new ValidationError('Distributor and recipient cannot be the same account');
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      if (!this.service.assetBalances) this.service.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerPublicKey}`;
      if (!this.service.assetBalances.has(assetKey)) this.service.assetBalances.set(assetKey, new Map());
      const holders = this.service.assetBalances.get(assetKey);

      const distBalance = parseFloat(holders.get(distributorPublic) || '0');
      if (distBalance < parsedAmount) {
        throw new ValidationError('Insufficient asset balance for distribution');
      }
      holders.set(distributorPublic, (distBalance - parsedAmount).toFixed(7));

      const recipBalance = parseFloat(holders.get(recipientPublicKey) || '0');
      holders.set(recipientPublicKey, (recipBalance + parsedAmount).toFixed(7));

      const hash = `mock_distribute_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      return { hash, ledger, assetCode, issuerPublicKey, recipientPublicKey, amount: parsedAmount.toFixed(7) };
    }, 'distributeAsset');
  }

  getAssetHolders(assetCode, issuerPublic) {
    if (!this.service.assetBalances) return [];
    const assetKey = `${assetCode}:${issuerPublic}`;
    const holders = this.service.assetBalances.get(assetKey);
    if (!holders) return [];
    return Array.from(holders.entries())
      .filter(([, bal]) => parseFloat(bal) > 0)
      .map(([holderPublicKey, balance]) => ({ holderPublicKey, balance }));
  }
}

module.exports = MockAssets;
