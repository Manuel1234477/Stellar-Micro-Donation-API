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
  async sendDonation({ sourceSecret, destinationPublic, amount, memo = '', memoType = 'text', asset = null }) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this._executeWithRetry(
        () => this.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForDonation'
      );
      const paymentAsset = asset ? toStellarSdkAsset(asset) : StellarSdk.Asset.native();

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
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

}

module.exports = StellarService;
