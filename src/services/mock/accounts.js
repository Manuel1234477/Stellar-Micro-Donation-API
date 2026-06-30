const crypto = require('crypto');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

const NATIVE_ASSET = { type: 'native', code: 'XLM', issuer: null };

class MockAccounts {
  constructor(service) {
    this.service = service;
  }

  async createWallet() {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();

    const keypair = this.service._generateKeypair();
    this.service.wallets.set(keypair.publicKey, {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
      balance: '0.0000000',
      assetBalances: { native: '0.0000000' },
      createdAt: new Date().toISOString(),
      sequence: '0',
    });
    this.service.transactions.set(keypair.publicKey, []);

    return keypair;
  }

  async getBalance(publicKey) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validatePublicKey(publicKey);
      this.service._simulateFailure();

      const wallet = this.service.wallets.get(publicKey);
      if (!wallet) {
        throw new NotFoundError(
          `Account not found. The account ${publicKey} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      this.service._ensureAssetBalances(wallet);
      return {
        balance: parseFloat(wallet.assetBalances.native) === 0 ? '0' : wallet.assetBalances.native,
        asset: 'XLM',
      };
    });
  }

  async fundTestnetWallet(publicKey) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validatePublicKey(publicKey);
      this.service._simulateFailure();
      this.service._simulateRandomFailure();

      const wallet = this.service.wallets.get(publicKey);
      if (!wallet) {
        throw new NotFoundError(
          `Account not found. The account ${publicKey} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      if (parseFloat(wallet.balance) > 0) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Account is already funded. Friendbot can only fund accounts once.'
        );
      }

      this.service._setWalletAssetBalance(wallet, NATIVE_ASSET, 10000);
      wallet.fundedAt = new Date().toISOString();
      wallet.sequence = '1';

      return { balance: wallet.assetBalances.native };
    });
  }

  async fundWithFriendbot(publicKey) {
    if (this.service.network !== 'testnet') {
      return { funded: false };
    }
    try {
      const result = await this.fundTestnetWallet(publicKey);
      return { funded: true, balance: result.balance };
    } catch (err) {
      return { funded: false, error: err.message };
    }
  }

  async isAccountFunded(publicKey) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._validatePublicKey(publicKey);

    const wallet = this.service.wallets.get(publicKey);
    if (!wallet) {
      return { funded: false, balance: '0', exists: false };
    }

    const balance = parseFloat(wallet.balance);
    const minBalance = parseFloat(this.service.config.minAccountBalance);
    return {
      funded: balance >= minBalance,
      balance: wallet.balance,
      exists: true,
    };
  }

  async loadAccount(address) {
    if (!this.service.isValidAddress(address)) {
      throw new ValidationError('Invalid Stellar address');
    }

    const account = this.service.wallets.get(address);
    if (!account) {
      throw new NotFoundError('Account not found in mock wallets', ERROR_CODES.WALLET_NOT_FOUND);
    }

    return {
      id: address, // Added for compatibility with property tests expecting 'id'
      accountId: () => address,
      sequence: account.sequence || '1', // Added for compatibility with property tests expecting 'sequence'
      sequenceNumber: () => account.sequence || '1',
      balances: account.balances || [{ asset_type: 'native', balance: account.balance || '0.0000000' }],
    };
  }

  async getAccountSequence(address) {
    if (!this.service.isValidAddress(address)) {
      throw new ValidationError('Invalid Stellar address');
    }
    const account = this.service.wallets.get(address);
    if (!account) {
      throw new NotFoundError('Account not found in mock wallets', ERROR_CODES.WALLET_NOT_FOUND);
    }
    return account.sequence || '12345';
  }

  async getAccountBalances(publicKey) {
    if (!this.service.isValidAddress(publicKey)) {
      throw new ValidationError('Invalid public key');
    }
    const account = this.service.wallets.get(publicKey);
    if (!account) {
      throw new NotFoundError('Account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }
    this.service._ensureAssetBalances(account);
    return [{ asset_type: 'native', balance: account.assetBalances.native }];
  }

  async getAccountInfo(publicKey) {
    try {
      const account = await this.loadAccount(publicKey);
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return { balance: nativeBalance ? nativeBalance.balance : '0' };
    } catch (error) {
      if (error.code === ERROR_CODES.WALLET_NOT_FOUND) {
        return { notFound: true };
      }
      return { error: true };
    }
  }

  async setInflationDestination(sourceSecret, destinationPublicKey) {
    this.service._validateSecretKey(sourceSecret);
    this.service._validatePublicKey(destinationPublicKey);
    const wallet = this.service._findWalletBySecret(sourceSecret);
    if (!wallet) throw new ValidationError('Invalid secret key');
    wallet.inflationDestination = destinationPublicKey;
    return {
      hash: `mock_hash_${Math.random().toString(36).slice(2)}`,
      ledger: Math.floor(Math.random() * 1000000) + 1
    };
  }

  async getInflationDestination(publicKey) {
    this.service._validatePublicKey(publicKey);
    const wallet = this.service.wallets.get(publicKey);
    if (!wallet) throw new ValidationError('Wallet not found');
    return wallet.inflationDestination || null;
  }

  async setAccountData(secret, key, value) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();

    const publicKey = this.service._secretToPublic(secret);
    if (!this.service.wallets.has(publicKey)) throw new NotFoundError('Account not found');
    if (!this.service.wallets.get(publicKey)._data) this.service.wallets.get(publicKey)._data = {};
    this.service.wallets.get(publicKey)._data[key] = value;
    const hash = `mock_${crypto.randomBytes(16).toString('hex')}`;
    return { hash, ledger: Math.floor(Math.random() * 1000000) + 1 };
  }

  async setOptions(secret, options = {}) {
    const AUTH_IMMUTABLE = 8;

    if (options.clearFlags !== undefined) {
      // eslint-disable-next-line no-bitwise
      if ((Number(options.clearFlags) & AUTH_IMMUTABLE) !== 0) {
        throw new ValidationError('AUTH_IMMUTABLE flag cannot be cleared once set');
      }
    }

    const wallet = this.service._findWalletBySecret(secret);
    if (!wallet) throw new ValidationError('Invalid secret key');

    if (!wallet._flags) wallet._flags = 0;

    if (options.setFlags !== undefined) {
      // eslint-disable-next-line no-bitwise
      wallet._flags |= Number(options.setFlags);
    }
    if (options.clearFlags !== undefined) {
      // eslint-disable-next-line no-bitwise
      wallet._flags &= ~Number(options.clearFlags);
    }
    if (options.homeDomain !== undefined) wallet.homeDomain = options.homeDomain;
    if (options.masterWeight !== undefined) wallet.masterWeight = options.masterWeight;
    if (options.inflationDest !== undefined) wallet.inflationDestination = options.inflationDest;

    const hash = `mock_${crypto.randomBytes(16).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;
    return { hash, ledger };
  }

  isValidAddress(address) {
    return typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address);
  }

  async getHomeDomain(publicKey) {
    const wallet = this.service.wallets.get(publicKey);
    return (wallet && wallet.homeDomain) || null;
  }

  async setHomeDomain(sourceSecret, domain) {
    if (!domain || typeof domain !== 'string') {
      throw new ValidationError('domain must be a non-empty string');
    }
    if (domain.length > 32) {
      throw new ValidationError('domain must be 32 characters or fewer per Stellar spec');
    }
    // Input is already length-capped to <=32 chars above.
    // eslint-disable-next-line security/detect-unsafe-regex
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(domain)) {
      throw new ValidationError('domain must be a valid hostname with no protocol or path');
    }

    const wallet = this.service._findWalletBySecret(sourceSecret);
    if (!wallet) throw new ValidationError('Invalid secret key');

    wallet.homeDomain = domain;

    const hash = `mock_${crypto.randomBytes(16).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;
    return { hash, ledger };
  }

  async addSigner(masterSecret, signerPublicKey, weight = 1) {
    if (!masterSecret) throw new Error('masterSecret is required');
    if (!signerPublicKey) throw new Error('signerPublicKey is required');
    const account = masterSecret.slice(0, 8);
    if (!this.service._signers) this.service._signers = {};
    if (!this.service._signers[account]) this.service._signers[account] = [];
    this.service._signers[account] = this.service._signers[account].filter(s => s.key !== signerPublicKey);
    this.service._signers[account].push({ key: signerPublicKey, weight });
    return { hash: `mock-add-signer-${Date.now()}`, ledger: 1000, signer: signerPublicKey, weight };
  }

  async removeSigner(masterSecret, signerPublicKey) {
    if (!masterSecret) throw new Error('masterSecret is required');
    if (!signerPublicKey) throw new Error('signerPublicKey is required');
    const account = masterSecret.slice(0, 8);
    if (this.service._signers && this.service._signers[account]) {
      this.service._signers[account] = this.service._signers[account].filter(s => s.key !== signerPublicKey);
    }
    return { hash: `mock-remove-signer-${Date.now()}`, ledger: 1001, signer: signerPublicKey };
  }

  async setThresholds(sourceSecret, low, medium, high) {
    if (!sourceSecret) throw new Error('sourceSecret is required');
    for (const [name, val] of [['low', low], ['medium', medium], ['high', high]]) {
      if (!Number.isInteger(val) || val < 0 || val > 255) {
        throw new Error(`${name} threshold must be an integer between 0 and 255`);
      }
    }
    const account = sourceSecret.slice(0, 8);
    if (!this.service._thresholds) this.service._thresholds = {};
    this.service._thresholds[account] = { low, medium, high };
    return { hash: `mock-set-thresholds-${Date.now()}`, ledger: 1002, thresholds: { low, medium, high } };
  }

  getSigners(masterSecret) {
    const account = masterSecret.slice(0, 8);
    return (this.service._signers && this.service._signers[account]) || [];
  }

  getThresholds(sourceSecret) {
    const account = sourceSecret.slice(0, 8);
    return (this.service._thresholds && this.service._thresholds[account]) || null;
  }

  async setDataEntry(sourceSecret, key, value) {
    await this.service._simulateNetworkDelay();
    this.service._validateSecretKey(sourceSecret);

    if (Buffer.byteLength(key, 'utf8') > 64) {
      throw new ValidationError('Data entry key exceeds maximum length of 64 bytes');
    }
    if (value !== null && value !== undefined && Buffer.byteLength(value, 'utf8') > 64) {
      throw new ValidationError('Data entry value exceeds maximum length of 64 bytes');
    }

    const wallet = this.service._findWalletBySecret(sourceSecret);
    if (!wallet) {
      throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
    }

    if (!wallet.dataEntries) wallet.dataEntries = {};

    if (value === null || value === undefined) {
      if (!Object.prototype.hasOwnProperty.call(wallet.dataEntries, key)) {
        const { NotFoundError: NFE, ERROR_CODES: EC } = require('../../utils/errors');
        throw new NFE(`Data entry "${key}" not found`, EC.NOT_FOUND);
      }
      delete wallet.dataEntries[key];
    } else {
      wallet.dataEntries[key] = value;
    }

    const hash = `mock_data_${crypto.randomBytes(12).toString('hex')}`;
    return { hash, ledger: Math.floor(Math.random() * 1000000) + 1000000 };
  }

  async deleteDataEntry(sourceSecret, key) {
    return this.setDataEntry(sourceSecret, key, null);
  }

  async getDataEntries(publicKey) {
    await this.service._simulateNetworkDelay();
    this.service._validatePublicKey(publicKey);

    const wallet = this.service.wallets.get(publicKey);
    if (!wallet) {
      const { NotFoundError: NFE, ERROR_CODES: EC } = require('../../utils/errors');
      throw new NFE(`Account not found: ${publicKey}`, EC.WALLET_NOT_FOUND);
    }

    return { ...(wallet.dataEntries || {}) };
  }

  async mergeAccount(sourceSecret, destinationPublic) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validateSecretKey(sourceSecret);
      this.service._validatePublicKey(destinationPublic);
      this.service._simulateFailure();

      let sourceWallet = null;
      for (const wallet of this.service.wallets.values()) {
        if (wallet.secretKey === sourceSecret) {
          sourceWallet = wallet;
          break;
        }
      }

      if (!sourceWallet) {
        throw new ValidationError(
          'Invalid source secret key. The provided secret key does not match any account.'
        );
      }

      if (sourceWallet.publicKey === destinationPublic) {
        throw new ValidationError('Source and destination accounts cannot be the same.');
      }

      const destWallet = this.service.wallets.get(destinationPublic);
      if (!destWallet) {
        throw new NotFoundError(
          `Destination account not found. The account ${destinationPublic} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      const mergedAmount = sourceWallet.balance;
      const mergedAmountNum = parseFloat(mergedAmount);

      destWallet.balance = (parseFloat(destWallet.balance) + mergedAmountNum).toFixed(7);

      sourceWallet.balance = '0';
      sourceWallet.merged = true;
      sourceWallet.mergedAt = new Date().toISOString();
      sourceWallet.mergedInto = destinationPublic;

      const hash = 'mock_merge_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash,
        type: 'account_merge',
        source: sourceWallet.publicKey,
        destination: destinationPublic,
        amount: mergedAmount,
        timestamp: new Date().toISOString(),
        ledger,
        status: 'confirmed',
        fee: '0.0000100',
      };

      if (!this.service.transactions.has(sourceWallet.publicKey)) {
        this.service.transactions.set(sourceWallet.publicKey, []);
      }
      if (!this.service.transactions.has(destinationPublic)) {
        this.service.transactions.set(destinationPublic, []);
      }
      this.service.transactions.get(sourceWallet.publicKey).push(tx);
      this.service.transactions.get(destinationPublic).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Account merge simulated', {
        source: `${sourceWallet.publicKey.substring(0, 8)}...`,
        destination: `${destinationPublic.substring(0, 8)}...`,
        mergedAmount,
      });

      return { hash, ledger, mergedAmount };
    });
  }

  async validateMergeEligibility(publicKey) {
    if (!this.service.isValidAddress(publicKey)) {
      throw new ValidationError('Invalid Stellar address');
    }

    const wallet = this.service.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError('Account not found in mock wallets', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const blockers = [];

    if (wallet.balances) {
      for (const balance of wallet.balances) {
        if (balance.asset_type !== 'native') {
          const bal = parseFloat(balance.balance || '0');
          if (bal > 0) {
            blockers.push({
              type: 'non_zero_trustline',
              detail: `Non-zero trustline: ${balance.asset_code || balance.asset_type} (balance: ${balance.balance})`
            });
          }
        }
      }
    }

    if (wallet.openOffers && wallet.openOffers.length > 0) {
      blockers.push({ type: 'open_offers', detail: 'Account has open DEX offers' });
    }

    const dataEntries = Object.keys(wallet.dataEntries || {});
    if (dataEntries.length > 0) {
      blockers.push({
        type: 'data_entries',
        detail: `Account has ${dataEntries.length} data entr${dataEntries.length === 1 ? 'y' : 'ies'}`
      });
    }

    return { eligible: blockers.length === 0, blockers };
  }

  async bumpSequence(secret, bumpTo) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();

    if (!secret) {
      throw new ValidationError('secret is required');
    }
    this.service._validateSecretKey(secret);

    const bumpToNum = BigInt(bumpTo);
    if (bumpToNum < BigInt(0)) {
      throw new ValidationError('bumpTo must be a non-negative integer');
    }

    const wallet = this.service._findWalletBySecret(secret);
    if (!wallet) {
      throw new NotFoundError('Account not found for provided secret key', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const currentSeq = BigInt(wallet.sequence || 0);
    if (bumpToNum <= currentSeq) {
      throw new BusinessLogicError(
        ERROR_CODES.INVALID_REQUEST || 'INVALID_REQUEST',
        `bumpTo (${bumpTo}) must be greater than current sequence (${currentSeq})`
      );
    }

    wallet.sequence = String(bumpToNum);

    const hash = 'mock_bumpseq_' + crypto.randomBytes(16).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    log.info('MOCK_STELLAR_SERVICE', 'Bump sequence submitted', {
      publicKey: wallet.publicKey,
      previousSequence: String(currentSeq),
      newSequence: String(bumpToNum),
      hash,
    });

    return { hash, ledger, newSequence: String(bumpToNum) };
  }

  async createSponsoredAccount(sponsorSecret, newAccountPublic) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();
    this.service._validateSecretKey(sponsorSecret);
    this.service._validatePublicKey(newAccountPublic);

    const sponsorPublic = this.service._secretToPublic(sponsorSecret);
    if (!this.service.wallets.has(sponsorPublic)) {
      throw new NotFoundError('Sponsor account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }
    if (this.service.wallets.has(newAccountPublic)) {
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Account already exists');
    }

    this.service.wallets.set(newAccountPublic, {
      publicKey: newAccountPublic,
      balance: '0.0000000',
      sponsored: true,
      sponsoredBy: sponsorPublic,
      createdAt: new Date().toISOString(),
      sequence: '0',
    });
    this.service.transactions.set(newAccountPublic, []);

    if (!this.service.sponsorships) this.service.sponsorships = new Map();
    this.service.sponsorships.set(newAccountPublic, { sponsor: sponsorPublic, revokedAt: null });

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { transactionId: txId, ledger, sponsored: true };
  }

  async revokeSponsoredAccount(sponsorSecret, sponsoredPublic) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();
    this.service._validateSecretKey(sponsorSecret);
    this.service._validatePublicKey(sponsoredPublic);

    const sponsorPublic = this.service._secretToPublic(sponsorSecret);
    if (!this.service.wallets.has(sponsorPublic)) {
      throw new NotFoundError('Sponsor account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    if (!this.service.sponsorships) this.service.sponsorships = new Map();
    const record = this.service.sponsorships.get(sponsoredPublic);
    if (!record) {
      throw new NotFoundError('No sponsorship record found for this account', ERROR_CODES.NOT_FOUND);
    }
    if (record.sponsor !== sponsorPublic) {
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Account is not sponsored by this sponsor');
    }
    if (record.revokedAt) {
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Sponsorship already revoked');
    }

    record.revokedAt = new Date().toISOString();
    const wallet = this.service.wallets.get(sponsoredPublic);
    if (wallet) { wallet.sponsored = false; wallet.sponsoredBy = null; }

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { transactionId: txId, ledger, revoked: true };
  }

  async sponsorAccount(sponsorSecret, newAccountPublicKey) {
    return this.createSponsoredAccount(sponsorSecret, newAccountPublicKey);
  }

  async revokeSponsorship(sponsorSecret, targetPublicKey, entryType = 'account') {
    return this.revokeSponsoredAccount(sponsorSecret, targetPublicKey);
  }

  async getSponsorshipStatus(publicKey) {
    await this.service._simulateNetworkDelay();
    this.service._validatePublicKey(publicKey);

    if (!this.service.sponsorships) this.service.sponsorships = new Map();
    const record = this.service.sponsorships.get(publicKey);

    if (!record || record.revokedAt) {
      return { sponsored: false, sponsoredBy: null };
    }
    return { sponsored: true, sponsoredBy: record.sponsor };
  }
}

module.exports = MockAccounts;
