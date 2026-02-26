/**
 * Stellar Service - Blockchain Integration Layer
 * 
 * RESPONSIBILITY: Direct integration with Stellar blockchain network via Stellar SDK
 * OWNER: Blockchain Team
 * DEPENDENCIES: Stellar SDK, Horizon API, stellar config
 * 
 * Handles all blockchain operations including wallet creation, balance queries,
 * transaction submission, and network communication with retry logic and error handling.
 * Real Stellar Service - Handles actual blockchain interactions with Stellar network
 */

const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../utils/stellarErrorHandler');
const { STELLAR_NETWORKS, HORIZON_URLS } = require('../constants');
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');
const log = require('../utils/log');

class StellarService extends StellarServiceInterface {
  /**
   * Create a new StellarService instance
   * @param {Object} [config={}] - Configuration options
   * @param {string} [config.network='testnet'] - Stellar network ('testnet' or 'public')
   * @param {string} [config.horizonUrl] - Horizon server URL
   * @param {string} [config.serviceSecretKey] - Service account secret key
   */
  constructor(config = {}) {
    this.network = config.network || STELLAR_NETWORKS.TESTNET;
    this.horizonUrl = config.horizonUrl || HORIZON_URLS.TESTNET;
    this.serviceSecretKey = config.serviceSecretKey;

    this.server = new StellarSdk.Horizon.Server(this.horizonUrl);
  }

  /**
   * Check if an error is a transient network error that can be retried
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} True if error is transient and retryable
   */
  _isTransientNetworkError(error) {
    const message = error && error.message ? error.message : '';
    const code = error && error.code ? error.code : '';
    const status = error && error.response && error.response.status ? error.response.status : null;

    if (status === 503 || status === 504) {
      return true;
    }

    const messageTokens = [
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ECONNRESET',
      'socket hang up',
      'Network Error',
      'network timeout'
    ];

    if (messageTokens.some(token => message.includes(token))) {
      return true;
    }

    const codeTokens = [
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ECONNRESET'
    ];

    return codeTokens.includes(code);
  }

  /**
   * Calculate exponential backoff delay for retry attempts
   * @private
   * @param {number} attempt - Current attempt number (1-indexed)
   * @returns {number} Delay in milliseconds
   */
  _getBackoffDelay(attempt) {
    const base = 200;
    const max = 2000;
    const delay = base * Math.pow(2, attempt - 1);
    return Math.min(delay, max);
  }

  /**
   * Execute an operation with automatic retry on transient errors
   * @private
   * @param {Function} operation - Async operation to execute
   * @returns {Promise<*>} Result of the operation
   * @throws {Error} If all retry attempts fail or error is not transient
   */
  async _executeWithRetry(operation) {
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this._isTransientNetworkError(error) || attempt === maxAttempts) {
          throw error;
        }

        const delay = this._getBackoffDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Submit transaction with network safety checks
   * Attempts to verify transaction was recorded even if submission fails
   * @private
   * @param {Object} builtTx - Built and signed Stellar transaction
   * @returns {Promise<{hash: string, ledger: number}>} Transaction result
   * @throws {Error} If transaction submission fails and cannot be verified
   */
  async _submitTransactionWithNetworkSafety(builtTx) {
    const txHash = builtTx.hash().toString('hex');

    try {
      const result = await this.server.submitTransaction(builtTx);
      return {
        hash: result.hash,
        ledger: result.ledger
      };
    } catch (error) {
      if (this._isTransientNetworkError(error)) {
        try {
          const existingTx = await this._executeWithRetry(() =>
            this.server.transaction(txHash).call()
          );

          if (existingTx && existingTx.hash === txHash) {
            return {
              hash: existingTx.hash,
              ledger: existingTx.ledger
            };
          }
        } catch (checkError) {
          // Best-effort network safety check; original transient error will be thrown below.
        }
      }

      throw error;
    }
  }

  /**
   * Create a new Stellar wallet
   * @returns {Promise<{publicKey: string, secretKey: string}>}
   */
  async createWallet() {
    const pair = StellarSdk.Keypair.random();
    return {
      publicKey: pair.publicKey(),
      secretKey: pair.secret(),
    };
  }

  /**
   * Get wallet balance
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string, asset: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async getBalance(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this._executeWithRetry(() => this.server.loadAccount(publicKey));
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return {
        balance: nativeBalance ? nativeBalance.balance : '0',
        asset: 'XLM',
      };
    }, 'getBalance');
  }

  /**
   * Fund a testnet wallet via Friendbot
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async fundTestnetWallet(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      await this._executeWithRetry(() => this.server.friendbot(publicKey).call());
      const balance = await this.getBalance(publicKey);
      return balance;
    }, 'fundTestnetWallet');
  }

  /**
   * Check if an account is funded on Stellar
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{funded: boolean, balance: string, exists: boolean}>}
   */
  // eslint-disable-next-line no-unused-vars
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

  /**
   * Send a donation transaction
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.destinationPublic - Destination public key
   * @param {string} params.amount - Amount in XLM
   * @param {string} [params.memo] - Optional transaction memo (max 28 bytes)
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async sendDonation({ sourceSecret, destinationPublic, amount, memo = '' }) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(() =>
        this.server.loadAccount(sourceKeypair.publicKey())
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: destinationPublic,
          asset: StellarSdk.Asset.native(),
          amount: amount.toString(),
        }))
        .setTimeout(30);

      if (memo) {
        transaction.addMemo(StellarSdk.Memo.text(memo));
      }

      const builtTx = transaction.build();
      builtTx.sign(sourceKeypair);

      const result = await this._submitTransactionWithNetworkSafety(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
      };
    }, 'sendDonation');
  }

  /**
   * Get transaction history for an account
   * @param {string} publicKey - Stellar public key
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Promise<Array>}
   */
  // eslint-disable-next-line no-unused-vars
  async getTransactionHistory(publicKey, limit = 10) {
    return StellarErrorHandler.wrap(async () => {
      const result = await this._executeWithRetry(() =>
        this.server.transactions()
          .forAccount(publicKey)
          .limit(limit)
          .order('desc')
          .call()
      );
      return result.records;
    }, 'getTransactionHistory');
  }

  /**
   * Stream transactions for an account
   * @param {string} publicKey - Stellar public key
   * @param {Function} onTransaction - Callback for each transaction
   * @returns {Function} Unsubscribe function
   */
  // eslint-disable-next-line no-unused-vars
  streamTransactions(publicKey, onTransaction) {
    return this.server.transactions()
      .forAccount(publicKey)
      .cursor('now')
      .stream({
        onmessage: (tx) => onTransaction(tx),
        onerror: (error) => log.error('STELLAR_SERVICE', 'Transaction stream error', { error: error.message }),
      });
  }

  /**
   * Verify a donation transaction by hash
   * @param {string} transactionHash - Transaction hash to verify
   * @returns {Promise<{verified: boolean, transaction: Object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async verifyTransaction(transactionHash) {
    return StellarErrorHandler.wrap(async () => {
      const tx = await this._executeWithRetry(() =>
        this.server.transaction(transactionHash).call()
      );
      return {
        verified: true,
        transaction: tx,
      };
    }, 'verifyTransaction');
  }
}

module.exports = StellarService;
