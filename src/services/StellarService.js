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
const {
  toStellarSdkAsset,
  normalizeHorizonAsset,
  isSameAsset,
  serializeAsset,
} = require('../utils/stellarAsset');

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
    this.environment = config.environment;
    
    // Default to SDK definitions if environment config is missing
    this.baseFee = this.environment?.baseFee || StellarSdk.BASE_FEE;
    this.networkPassphrase = this.environment?.networkPassphrase || 
      (this.network === 'mainnet' || this.network === 'public' 
        ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET);

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

  getEnvironment() {
    return this.environment || { name: this.network };
  }

  getHorizonUrl() {
    return this.horizonUrl;
  }

  /**
   * Resolve the active network passphrase for transaction building.
   *
   * @private
   * @returns {string} Stellar network passphrase.
   */
  _getNetworkPassphrase() {
    return this.network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
  }

  /**
   * Compare two path arrays for deterministic validation.
   *
   * @private
   * @param {Array<Object>} left - First path.
   * @param {Array<Object>} right - Second path.
   * @returns {boolean} True when both paths contain the same assets in the same order.
   */
  _isSamePath(left = [], right = []) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((asset, index) => isSameAsset(asset, right[index]));
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
            'verify_tx_submission'
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
   * Fund a new account via Friendbot (testnet only).
   * Retries up to 3 times with exponential backoff on transient errors.
   * On mainnet, logs a warning and returns { funded: false }.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{funded: boolean, balance?: string}>}
   */
  async fundWithFriendbot(publicKey) {
    if (this.network !== 'testnet') {
      log.warn('STELLAR_SERVICE', 'Friendbot funding skipped — not on testnet', { network: this.network, publicKey });
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
   * Build and submit a fee bump transaction wrapping an existing transaction.
   * @param {string} envelopeXdr - Base64-encoded XDR of the original transaction envelope
   * @param {number} newFeeStroops - New fee in stroops for the fee bump transaction
   * @param {string} feeSourceSecret - Secret key of the account paying the new fee
   * @returns {Promise<{hash: string, ledger: number, fee: number, envelopeXdr: string}>}
   */
  async buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret) {
    return StellarErrorHandler.wrap(async () => {
      const feeSourceKeypair = StellarSdk.Keypair.fromSecret(feeSourceSecret);

      const innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
        envelopeXdr,
        this.networkPassphrase
      );

      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feeSourceKeypair,
        String(newFeeStroops),
        innerTransaction,
        this.networkPassphrase
      );

      feeBumpTx.sign(feeSourceKeypair);

      const result = await this._submitTransactionWithNetworkSafety(feeBumpTx);
      return {
        hash: result.hash,
        ledger: result.ledger,
        fee: newFeeStroops,
        envelopeXdr: feeBumpTx.toEnvelope().toXDR('base64'),
      };
    }, 'buildAndSubmitFeeBumpTransaction');
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
  async sendDonation({ sourceSecret, destinationPublic, amount, memo = '', memoType = 'text', asset = null, validAfter = 0, validBefore = 0 }) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForDonation'
      );
      const paymentAsset = asset ? toStellarSdkAsset(asset) : StellarSdk.Asset.native();

      // Configure time bounds
      // In Stellar, 0 means no limit (infinite)
      // validAfter (minTime) = 0 means minimum time is not restricted
      // validBefore (maxTime) = 0 means maximum time is not restricted
      const timebounds = {
        minTime: String(validAfter || '0'), 
        maxTime: String(validBefore || '0')
      };

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
        timebounds,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: destinationPublic,
          asset: paymentAsset,
          amount: amount.toString(),
        }))
        .setTimeout(30);

      if (memo) {
        switch (memoType) {
          case 'hash':
            transaction.addMemo(StellarSdk.Memo.hash(Buffer.from(memo, 'hex')));
            break;
          case 'return':
            transaction.addMemo(StellarSdk.Memo.return(Buffer.from(memo, 'hex')));
            break;
          case 'id':
            transaction.addMemo(StellarSdk.Memo.id(memo.toString()));
            break;
          default: // 'text'
            transaction.addMemo(StellarSdk.Memo.text(memo));
        }
      }

      const builtTx = transaction.build();
      builtTx.sign(sourceKeypair);

      const envelopeXdr = builtTx.toEnvelope().toXDR('base64');
      const result = await this._submitTransactionWithNetworkSafety(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
        envelopeXdr,
        fee: parseInt(this.baseFee),
      };
    }, 'sendDonation');
  }

  /**
   * Discover the best available path payment route for a source and destination asset pair.
   *
   * @param {Object} params - Path discovery parameters.
   * @param {{ type: string, code: string, issuer: string|null }} params.sourceAsset - Source asset.
   * @param {string} [params.sourceAmount] - Source amount for strict-send quotes.
   * @param {{ type: string, code: string, issuer: string|null }} params.destAsset - Destination asset.
   * @param {string} [params.destAmount] - Destination amount for strict-receive quotes.
   * @returns {Promise<Object|null>} Best route or null when no route exists.
   */
  async discoverBestPath({ sourceAsset, sourceAmount, destAsset, destAmount }) {
    return StellarErrorHandler.wrap(async () => {
      if (isSameAsset(sourceAsset, destAsset)) {
        const effectiveAmount = sourceAmount || destAmount;

        return {
          sourceAsset: serializeAsset(sourceAsset),
          sourceAmount: effectiveAmount,
          destAsset: serializeAsset(destAsset),
          destAmount: effectiveAmount,
          conversionRate: '1.0000000',
          path: [],
        };
      }

      let records = [];

      if (sourceAmount) {
        const response = await this._executeWithRetry(
          () => this.server
            .strictSendPaths(toStellarSdkAsset(sourceAsset), sourceAmount, [toStellarSdkAsset(destAsset)])
            .call(),
          'strictSendPaths'
        );
        records = response.records || [];
      } else if (destAmount) {
        const response = await this._executeWithRetry(
          () => this.server
            .strictReceivePaths([toStellarSdkAsset(sourceAsset)], toStellarSdkAsset(destAsset), destAmount)
            .call(),
          'strictReceivePaths'
        );
        records = response.records || [];
      } else {
        throw new Error('Either sourceAmount or destAmount is required for path discovery');
      }

      if (records.length === 0) {
        return null;
      }

      const bestRecord = [...records].sort((left, right) => {
        const leftDest = parseFloat(left.destination_amount || left.destination_amount_max || '0');
        const rightDest = parseFloat(right.destination_amount || right.destination_amount_max || '0');
        return rightDest - leftDest;
      })[0];

      const normalizedPath = (bestRecord.path || []).map(normalizeHorizonAsset);
      const resolvedSourceAmount = sourceAmount || bestRecord.source_amount;
      const resolvedDestAmount = bestRecord.destination_amount || destAmount;
      const conversionRate = (
        parseFloat(resolvedSourceAmount) > 0
          ? (parseFloat(resolvedDestAmount) / parseFloat(resolvedSourceAmount)).toFixed(7)
          : '0.0000000'
      );

      return {
        sourceAsset: serializeAsset(sourceAsset),
        sourceAmount: resolvedSourceAmount,
        destAsset: serializeAsset(destAsset),
        destAmount: resolvedDestAmount,
        conversionRate,
        path: normalizedPath.map(serializeAsset),
      };
    }, 'discoverBestPath');
  }

  /**
   * Execute a Stellar path payment using a server-discovered route.
   *
   * @param {{ type: string, code: string, issuer: string|null }} sourceAsset - Source asset.
   * @param {string} sourceAmount - Source amount to send.
   * @param {{ type: string, code: string, issuer: string|null }} destAsset - Destination asset.
   * @param {string} destAmount - Minimum destination amount to receive.
   * @param {Array<Object>} path - Normalized path assets.
   * @param {Object} [options={}] - Execution options.
   * @param {string} options.sourceSecret - Source account secret key.
   * @param {string} options.destinationPublic - Destination account public key.
   * @param {string} [options.memo] - Optional memo.
   * @returns {Promise<{transactionId: string, ledger: number}>} Submitted transaction details.
   */
  async pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options = {}) {
    return StellarErrorHandler.wrap(async () => {
      const { sourceSecret, destinationPublic, memo = '' } = options;

      if (!sourceSecret || !destinationPublic) {
        throw new Error('sourceSecret and destinationPublic are required for path payments');
      }

      const discoveredPath = await this.discoverBestPath({
        sourceAsset,
        sourceAmount,
        destAsset,
        destAmount,
      });

      if (!discoveredPath) {
        throw new Error('No Stellar path payment route found');
      }

      const normalizedPath = (path || []).map((asset) => ({
        type: asset.type,
        code: asset.code,
        issuer: asset.issuer || null,
      }));

      const discoveredNormalizedPath = (discoveredPath.path || []).map((asset) => ({
        type: asset.type,
        code: asset.code,
        issuer: asset.issuer || null,
      }));

      if (!this._isSamePath(normalizedPath, discoveredNormalizedPath)) {
        throw new Error('Submitted payment path does not match the best available Stellar route');
      }

      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForPathPayment'
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.pathPaymentStrictSend({
          sendAsset: toStellarSdkAsset(sourceAsset),
          sendAmount: sourceAmount.toString(),
          destination: destinationPublic,
          destAsset: toStellarSdkAsset(destAsset),
          destMin: destAmount.toString(),
          path: normalizedPath.map(toStellarSdkAsset),
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
    }, 'pathPayment');
  }

  /**
   * Send multiple payments from the same source in a single multi-operation transaction.
   * @param {string} sourceSecret - Source account secret key
   * @param {Array<{destinationPublic: string, amount: string, memo?: string}>} payments
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async sendBatchDonations(sourceSecret, payments) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForBatch'
      );

      const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
      }).setTimeout(30);

      for (const p of payments) {
        builder.addOperation(StellarSdk.Operation.payment({
          destination: p.destinationPublic,
          asset: StellarSdk.Asset.native(),
          amount: p.amount.toString(),
        }));
      }

      const builtTx = builder.build();
      builtTx.sign(sourceKeypair);

      const envelopeXdr = builtTx.toEnvelope().toXDR('base64');
      const result = await this._submitTransactionWithNetworkSafety(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
        envelopeXdr,
        fee: parseInt(StellarSdk.BASE_FEE),
      };
    }, 'sendBatchDonations');
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
   * Merge a source account into a destination account.
   *
   * Transfers all XLM from the source account to the destination and closes
   * the source account on the Stellar network (account merge operation).
   *
   * @param {string} sourceSecret      - Secret key of the account to merge (close)
   * @param {string} destinationPublic - Public key of the account to receive all funds
   * @returns {Promise<{hash: string, ledger: number, mergedAmount: string}>}
   * @throws {ValidationError}     If keys are invalid or accounts are the same
   * @throws {NotFoundError}       If destination account does not exist
   * @throws {BusinessLogicError}  If the Stellar operation fails
   */
  async mergeAccount(sourceSecret, destinationPublic) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourcePublic = sourceKeypair.publicKey();

      if (sourcePublic === destinationPublic) {
        const { ValidationError } = require('../utils/errors');
        throw new ValidationError('Source and destination accounts cannot be the same');
      }

      const sourceAccount = await this._executeWithRetry(() =>
        this.server.loadAccount(sourcePublic)
      );

      // Verify destination exists
      await this._executeWithRetry(() =>
        this.server.loadAccount(destinationPublic)
      );

      const nativeBal = sourceAccount.balances.find(b => b.asset_type === 'native');
      const mergedAmount = nativeBal ? nativeBal.balance : '0';

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase:
          this.network === 'public'
            ? StellarSdk.Networks.PUBLIC
            : StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.accountMerge({ destination: destinationPublic })
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Account merged', {
        source: sourcePublic,
        destination: destinationPublic,
        mergedAmount,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, mergedAmount };
    }, 'mergeAccount');
  }

  /**
   * Issue a custom Stellar asset to a recipient.
   *
   * Flow:
   *  1. Recipient must have an existing trustline for the asset (changeTrust op).
   *  2. Issuer sends a payment of the custom asset to the recipient.
   *
   * @param {string} issuerSecret   - Secret key of the asset issuer account
   * @param {string} assetCode      - Asset code (1-12 alphanumeric characters)
   * @param {string} amount         - Amount to issue (string, 7 decimal places)
   * @param {string} recipientPublic - Public key of the recipient
   * @returns {Promise<{hash: string, ledger: number, assetCode: string, issuerPublic: string, amount: string}>}
   * @throws {ValidationError}    If inputs are invalid
   * @throws {BusinessLogicError} If the Stellar operation fails
   */
  async issueAsset(issuerSecret, assetCode, amount, recipientPublic) {
    return StellarErrorHandler.wrap(async () => {
      const { ValidationError } = require('../utils/errors');

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const issuerKeypair = StellarSdk.Keypair.fromSecret(issuerSecret);
      const issuerPublic = issuerKeypair.publicKey();

      if (issuerPublic === recipientPublic) {
        throw new ValidationError('Issuer and recipient cannot be the same account');
      }

      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const issuerAccount = await this._executeWithRetry(() =>
        this.server.loadAccount(issuerPublic)
      );

      const transaction = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase:
          this.network === 'public'
            ? StellarSdk.Networks.PUBLIC
            : StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: recipientPublic,
          asset,
          amount: amount.toString(),
        }))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);
      const result = await this._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Asset issued', {
        assetCode, issuerPublic, recipientPublic, amount, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, issuerPublic, amount };
    }, 'issueAsset');
  }

  /**
   * Burn a custom Stellar asset by sending it back to the issuer.
   *
   * @param {string} holderSecret   - Secret key of the current asset holder
   * @param {string} assetCode      - Asset code to burn
   * @param {string} issuerPublic   - Public key of the asset issuer
   * @param {string} amount         - Amount to burn
   * @returns {Promise<{hash: string, ledger: number, assetCode: string, amount: string}>}
   * @throws {ValidationError}    If inputs are invalid
   * @throws {BusinessLogicError} If the Stellar operation fails
   */
  async burnAsset(holderSecret, assetCode, issuerPublic, amount) {
    return StellarErrorHandler.wrap(async () => {
      const { ValidationError } = require('../utils/errors');

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const holderKeypair = StellarSdk.Keypair.fromSecret(holderSecret);
      const holderPublic = holderKeypair.publicKey();

      if (holderPublic === issuerPublic) {
        throw new ValidationError('Holder and issuer cannot be the same account');
      }

      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const holderAccount = await this._executeWithRetry(() =>
        this.server.loadAccount(holderPublic)
      );

      const transaction = new StellarSdk.TransactionBuilder(holderAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase:
          this.network === 'public'
            ? StellarSdk.Networks.PUBLIC
            : StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: issuerPublic,
          asset,
          amount: amount.toString(),
        }))
        .setTimeout(30)
        .build();

      transaction.sign(holderKeypair);
      const result = await this._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Asset burned', {
        assetCode, issuerPublic, holderPublic, amount, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, amount };
    }, 'burnAsset');
  }


  /**
   * Get the home domain for a Stellar account.
   *
   * @param {string} publicKey - Public key of the account to query
   * @returns {Promise<string|null>} The home_domain field, or null if unset or on error
   */
  async getHomeDomain(publicKey) {
    try {
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(publicKey),
        'loadAccountForHomeDomain'
      );
      return account.home_domain || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Set the home domain for a Stellar account.
   *
   * NOTE: stellar.toml is verified at https://<domain>/.well-known/stellar.toml
   * before the transaction is submitted. The domain must serve a valid stellar.toml
   * (2xx response within 5 seconds) or this method will throw a ValidationError.
   *
   * @param {string} sourceSecret - Secret key of the source account
   * @param {string} domain - Hostname to set as home domain (no protocol, no path, max 32 chars)
   * @returns {Promise<{hash: string, ledger: number}>}
   * @throws {ValidationError} If domain format is invalid or stellar.toml is unreachable/non-2xx
   * @throws {BusinessLogicError} If the Stellar network rejects the transaction
   */
  async setHomeDomain(sourceSecret, domain) {
    const { ValidationError } = require('../utils/errors');
    const https = require('https');

    // Validate domain: hostname only, no protocol, no path, max 32 chars
    if (!domain || typeof domain !== 'string') {
      throw new ValidationError('domain must be a non-empty string');
    }
    if (domain.length > 32) {
      throw new ValidationError('domain must be 32 characters or fewer per Stellar spec');
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(domain)) {
      throw new ValidationError('domain must be a valid hostname with no protocol or path');
    }

    // Verify stellar.toml exists and returns 2xx within 5 seconds
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
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForSetHomeDomain'
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({ homeDomain: domain }))
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Home domain set', {
        source: sourceKeypair.publicKey(),
        homeDomain: domain,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger };
    }, 'setHomeDomain');
   * Query Horizon for an account and normalise the outcome into a discriminated union.
   *
   * This method never throws — all outcomes are returned as plain values so callers
   * do not need to inspect raw Horizon error shapes.
   *
   * @param {string} publicKey - Stellar public key to look up
   * @returns {Promise<
   *   { balance: string } |
   *   { notFound: true } |
   *   { error: true }
   * >}
   *   - `{ balance }` — account exists; `balance` is the native XLM balance string
   *   - `{ notFound: true }` — Horizon returned 404 (account not yet funded)
   *   - `{ error: true }` — any other Horizon or network error
   */
  async getAccountInfo(publicKey) {
    try {
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(publicKey),
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

  /**
   * Get the inflation destination for a Stellar account.
   *
   * @param {string} publicKey - Public key of the account to query
   * @returns {Promise<string|null>} The inflation_destination field, or null if unset or on error
   */
  async getInflationDestination(publicKey) {
    try {
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(publicKey),
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

  /**
   * Simulate (dry-run) a Stellar transaction without submitting it to the network.
   *
   * This method decodes the provided XDR, fetches current fee stats from Horizon
   * (read-only), and returns an estimated fee and expected operation outcome.
   *
   * IMPORTANT: This method NEVER calls `server.submitTransaction`,
   * `server.submitAsyncTransaction`, or any equivalent Horizon submission endpoint.
   * No transaction is broadcast to the Stellar network.
   *
   * @param {string} xdr - Base64-encoded Stellar transaction envelope XDR
   * @returns {Promise<{
   *   success: boolean,
   *   estimatedFee?: { stroops: number, xlm: string },
   *   estimatedResult?: { operationType: string, sourceAccount: string|null, destinationAccount: string|null },
   *   feeWarning?: string,
   *   errors?: string[],
   *   simulatedAt: string
   * }>} Simulation_Result — never throws for expected failure modes
   */
  async simulateTransaction(xdr) {
    const simulatedAt = new Date().toISOString();

    // Guard: xdr must be a non-empty string
    if (!xdr || typeof xdr !== 'string') {
      return { success: false, errors: ['xdr is required'], simulatedAt };
    }

    // Decode the XDR locally — no network call
    let tx;
    try {
      tx = StellarSdk.TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
    } catch (parseErr) {
      return {
        success: false,
        errors: [`Failed to decode XDR: ${parseErr.message}`],
        simulatedAt,
      };
    }

    // Fetch fee stats (read-only Horizon call) with fallback
    const BASE_FEE_STROOPS = parseInt(StellarSdk.BASE_FEE, 10); // 100
    let recommendedFeePerOp = BASE_FEE_STROOPS;
    let feeWarning;

    try {
      const feeStats = await this.server.feeStats();
      const p70 = parseInt(
        (feeStats.fee_charged && feeStats.fee_charged.p70) ||
        (feeStats.max_fee && feeStats.max_fee.p70) ||
        BASE_FEE_STROOPS,
        10
      );
      recommendedFeePerOp = Math.max(p70, BASE_FEE_STROOPS);
    } catch (_feeErr) {
      recommendedFeePerOp = BASE_FEE_STROOPS;
      feeWarning = 'Fee estimate is based on the Stellar network base fee (100 stroops/op); live fee stats were unavailable.';
    }

    const operationCount = tx.operations.length;
    const estimatedFeeStroops = recommendedFeePerOp * operationCount;

    // Build estimatedResult from the first operation
    const firstOp = tx.operations[0];
    const estimatedResult = {
      operationType: firstOp ? firstOp.type : 'unknown',
      sourceAccount: (firstOp && firstOp.source) || tx.source || null,
      destinationAccount: (firstOp && firstOp.destination) || null,
    };

    const result = {
      success: true,
      estimatedFee: {
        stroops: estimatedFeeStroops,
        xlm: (estimatedFeeStroops / 1e7).toFixed(7),
      },
      estimatedResult,
      simulatedAt,
    };

    if (feeWarning) {
      result.feeWarning = feeWarning;
    }

    return result;
  }

  /**
   * Set the inflation destination for a Stellar account.
   *
   * @param {string} sourceSecret - Secret key of the source account
   * @param {string} destinationPublicKey - Public key to set as inflation destination
   * @returns {Promise<{hash: string, ledger: number}>}
   * @throws {ValidationError} If destinationPublicKey is not a valid Stellar public key
   * @throws {BusinessLogicError} If the Stellar network rejects the transaction
   */
  async setInflationDestination(sourceSecret, destinationPublicKey) {
    const { ValidationError } = require('../utils/errors');

    if (!StellarSdk.StrKey.isValidEd25519PublicKey(destinationPublicKey)) {
      throw new ValidationError(
        `destination must be a valid Stellar public key (56-character Base32 string starting with G); received: ${destinationPublicKey}`
      );
    }

    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForSetInflationDestination'
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.setOptions({ inflationDest: destinationPublicKey }))
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Inflation destination set', {
        source: sourceKeypair.publicKey(),
        inflationDest: destinationPublicKey,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger };
    }, 'setInflationDestination');
  }

   * Append events to the internal event store.
   * @private
   * @param {string} contractId
   * @param {Array} events
   */
  _storeEvents(contractId, events) {
    if (!this._eventStore.has(contractId)) {
      this._eventStore.set(contractId, []);
    }
    this._eventStore.get(contractId).push(...events);
  }

  /**
   * Set or update an account data entry on-chain via manageData operation
   * @param {string} secret - Secret key of the account
   * @param {string} key - Data entry key (max 64 bytes)
   * @param {string} value - Data entry value (max 64 bytes), can be base64-encoded string
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async setAccountData(secret, key, value) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(keypair.publicKey()),
        'loadAccountForManageData'
      );

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({
          name: key,
          value: value,
        }))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this._submitTransactionWithNetworkSafety(transaction);
      return {
        hash: result.hash,
        ledger: result.ledger,
      };
    }, 'setAccountData');
  }

  /**
   * Mint a unique NFT donation certificate on Stellar.
   *
   * Issues exactly 1 unit of a custom asset to the recipient, then locks the
   * issuer account (master weight = 0) so no additional supply can ever be
   * created, enforcing a hard supply cap of 1.
   *
   * @param {Object} params
   * @param {string} params.issuerSecret        - Secret key of the (fresh) issuer account
   * @param {string} params.recipientPublicKey  - Stellar public key of the certificate recipient
   * @param {string} params.donationId          - Donation ID used to derive the asset code
   * @param {string} [params.amount]            - Donation amount (informational, not used on-chain)
   * @param {string} [params.campaignId]        - Campaign ID (informational)
   * @param {string} [params.donatedAt]         - ISO timestamp of the donation (informational)
   * @returns {Promise<{assetCode: string, issuer: string, txHash: string, ledger: number}>}
   * @throws {ValidationError}    If inputs are invalid
   * @throws {BusinessLogicError} If the Stellar operation fails
   */
  async mintCertificateNFT({ issuerSecret, recipientPublicKey, donationId }) {
    return StellarErrorHandler.wrap(async () => {
      const { ValidationError } = require('../utils/errors');

      if (!issuerSecret) throw new ValidationError('issuerSecret is required');
      if (!recipientPublicKey) throw new ValidationError('recipientPublicKey is required');
      if (!donationId) throw new ValidationError('donationId is required');

      // Derive asset code: "CERT" + first 8 chars of donationId (uppercase alphanumeric), max 12 chars
      const suffix = donationId.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
      const assetCode = `CERT${suffix}`.slice(0, 12);

      if (!/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError(`Derived asset code "${assetCode}" is invalid`);
      }

      const issuerKeypair = StellarSdk.Keypair.fromSecret(issuerSecret);
      const issuerPublic = issuerKeypair.publicKey();

      if (issuerPublic === recipientPublicKey) {
        throw new ValidationError('Issuer and recipient cannot be the same account');
      }

      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const issuerAccount = await this._executeWithRetry(
        () => this.server.loadAccount(issuerPublic),
        'loadIssuerForNFT'
      );

      // Build a single transaction that:
      //   1. Pays exactly 1 unit of the NFT asset to the recipient
      //   2. Sets issuer master weight to 0 (locks the account — no more issuance possible)
      const transaction = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: recipientPublicKey,
          asset,
          amount: '1',
        }))
        .addOperation(StellarSdk.Operation.setOptions({
          masterWeight: 0,
        }))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);
      const result = await this._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'NFT certificate minted', {
        assetCode,
        issuerPublic,
        recipientPublicKey,
        donationId,
        txHash: result.hash,
      });

      return {
        assetCode,
        issuer: issuerPublic,
        txHash: result.hash,
        ledger: result.ledger,
      };
    }, 'mintCertificateNFT');
  }

  /**
   * Retrieve all donation certificate NFTs held by a wallet.
   *
   * Queries Horizon for non-native balances on the account and filters for
   * assets whose code starts with "CERT".
   *
   * @param {string} publicKey - Stellar public key of the wallet to query
   * @returns {Promise<Array<{assetCode: string, issuer: string, balance: string}>>}
   * @throws {BusinessLogicError} If the Horizon query fails
   */
  async getCertificatesForWallet(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(publicKey),
        'loadAccountForCertificates'
      );

      return account.balances
        .filter(b => b.asset_type !== 'native' && b.asset_code && b.asset_code.startsWith('CERT'))
        .map(b => ({
          assetCode: b.asset_code,
          issuer: b.asset_issuer,
          balance: b.balance,
        }));
    }, 'getCertificatesForWallet');
  }

  /**
   * Delete an account data entry by setting its value to null
   * @param {string} secret - Secret key of the account
   * @param {string} key - Data entry key to delete
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async deleteAccountData(secret, key) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const account = await this._executeWithRetry(
        () => this.server.loadAccount(keypair.publicKey()),
        'loadAccountForManageDataDelete'
      );

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({
          name: key,
          value: null, // Explicitly pass null to delete
        }))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this._submitTransactionWithNetworkSafety(transaction);
      return {
        hash: result.hash,
        ledger: result.ledger,
      };
    }, 'deleteAccountData');
  }
}

module.exports = StellarService;
