/**
 * Real Stellar Service
 * Handles actual blockchain interactions with Stellar network
 */

const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../utils/stellarErrorHandler');

class StellarService {
  constructor(config = {}) {
    this.network = config.network || 'testnet';
    this.horizonUrl = config.horizonUrl || 'https://horizon-testnet.stellar.org';
    this.serviceSecretKey = config.serviceSecretKey;

    this.server = new StellarSdk.Horizon.Server(this.horizonUrl);
  }

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

  _getBackoffDelay(attempt) {
    const base = 200;
    const max = 2000;
    const delay = base * Math.pow(2, attempt - 1);
    return Math.min(delay, max);
  }

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
        onerror: (error) => console.error('Stream error:', error),
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
