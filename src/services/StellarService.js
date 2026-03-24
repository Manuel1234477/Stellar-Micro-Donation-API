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

// External modules
const StellarSdk = require('stellar-sdk');

// Internal modules
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');
const { STELLAR_NETWORKS, HORIZON_URLS } = require('../constants');
const StellarErrorHandler = require('../utils/stellarErrorHandler');
const log = require('../utils/log');
const { withTimeout, TIMEOUT_DEFAULTS, TimeoutError } = require('../utils/timeoutHandler');

class StellarService extends StellarServiceInterface {
  /**
   * Create a new StellarService instance
   * @param {Object} [config={}] - Configuration options
   * @param {string} [config.network='testnet'] - Stellar network ('testnet' or 'public')
   * @param {string} [config.horizonUrl] - Horizon server URL
   * @param {string} [config.serviceSecretKey] - Service account secret key
   */
  constructor(config = {}) {
    super(config);
    this.network = config.network || STELLAR_NETWORKS.TESTNET;
    this.horizonUrl = config.horizonUrl || HORIZON_URLS.TESTNET;
    this.serviceSecretKey = config.serviceSecretKey;

    this.server = new StellarSdk.Horizon.Server(this.horizonUrl);
    
    // Timeout configuration
    this.timeouts = {
      api: config.apiTimeout || TIMEOUT_DEFAULTS.STELLAR_API,
      submit: config.submitTimeout || TIMEOUT_DEFAULTS.STELLAR_SUBMIT,
      stream: config.streamTimeout || TIMEOUT_DEFAULTS.STELLAR_STREAM,
    };
  }

  getNetwork() {
    return this.network;
  }

  getHorizonUrl() {
    return this.horizonUrl;
  }

  /**
   * Check if an error is a transient network error that can be retried
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} True if error is transient and retryable
   */
  _isTransientNetworkError(error) {
    // Timeout errors are retryable
    if (error instanceof TimeoutError) {
      return true;
    }

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
      'network timeout',
      'timed out'
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
   * Execute an operation with automatic retry on transient errors and timeout
   * @private
   * @param {Function} operation - Async operation to execute
   * @param {string} operationName - Name of operation for logging
   * @param {number} [timeout] - Timeout in milliseconds (defaults to api timeout)
   * @returns {Promise<*>} Result of the operation
   * @throws {Error} If all retry attempts fail or error is not transient
   */
  async _executeWithRetry(operation, operationName = 'stellar_operation', timeout = null) {
    const maxAttempts = 3;
    const timeoutMs = timeout || this.timeouts.api;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await withTimeout(operation(), timeoutMs, operationName);
      } catch (error) {
        lastError = error;

        // Log timeout errors
        if (error instanceof TimeoutError) {
          log.warn('STELLAR_SERVICE', 'Operation timeout', {
            operation: operationName,
            attempt,
            maxAttempts,
            timeoutMs
          });
        }

        if (!this._isTransientNetworkError(error) || attempt === maxAttempts) {
          throw error;
        }

        const delay = this._getBackoffDelay(attempt);
        log.debug('STELLAR_SERVICE', 'Retrying after transient error', {
          operation: operationName,
          attempt,
          delay,
          error: error.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Submit transaction with network safety checks and timeout
   * Attempts to verify transaction was recorded even if submission fails
   * @private
   * @param {Object} builtTx - Built and signed Stellar transaction
   * @returns {Promise<{hash: string, ledger: number}>} Transaction result
   * @throws {Error} If transaction submission fails and cannot be verified
   */
  async _submitTransactionWithNetworkSafety(builtTx) {
    const txHash = builtTx.hash().toString('hex');

    try {
      const result = await withTimeout(
        this.server.submitTransaction(builtTx),
        this.timeouts.submit,
        'submitTransaction'
      );
      return {
        hash: result.hash,
        ledger: result.ledger
      };
    } catch (error) {
      if (this._isTransientNetworkError(error)) {
        try {
          const existingTx = await this._executeWithRetry(
            () => this.server.transaction(txHash).call(),
            'verifySubmittedTransaction'
          );

          if (existingTx && existingTx.hash === txHash) {
            log.info('STELLAR_SERVICE', 'Transaction verified after submission timeout', {
              txHash,
              ledger: existingTx.ledger
            });
            return {
              hash: existingTx.hash,
              ledger: existingTx.ledger
            };
          }
        } catch (checkError) {
          log.debug('STELLAR_SERVICE', 'Could not verify transaction after submission error', {
            txHash,
            error: checkError.message
          });
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
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(publicKey),
        'loadAccount'
      );
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
      await this._executeWithRetry(
        () => this.server.friendbot(publicKey).call(),
        'friendbot'
      );
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
   * Estimate the transaction fee for a given number of operations.
   * Queries Horizon fee stats and returns the recommended fee.
   * @param {number} [operationCount=1] - Number of operations in the transaction
   * @returns {Promise<{feeStroops: number, feeXLM: string, baseFee: number, surgeProtection: boolean, surgeMultiplier: number}>}
   */
  async estimateFee(operationCount = 1) {
    return StellarErrorHandler.wrap(async () => {
      const BASE_FEE_STROOPS = parseInt(StellarSdk.BASE_FEE, 10); // 100 stroops
      let recommendedFee = BASE_FEE_STROOPS;
      let surgeMultiplier = 1;

      try {
        const feeStats = await withTimeout(
          this.server.feeStats(),
          this.timeouts.api,
          'feeStats'
        );
        // Use the p70 fee as a reasonable recommendation
        const p70 = parseInt(feeStats.fee_charged?.p70 || feeStats.max_fee?.p70 || BASE_FEE_STROOPS, 10);
        recommendedFee = Math.max(p70, BASE_FEE_STROOPS);
        surgeMultiplier = recommendedFee / BASE_FEE_STROOPS;
      } catch (_err) {
        // Fall back to base fee if Horizon is unreachable
        log.warn('STELLAR_SERVICE', 'Could not fetch fee stats, using base fee', { error: _err.message });
      }

      const totalFeeStroops = recommendedFee * operationCount;
      const surgeProtection = surgeMultiplier >= 5;

      return {
        feeStroops: totalFeeStroops,
        feeXLM: (totalFeeStroops / 1e7).toFixed(7),
        baseFee: BASE_FEE_STROOPS,
        surgeProtection,
        surgeMultiplier: parseFloat(surgeMultiplier.toFixed(2)),
      };
    }, 'estimateFee');
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
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForDonation'
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
      const result = await this._executeWithRetry(
        () => this.server.transactions()
          .forAccount(publicKey)
          .limit(limit)
          .order('desc')
          .call(),
        'getTransactionHistory'
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
    const streamTimeout = this.timeouts.stream;
    let lastMessageTime = Date.now();
    let timeoutTimer = null;

    const resetTimeout = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      timeoutTimer = setTimeout(() => {
        const elapsed = Date.now() - lastMessageTime;
        log.error('STELLAR_SERVICE', 'Transaction stream timeout', {
          publicKey,
          timeoutMs: streamTimeout,
          elapsedMs: elapsed
        });
        if (closeStream) {
          closeStream();
        }
      }, streamTimeout);
    };

    resetTimeout();

    const closeStream = this.server.transactions()
      .forAccount(publicKey)
      .cursor('now')
      .stream({
        onmessage: (tx) => {
          lastMessageTime = Date.now();
          resetTimeout();
          onTransaction(tx);
        },
        onerror: (error) => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }
          log.error('STELLAR_SERVICE', 'Transaction stream error', { 
            error: error.message,
            publicKey
          });
        },
      });

    // Return enhanced close function that also clears timeout
    return () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (closeStream) {
        closeStream();
      }
    };
  }

  /**
   * Verify a donation transaction by hash
   * @param {string} transactionHash - Transaction hash to verify
   * @returns {Promise<{verified: boolean, transaction: Object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async verifyTransaction(transactionHash) {
    return StellarErrorHandler.wrap(async () => {
      const tx = await this._executeWithRetry(
        () => this.server.transaction(transactionHash).call(),
        'verifyTransaction'
      );
      return {
        verified: true,
        transaction: tx,
      };
    }, 'verifyTransaction');
  }

  /**
   * Create a claimable balance on the Stellar network.
   *
   * @param {Object} params
   * @param {string} params.sourceSecret - Funding account secret key
   * @param {string} params.amount - Amount in XLM
   * @param {Array<{destination: string, predicate?: Object}>} params.claimants - Claimants list
   * @param {Object} [params.predicate] - Optional time-based predicate (notBefore/notAfter ms timestamps)
   * @returns {Promise<{balanceId: string, transactionId: string, ledger: number}>}
   */
  async createClaimableBalance({ sourceSecret, amount, claimants, predicate = null }) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForClaimableBalance'
      );

      const networkPassphrase = this.network === 'public'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;

      const stellarClaimants = claimants.map(c => {
        let stellarPredicate = StellarSdk.Claimant.predicateUnconditional();
        const p = c.predicate || predicate;
        if (p) {
          const preds = [];
          if (p.notBefore) {
            preds.push(StellarSdk.Claimant.predicateNot(
              StellarSdk.Claimant.predicateBeforeAbsoluteTime(
                Math.floor(p.notBefore / 1000).toString()
              )
            ));
          }
          if (p.notAfter) {
            preds.push(StellarSdk.Claimant.predicateBeforeAbsoluteTime(
              Math.floor(p.notAfter / 1000).toString()
            ));
          }
          if (preds.length === 1) stellarPredicate = preds[0];
          else if (preds.length === 2) stellarPredicate = StellarSdk.Claimant.predicateAnd(...preds);
        }
        return new StellarSdk.Claimant(c.destination, stellarPredicate);
      });

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.createClaimableBalance({
          asset: StellarSdk.Asset.native(),
          amount: amount.toString(),
          claimants: stellarClaimants,
        }))
        .setTimeout(30)
        .build();

      tx.sign(sourceKeypair);
      const result = await this._submitTransactionWithNetworkSafety(tx);

      // Extract balance ID from operation result
      const opResult = result.result_meta_xdr
        ? StellarSdk.xdr.TransactionMeta.fromXDR(result.result_meta_xdr, 'base64')
        : null;
      let balanceId = null;
      if (opResult) {
        try {
          const ops = opResult.v2().operations();
          if (ops && ops[0]) {
            const inner = ops[0].changes();
            for (const change of inner) {
              if (change.switch().name === 'ledgerEntryCreated') {
                const entry = change.created().data();
                if (entry.switch().name === 'claimableBalance') {
                  balanceId = StellarSdk.StrKey.encodeClaimableBalance(
                    entry.claimableBalance().balanceId().toXDR()
                  );
                }
              }
            }
          }
        } catch (_) { /* balanceId stays null if XDR parsing fails */ }
      }

      return { balanceId, transactionId: result.hash, ledger: result.ledger };
    }, 'createClaimableBalance');
  }

  /**
   * Merge multiple partially-signed XDR envelopes and submit to Stellar.
   *
   * Each entry in `signatures` must contain a `signed_xdr` field that is a
   * base-64 XDR TransactionEnvelope already signed by one signer.  The method
   * collects all signatures from those envelopes, attaches them to the base
   * transaction, and submits the result.
   *
   * @param {Object}   params
   * @param {string}   params.transaction_xdr    - Base-64 XDR of the unsigned transaction
   * @param {string}   params.network_passphrase - Stellar network passphrase
   * @param {Object[]} params.signatures         - [{signer, signed_xdr}]
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async submitMultiSigTransaction({ transaction_xdr, network_passphrase, signatures }) {
    return StellarErrorHandler.wrap(async () => {
      const baseTx = new StellarSdk.Transaction(transaction_xdr, network_passphrase);

      for (const { signed_xdr } of signatures) {
        const signedTx = new StellarSdk.Transaction(signed_xdr, network_passphrase);
        for (const sig of signedTx.signatures) {
          baseTx.signatures.push(sig);
        }
      }

      const result = await this._submitTransactionWithNetworkSafety(baseTx);
      return { transactionId: result.hash, ledger: result.ledger };
    }, 'submitMultiSigTransaction');
  }

  /**
   * Claim a claimable balance.
   *
   * @param {Object} params
   * @param {string} params.balanceId - Claimable balance ID
   * @param {string} params.claimantSecret - Claimant account secret key
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async claimBalance({ balanceId, claimantSecret }) {
    return StellarErrorHandler.wrap(async () => {
      const claimantKeypair = StellarSdk.Keypair.fromSecret(claimantSecret);
      const claimantAccount = await this._executeWithRetry(
        () => this.server.loadAccount(claimantKeypair.publicKey()),
        'loadAccountForClaim'
      );

      const networkPassphrase = this.network === 'public'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;

      const tx = new StellarSdk.TransactionBuilder(claimantAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId }))
        .setTimeout(30)
        .build();

      tx.sign(claimantKeypair);
      const result = await this._submitTransactionWithNetworkSafety(tx);
      return { transactionId: result.hash, ledger: result.ledger };
    }, 'claimBalance');
  }
}

module.exports = StellarService;
