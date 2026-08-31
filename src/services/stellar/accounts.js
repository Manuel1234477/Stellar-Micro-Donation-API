/**
 * Stellar Accounts Module
 * 
 * Handles all account-related operations including:
 * - Wallet creation and funding
 * - Balance queries
 * - Account information and sequence numbers
 * - Account data entries (ManageDataOperation)
 * - Inflation destination management
 */

const StellarSdk = require('stellar-sdk');
const log = require('../../utils/log');
const { NotFoundError, ValidationError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');

class StellarAccounts {
  constructor(stellarService) {
    this.stellarService = stellarService;
  }

  async createWallet() {
    const pair = StellarSdk.Keypair.random();
    return {
      publicKey: pair.publicKey(),
      secret: pair.secret(),
    };
  }

  async getBalance(publicKey) {
    const account = await this.stellarService._executeWithRetry(
      () => this.stellarService.server.loadAccount(publicKey),
      'getBalance'
    );

    const nativeBalance = account.balances.find(b => b.asset_type === 'native');
    return {
      balance: nativeBalance ? nativeBalance.balance : '0',
      balances: account.balances,
    };
  }

  async fundTestnetWallet(publicKey) {
    if (this.stellarService.network === 'mainnet' || this.stellarService.network === 'public') {
      throw new ValidationError('Friendbot funding is not available on mainnet');
    }

    try {
      const response = await fetch(
        `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
      );

      if (!response.ok) {
        throw new Error(`Friendbot returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      log.error('STELLAR_ACCOUNTS', 'Friendbot funding failed', { error: error.message, publicKey });
      throw error;
    }
  }

  async fundWithFriendbot(publicKey) {
    return this.fundTestnetWallet(publicKey);
  }

  async isAccountFunded(publicKey) {
    try {
      await this.stellarService._executeWithRetry(
        () => this.stellarService.server.loadAccount(publicKey),
        'isAccountFunded'
      );
      return true;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return false;
      }
      throw error;
    }
  }

  async loadAccount(publicKey) {
    return this.stellarService._executeWithRetry(
      () => this.stellarService.server.loadAccount(publicKey),
      'loadAccount'
    );
  }

  async getAccountSequence(publicKey) {
    const account = await this.loadAccount(publicKey);
    return account.sequence;
  }

  async getAccountBalances(publicKey) {
    const account = await this.loadAccount(publicKey);
    return account.balances;
  }

  async setInflationDestination(sourceSecret, destinationPublicKey) {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const account = await this.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.setOptions({
          inflationDest: destinationPublicKey,
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    return { hash: result.hash, ledger: result.ledger };
  }

  async getInflationDestination(publicKey) {
    const account = await this.loadAccount(publicKey);
    return account.inflation_destination || null;
  }

  async setHomeDomain(sourceSecret, homeDomain) {
    validateHomeDomain(homeDomain, { allowEmpty: true });

    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const account = await this.loadAccount(sourceKeypair.publicKey());
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(StellarSdk.Operation.setOptions({ homeDomain }))
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);
    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    return { hash: result.hash, ledger: result.ledger };
  }

  async getHomeDomain(publicKey) {
    const account = await this.loadAccount(publicKey);
    return account.home_domain || null;
  }

  /**
   * Add (or update the weight of) a signer on an account.
   * Used for multi-sig setups and social-recovery signer swaps (#1552).
   */
  async addSigner(masterSecret, signerPublicKey, weight = 1) {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(masterSecret);
    const account = await this.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.setOptions({
          signer: { ed25519PublicKey: signerPublicKey, weight },
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);
    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    return { hash: result.hash, ledger: result.ledger, signerPublicKey, weight };
  }

  /**
   * Remove a signer from an account (weight 0).
   */
  async removeSigner(masterSecret, signerPublicKey) {
    return this.addSigner(masterSecret, signerPublicKey, 0);
  }

  isValidAddress(address) {
    try {
      StellarSdk.StrKey.decodeEd25519PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  async bumpSequence(secret, bumpTo) {
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    const account = await this.loadAccount(keypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.bumpSequence({
          bumpTo: bumpTo.toString(),
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    return { hash: result.hash, ledger: result.ledger };
  }

  async mergeAccount(sourceSecret, destinationPublic) {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const account = await this.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.accountMerge({
          destination: destinationPublic,
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    return { hash: result.hash, ledger: result.ledger };
  }

  async validateMergeEligibility(publicKey) {
    const account = await this.loadAccount(publicKey);

    const issues = [];

    if (account.subentry_count > 0) {
      issues.push({
        field: 'subentries',
        value: account.subentry_count,
        message: 'Account has active subentries (trustlines, offers, signers, or data entries)',
      });
    }

    if (account.num_sponsoring > 0) {
      issues.push({
        field: 'sponsoring',
        value: account.num_sponsoring,
        message: 'Account is sponsoring other accounts or reserves',
      });
    }

    if (account.num_sponsored > 0) {
      issues.push({
        field: 'sponsored',
        value: account.num_sponsored,
        message: 'Account has sponsored reserves',
      });
    }

    return {
      eligible: issues.length === 0,
      issues,
      account: {
        id: account.id,
        subentry_count: account.subentry_count,
        num_sponsoring: account.num_sponsoring,
        num_sponsored: account.num_sponsored,
      },
    };
  }

  /**
   * Set a data entry on a Stellar account using ManageDataOperation.
   * @param {string} sourceSecret - Secret key of the account
   * @param {string} key - Data entry key (max 64 bytes)
   * @param {string|Buffer} value - Data entry value (max 64 bytes)
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async setAccountData(sourceSecret, key, value) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('key is required and must be a string');
    }
    if (Buffer.byteLength(key, 'utf8') > 64) {
      throw new ValidationError('key must be 64 bytes or less');
    }
    if (value !== null && value !== undefined) {
      const valueBuffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
      if (valueBuffer.length > 64) {
        throw new ValidationError('value must be 64 bytes or less');
      }
    }

    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const account = await this.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.manageData({
          name: key,
          value: value,
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    log.info('STELLAR_ACCOUNTS', 'Account data entry set', {
      publicKey: sourceKeypair.publicKey(),
      key,
      hash: result.hash,
    });

    return { hash: result.hash, ledger: result.ledger };
  }

  /**
   * Get all data entries for a Stellar account.
   * @param {string} publicKey - Account public key
   * @returns {Promise<Object>} Map of key-value pairs
   */
  async getAccountData(publicKey) {
    const account = await this.loadAccount(publicKey);
    
    // Horizon returns data entries in the account.data field as base64-encoded values
    const dataEntries = {};
    if (account.data_attr) {
      for (const [key, base64Value] of Object.entries(account.data_attr)) {
        dataEntries[key] = Buffer.from(base64Value, 'base64').toString('utf8');
      }
    }

    return dataEntries;
  }

  /**
   * Delete a data entry from a Stellar account by setting its value to null.
   * @param {string} sourceSecret - Secret key of the account
   * @param {string} key - Data entry key to delete
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async deleteAccountData(sourceSecret, key) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('key is required and must be a string');
    }

    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const account = await this.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: this.stellarService.baseFee,
      networkPassphrase: this.stellarService.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.manageData({
          name: key,
          value: null, // Setting to null removes the entry
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    const result = await this.stellarService._submitTransactionWithNetworkSafety(transaction);
    log.info('STELLAR_ACCOUNTS', 'Account data entry deleted', {
      publicKey: sourceKeypair.publicKey(),
      key,
      hash: result.hash,
    });

    return { hash: result.hash, ledger: result.ledger };
  }

  /**
   * Calculate minimum XLM reserve for an account based on subentries.
   * Base reserve: 1 XLM (as of 2023, was 0.5 XLM previously)
   * Per subentry: 0.5 XLM
   * @param {number} subentryCount - Number of trustlines, offers, signers, data entries
   * @returns {number} Minimum reserve in XLM
   */
  calculateMinimumReserve(subentryCount) {
    const BASE_RESERVE = 1; // XLM
    const SUBENTRY_RESERVE = 0.5; // XLM per subentry
    return BASE_RESERVE + (subentryCount * SUBENTRY_RESERVE);
  }

  /**
   * Check if an account has sufficient balance after a donation to maintain minimum reserve.
   * @param {string} publicKey - Donor's public key
   * @param {number} donationAmount - Donation amount in XLM
   * @param {number} feeStroops - Transaction fee in stroops (default 100 stroops = 0.00001 XLM)
   * @returns {Promise<{sufficient: boolean, currentBalance: number, minimumReserve: number, maxSafeDonation: number}>}
   */
  async checkDonationReserve(publicKey, donationAmount, feeStroops = 100) {
    const account = await this.loadAccount(publicKey);
    
    const nativeBalance = account.balances.find(b => b.asset_type === 'native');
    const currentBalance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    
    const subentryCount = account.subentry_count || 0;
    const minimumReserve = this.calculateMinimumReserve(subentryCount);
    
    const feeInXlm = feeStroops / 10000000; // Convert stroops to XLM
    const remainingBalance = currentBalance - donationAmount - feeInXlm;
    
    const sufficient = remainingBalance >= minimumReserve;
    const maxSafeDonation = Math.max(0, currentBalance - minimumReserve - feeInXlm);

    return {
      sufficient,
      currentBalance,
      minimumReserve,
      remainingBalance,
      maxSafeDonation,
      subentryCount,
      feeInXlm,
    };
  }
}

module.exports = StellarAccounts;
