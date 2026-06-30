const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const log = require('../../utils/log');
const { withTimeout } = require('../../utils/timeoutHandler');
const { ValidationError } = require('../../utils/errors');

class StellarAccounts {
  constructor(service) {
    this.service = service;
  }

  async createWallet() {
    const pair = StellarSdk.Keypair.random();
    return {
      publicKey: pair.publicKey(),
      secretKey: pair.secret(),
    };
  }

  async getBalance(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccount'
      );
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return {
        balance: nativeBalance ? nativeBalance.balance : '0',
        asset: 'XLM',
      };
    }, 'getBalance');
  }

  async fundTestnetWallet(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      await this.service._executeWithRetry(
        () => this.service.server.friendbot(publicKey).call(),
        'friendbot'
      );
      const balance = await this.getBalance(publicKey);
      return balance;
    }, 'fundTestnetWallet');
  }

  async fundWithFriendbot(publicKey) {
    if (this.service.network !== 'testnet') {
      log.warn('STELLAR_SERVICE', 'Friendbot funding skipped — not on testnet', { network: this.service.network, publicKey });
      return { funded: false };
    }
    try {
      const result = await this.fundTestnetWallet(publicKey);
      return { funded: true, balance: result.balance };
    } catch (err) {
      log.error('STELLAR_SERVICE', 'Friendbot funding failed', { publicKey, error: err.message });
      return { funded: false, error: err.message };
    }
  }

  async isAccountFunded(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const balance = await this.getBalance(publicKey);
      const funded = parseFloat(balance.balance) > 0;
      return {
        funded,
        balance: balance.balance,
        exists: true,
      };
    }, 'isAccountFunded');
  }

  async loadAccount(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      return this.service.server.loadAccount(publicKey);
    }, 'loadAccount');
  }

  async getAccountSequence(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.loadAccount(publicKey);
      return account.sequenceNumber();
    }, 'getAccountSequence');
  }

  async getAccountBalances(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccountForBalances'
      );
      return account.balances;
    }, 'getAccountBalances');
  }

  async getAccountInfo(publicKey) {
    try {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'getAccountInfo'
      );
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return { balance: nativeBalance ? nativeBalance.balance : '0' };
    } catch (error) {
      const status = error && error.response && error.response.status;
      if (status === 404) {
        return { notFound: true };
      }
      log.warn('STELLAR_SERVICE', 'getAccountInfo failed with non-404 error', {
        publicKey,
        status,
        error: error.message,
      });
      return { error: true };
    }
  }

  async setInflationDestination(sourceSecret, destinationPublicKey) {
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(destinationPublicKey)) {
      throw new ValidationError(
        `destination must be a valid Stellar public key (56-character Base32 string starting with G); received: ${destinationPublicKey}`
      );
    }

    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForSetInflationDestination'
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({ inflationDest: destinationPublicKey }))
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Inflation destination set', {
        source: sourceKeypair.publicKey(),
        inflationDest: destinationPublicKey,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger };
    }, 'setInflationDestination');
  }

  async getInflationDestination(publicKey) {
    try {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccountForInflationDestination'
      );
      return account.inflation_destination || null;
    } catch (error) {
      log.warn('STELLAR_SERVICE', 'Failed to fetch inflation destination, returning null', {
        publicKey,
        error: error.message,
      });
      return null;
    }
  }

  async setAccountData(secret, key, value) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(keypair.publicKey()),
        'loadAccountForManageData'
      );

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({
          name: key,
          value: value,
        }))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);
      return {
        hash: result.hash,
        ledger: result.ledger,
      };
    }, 'setAccountData');
  }

  async setOptions(secret, options = {}) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(keypair.publicKey()),
        'loadAccountForSetOptions'
      );

      const AUTH_IMMUTABLE = StellarSdk.AuthImmutableFlag;
      if (options.clearFlags !== undefined) {
        const flags = Number(options.clearFlags);
        // eslint-disable-next-line no-bitwise
        if ((flags & AUTH_IMMUTABLE) !== 0) {
          throw new ValidationError('AUTH_IMMUTABLE flag cannot be cleared once set');
        }
      }

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions(options))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);
      return { hash: result.hash, ledger: result.ledger };
    }, 'setOptions');
  }

  async deleteAccountData(secret, key) {
    return this.setAccountData(secret, key, null);
  }

  isValidAddress(address) {
    return StellarSdk.StrKey.isValidEd25519PublicKey(address);
  }

  async getHomeDomain(publicKey) {
    try {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccountForHomeDomain'
      );
      return account.home_domain || null;
    } catch (error) {
      return null;
    }
  }

  async setHomeDomain(sourceSecret, domain) {
    const https = require('https');

    if (!domain || typeof domain !== 'string') {
      throw new ValidationError('domain must be a non-empty string');
    }
    if (domain.length > 32) {
      throw new ValidationError('domain must be 32 characters or fewer per Stellar spec');
    }
    // eslint-disable-next-line security/detect-unsafe-regex
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(domain)) {
      throw new ValidationError('domain must be a valid hostname with no protocol or path');
    }

    await new Promise((resolve, reject) => {
      const url = `https://${domain}/.well-known/stellar.toml`;
      const req = https.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          resolve();
        } else {
          res.resume();
          reject(new ValidationError(
            `stellar.toml verification failed: https://${domain}/.well-known/stellar.toml returned HTTP ${res.statusCode}`
          ));
        }
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new ValidationError(
          `stellar.toml verification failed: request to https://${domain}/.well-known/stellar.toml timed out after 5 seconds`
        ));
      });
      req.on('error', (err) => {
        reject(new ValidationError(
          `stellar.toml verification failed: could not reach https://${domain}/.well-known/stellar.toml — ${err.message}`
        ));
      });
    });

    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForSetHomeDomain'
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({ homeDomain: domain }))
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Home domain set', {
        source: sourceKeypair.publicKey(),
        homeDomain: domain,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger };
    }, 'setHomeDomain');
  }

  async getSigners(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccountForSigners'
      );

      return account.signers.map(signer => ({
        publicKey: signer.key,
        weight: signer.weight,
        type: signer.type
      }));
    }, 'getSigners');
  }

  async addSigner(masterSecret, signerPublic, weight = 1) {
    return StellarErrorHandler.wrap(async () => {
      if (!signerPublic || typeof signerPublic !== 'string') {
        throw new ValidationError('Signer public key is required');
      }

      if (typeof weight !== 'number' || weight < 0 || weight > 255) {
        throw new ValidationError('Weight must be a number between 0 and 255');
      }

      const masterKeypair = StellarSdk.Keypair.fromSecret(masterSecret);
      const masterPublic = masterKeypair.publicKey();

      if (masterPublic === signerPublic) {
        throw new ValidationError('Cannot add master key as a signer');
      }

      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(masterPublic),
        'loadAccountForAddSigner'
      );

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({
          signer: {
            ed25519PublicKey: signerPublic,
            weight: weight
          }
        }))
        .setTimeout(30)
        .build();

      transaction.sign(masterKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Signer added to account', {
        master: masterPublic,
        signer: signerPublic,
        weight,
        hash: result.hash
      });

      return {
        hash: result.hash,
        ledger: result.ledger,
        signer: signerPublic,
        weight
      };
    }, 'addSigner');
  }

  async removeSigner(masterSecret, signerPublic) {
    return StellarErrorHandler.wrap(async () => {
      if (!signerPublic || typeof signerPublic !== 'string') {
        throw new ValidationError('Signer public key is required');
      }

      const masterKeypair = StellarSdk.Keypair.fromSecret(masterSecret);
      const masterPublic = masterKeypair.publicKey();

      if (masterPublic === signerPublic) {
        throw new ValidationError('Cannot remove master key as a signer');
      }

      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(masterPublic),
        'loadAccountForRemoveSigner'
      );

      const signerExists = account.signers.some(s => s.key === signerPublic);
      if (!signerExists) {
        throw new ValidationError('Signer not found on account');
      }

      const currentSigners = account.signers;
      const threshold = account.thresholds;
      
      const remainingSigners = currentSigners.filter(s => s.key !== signerPublic);
      const totalWeight = remainingSigners.reduce((sum, s) => sum + s.weight, 0);
      
      if (totalWeight < threshold.low) {
        throw new ValidationError(
          'Cannot remove signer: account would be locked (total weight would be below low threshold)'
        );
      }

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({
          signer: {
            ed25519PublicKey: signerPublic,
            weight: 0
          }
        }))
        .setTimeout(30)
        .build();

      transaction.sign(masterKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Signer removed from account', {
        master: masterPublic,
        signer: signerPublic,
        hash: result.hash
      });

      return {
        hash: result.hash,
        ledger: result.ledger,
        signer: signerPublic
      };
    }, 'removeSigner');
  }

  async updateSignerWeight(masterSecret, signerPublic, newWeight) {
    return StellarErrorHandler.wrap(async () => {
      if (!signerPublic || typeof signerPublic !== 'string') {
        throw new ValidationError('Signer public key is required');
      }

      if (typeof newWeight !== 'number' || newWeight < 0 || newWeight > 255) {
        throw new ValidationError('Weight must be a number between 0 and 255');
      }

      const masterKeypair = StellarSdk.Keypair.fromSecret(masterSecret);
      const masterPublic = masterKeypair.publicKey();

      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(masterPublic),
        'loadAccountForUpdateSigner'
      );

      const signerExists = account.signers.some(s => s.key === signerPublic);
      if (!signerExists) {
        throw new ValidationError('Signer not found on account');
      }

      const currentSigners = account.signers;
      const threshold = account.thresholds;
      
      const updatedSigners = currentSigners.map(s =>
        s.key === signerPublic ? { ...s, weight: newWeight } : s
      );
      const totalWeight = updatedSigners.reduce((sum, s) => sum + s.weight, 0);
      
      if (totalWeight < threshold.low) {
        throw new ValidationError(
          'Cannot update signer weight: account would be locked (total weight would be below low threshold)'
        );
      }

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({
          signer: {
            ed25519PublicKey: signerPublic,
            weight: newWeight
          }
        }))
        .setTimeout(30)
        .build();

      transaction.sign(masterKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Signer weight updated', {
        master: masterPublic,
        signer: signerPublic,
        newWeight,
        hash: result.hash
      });

      return {
        hash: result.hash,
        ledger: result.ledger,
        signer: signerPublic,
        weight: newWeight
      };
    }, 'updateSignerWeight');
  }

  async setThresholds(sourceSecret, low, medium, high) {
    return StellarErrorHandler.wrap(async () => {
      for (const [name, val] of [['low', low], ['medium', medium], ['high', high]]) {
        if (!Number.isInteger(val) || val < 0 || val > 255) {
          throw new ValidationError(`${name} threshold must be an integer between 0 and 255`);
        }
      }

      const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(keypair.publicKey()),
        'loadAccountForSetThresholds'
      );

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({ lowThreshold: low, medThreshold: medium, highThreshold: high }))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Thresholds set', { account: keypair.publicKey(), low, medium, high, hash: result.hash });

      return { hash: result.hash, ledger: result.ledger, thresholds: { low, medium, high } };
    }, 'setThresholds');
  }

  async getThresholds(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.loadAccount(publicKey);
      return account.thresholds;
    }, 'getThresholds');
  }

  async setDataEntry(sourceSecret, key, value) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(keypair.publicKey()),
        'loadAccountForDataEntry'
      );

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({ name: key, value }))
        .setTimeout(30)
        .build();

      tx.sign(keypair);
      const result = await this.service._executeWithRetry(
        () => this.service.server.submitTransaction(tx),
        'submitDataEntry'
      );

      return { hash: result.hash, ledger: result.ledger };
    }, 'setDataEntry');
  }

  async deleteDataEntry(sourceSecret, key) {
    return this.setDataEntry(sourceSecret, key, null);
  }

  async getDataEntries(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccountForDataEntries'
      );

      const entries = {};
      for (const [k, v] of Object.entries(account.data_attr || {})) {
        entries[k] = Buffer.from(v, 'base64').toString('utf8');
      }
      return entries;
    }, 'getDataEntries');
  }

  async mergeAccount(sourceSecret, destinationPublic) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourcePublic = sourceKeypair.publicKey();

      if (sourcePublic === destinationPublic) {
        throw new ValidationError('Source and destination accounts cannot be the same');
      }

      const sourceAccount = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(sourcePublic)
      );

      await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(destinationPublic)
      );

      const nativeBal = sourceAccount.balances.find(b => b.asset_type === 'native');
      const mergedAmount = nativeBal ? nativeBal.balance : '0';

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.accountMerge({ destination: destinationPublic })
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Account merged', {
        source: sourcePublic,
        destination: destinationPublic,
        mergedAmount,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, mergedAmount };
    }, 'mergeAccount');
  }

  async validateMergeEligibility(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      if (!publicKey || typeof publicKey !== 'string') {
        throw new ValidationError('Invalid public key');
      }

      const account = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(publicKey)
      );

      const blockers = [];

      for (const balance of account.balances) {
        if (balance.asset_type !== 'native') {
          const bal = parseFloat(balance.balance);
          if (bal > 0) {
            blockers.push({
              type: 'non_zero_trustline',
              detail: `Non-zero trustline: ${balance.asset_code || balance.asset_type} (balance: ${balance.balance})`
            });
          }
        }
      }

      try {
        const offersPage = await this.service._executeWithRetry(() =>
          this.service.server.offers().forAccount(publicKey).limit(1).call()
        );
        if (offersPage.records && offersPage.records.length > 0) {
          blockers.push({ type: 'open_offers', detail: 'Account has open DEX offers' });
        }
      } catch (_) { /* best-effort */ }

      const dataEntries = Object.keys(account.data_attr || account.data || {});
      if (dataEntries.length > 0) {
        blockers.push({
          type: 'data_entries',
          detail: `Account has ${dataEntries.length} data entr${dataEntries.length === 1 ? 'y' : 'ies'}`
        });
      }

      return { eligible: blockers.length === 0, blockers };
    }, 'validateMergeEligibility');
  }

  async bumpSequence(secret, bumpTo) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const account = await withTimeout(
        this.service.server.loadAccount(keypair.publicKey()),
        this.service.timeouts.api,
        'loadAccount timed out'
      );

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.bumpSequence({ bumpTo: String(bumpTo) }))
        .setTimeout(30)
        .build();

      tx.sign(keypair);

      const result = await this.service._submitTransactionWithNetworkSafety(tx);
      return {
        hash: result.hash,
        ledger: result.ledger,
        newSequence: String(bumpTo),
      };
    }, 'bumpSequence');
  }

  async createSponsoredAccount(sponsorSecret, newAccountPublicKey) {
    return this.sponsorAccount(sponsorSecret, newAccountPublicKey);
  }

  async revokeSponsoredAccount(sponsorSecret, targetPublicKey) {
    return this.revokeSponsorship(sponsorSecret, targetPublicKey);
  }

  async sponsorAccount(sponsorSecret, newAccountPublicKey) {
    return StellarErrorHandler.wrap(async () => {
      const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
      const sponsorPublic = sponsorKeypair.publicKey();
      const account = await this.service.server.loadAccount(sponsorPublic);

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.beginSponsoringFutureReserves({
          sponsoredId: newAccountPublicKey,
        }))
        .addOperation(StellarSdk.Operation.createAccount({
          destination: newAccountPublicKey,
          startingBalance: '0',
          source: sponsorPublic,
        }))
        .addOperation(StellarSdk.Operation.endSponsoringFutureReserves({
          source: newAccountPublicKey,
        }))
        .setTimeout(30)
        .build();

      const newKeypair = StellarSdk.Keypair.fromPublicKey(newAccountPublicKey);
      transaction.sign(sponsorKeypair, newKeypair);

      const result = await this.service.server.submitTransaction(transaction);
      return { transactionId: result.hash, ledger: result.ledger, sponsored: true };
    }, 'sponsorAccount');
  }

  async revokeSponsorship(sponsorSecret, targetPublicKey, entryType = 'account') {
    return StellarErrorHandler.wrap(async () => {
      const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
      const account = await this.service.server.loadAccount(sponsorKeypair.publicKey());

      const op = StellarSdk.Operation.revokeSponsorship({
        type: entryType,
        account: targetPublicKey,
      });

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();

      transaction.sign(sponsorKeypair);

      const result = await this.service.server.submitTransaction(transaction);
      return { transactionId: result.hash, ledger: result.ledger, revoked: true };
    }, 'revokeSponsorship');
  }

  async getSponsorshipStatus(publicKey) {
    const accountData = await this.service.server.loadAccount(publicKey);
    const sponsoredBy = accountData.sponsor || null;
    return { sponsored: !!sponsoredBy, sponsoredBy };
  }
}

module.exports = StellarAccounts;
