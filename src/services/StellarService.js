
// External modules
const StellarSdk = require('stellar-sdk');

// Internal modules
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');
const { STELLAR_NETWORKS, HORIZON_URLS } = require('../constants');
const StellarErrorHandler = require('../utils/stellarErrorHandler');
const log = require('../utils/log');
const { withTimeout, TIMEOUT_DEFAULTS, TimeoutError } = require('../utils/timeoutHandler');
const { runWithAbortController, getCurrentAbortSignal } = require('../utils/abortContext');
const { CircuitBreaker } = require('../utils/circuitBreaker');
const HorizonPool = require('./HorizonPool');
const {
  toStellarSdkAsset,
  normalizeHorizonAsset,
  isSameAsset,
  serializeAsset,
} = require('../utils/stellarAsset');

// Import decomposed modules
const StellarAccounts = require('./stellar/accounts');
const StellarAssets = require('./stellar/assets');
const StellarChannels = require('./stellar/channels');
const StellarClaimableBalances = require('./stellar/claimableBalances');
const StellarFees = require('./stellar/fees');
const StellarOffers = require('./stellar/offers');
const StellarPayments = require('./stellar/payments');

class StellarService extends StellarServiceInterface {
  constructor(config = {}) {
    super(config);
    this.network = config.network || STELLAR_NETWORKS.TESTNET;
    this.horizonUrl = config.horizonUrl || HORIZON_URLS.TESTNET;
    this.serviceSecretKey = config.serviceSecretKey;
    this.environment = config.environment;
    this.correlationId = config.correlationId;

    // Default to SDK definitions if environment config is missing
    this.baseFee = this.environment?.baseFee || StellarSdk.BASE_FEE;
    this.networkPassphrase = this.environment?.networkPassphrase ||
      (this.network === 'mainnet' || this.network === 'public'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET);

    // Horizon connection pool — HORIZON_POOL_SIZE members, max 10, default 3
    const poolSize = Math.min(
      parseInt(process.env.HORIZON_POOL_SIZE || config.horizonPoolSize || '3', 10),
      10
    );
    const poolCooldownMs = parseInt(
      process.env.HORIZON_POOL_COOLDOWN_MS || config.horizonPoolCooldownMs || '30000',
      10
    );
    this._pool = new HorizonPool(this.horizonUrl, {
      size: poolSize,
      cooldownMs: poolCooldownMs,
      createHttpClient: () => this._createHttpClient(),
    });

    // Timeout configuration (overridable via env vars or constructor config)
    this.timeouts = {
      api: config.apiTimeout || parseInt(process.env.HORIZON_API_TIMEOUT_MS, 10) || TIMEOUT_DEFAULTS.STELLAR_API,
      submit: config.submitTimeout || parseInt(process.env.HORIZON_SUBMIT_TIMEOUT_MS, 10) || TIMEOUT_DEFAULTS.STELLAR_SUBMIT,
      stream: config.streamTimeout || parseInt(process.env.HORIZON_STREAM_TIMEOUT_MS, 10) || TIMEOUT_DEFAULTS.STELLAR_STREAM,
    };

    // Retry policy — centralised and configurable (applies to all Horizon calls)
    this.retryPolicy = {
      maxAttempts: config.maxRetryAttempts ?? (parseInt(process.env.HORIZON_MAX_RETRY_ATTEMPTS, 10) || 3),
      baseDelayMs:  config.retryBaseDelayMs  ?? (parseInt(process.env.HORIZON_RETRY_BASE_DELAY_MS, 10) || 200),
      maxDelayMs:   config.retryMaxDelayMs   ?? (parseInt(process.env.HORIZON_RETRY_MAX_DELAY_MS, 10) || 2000),
    };

    // Circuit breaker — protects all Horizon API calls
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: config.circuitBreakerThreshold ?? (parseInt(process.env.HORIZON_CB_FAILURE_THRESHOLD, 10) || 5),
      windowMs:  config.circuitBreakerWindowMs  ?? (parseInt(process.env.HORIZON_CB_WINDOW_MS, 10) || 60000),
      cooldownMs: config.circuitBreakerCooldownMs ?? (parseInt(process.env.HORIZON_CB_COOLDOWN_MS, 10) || 30000),
      name: 'horizon',
    });

    // Initialize decomposed modules
    this.accounts = new StellarAccounts(this);
    this.assets = new StellarAssets(this);
    this.channels = new StellarChannels(this);
    this.claimableBalances = new StellarClaimableBalances(this);
    this.fees = new StellarFees(this);
    this.offers = new StellarOffers(this);
    this.payments = new StellarPayments(this);
  }

  // === Utility and internal methods ===
  get server() {
    return this._pool.getServer();
  }

  getPoolStatus() {
    return this._pool.getStatus();
  }

  _createHttpClient() {
    const { generateCorrelationHeaders } = require('../utils/correlation');
    const fetch = globalThis.fetch;
    
    return {
      async request(method, url, data, headers = {}) {
        const correlationHeaders = generateCorrelationHeaders();
        const mergedHeaders = {
          ...headers,
          ...correlationHeaders,
          'X-Request-ID': this.correlationId || correlationHeaders['X-Correlation-ID'],
        };
        
        const signal = getCurrentAbortSignal();
        const response = await fetch(url, {
          method,
          headers: mergedHeaders,
          body: data ? JSON.stringify(data) : undefined,
          ...(signal ? { signal } : {}),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response.json();
      },
    };
  }

  setCorrelationId(correlationId) {
    this.correlationId = correlationId;
  }

  getNetwork() { return this.network; }
  getHorizonUrl() { return this.horizonUrl; }
  getEnvironment() { return this.environment || { name: this.network }; }

  _getNetworkPassphrase() {
    return this.network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
  }

  _isSamePath(left = [], right = []) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((asset, index) => isSameAsset(asset, right[index]));
  }

  _isTransientNetworkError(error) {
    if (error instanceof TimeoutError) return true;

    const message = (error && error.message) ? error.message : '';
    const code    = (error && error.code) ? error.code : '';
    const status  = error && error.response && error.response.status
      ? error.response.status
      : null;

    // HTTP status codes that warrant retry
    const retryableStatuses = new Set([408, 429, 502, 503, 504]);
    if (retryableStatuses.has(status)) return true;

    const messageTokens = [
      'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET',
      'socket hang up', 'Network Error', 'network timeout', 'timed out',
    ];
    if (messageTokens.some(token => message.includes(token))) return true;

    const codeTokens = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET'];
    return codeTokens.includes(code);
  }

  _getBackoffDelay(attempt) {
    const { baseDelayMs, maxDelayMs } = this.retryPolicy;
    const exp = baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exp, maxDelayMs);
    // ±20 % jitter to prevent thundering-herd retries against a degraded Horizon
    const jitter = capped * (Math.random() * 0.4 - 0.2);
    return Math.max(0, Math.round(capped + jitter));
  }

  async _executeWithRetry(operation, operationName = 'stellar_operation', timeout = null) {
    const maxAttempts = this.retryPolicy.maxAttempts;
    const timeoutMs = timeout || this.timeouts.api;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const activeServer = this._pool.getServer();

      try {
        const abortController = new AbortController();
        return await this.circuitBreaker.execute(() =>
          runWithAbortController(abortController, () =>
            withTimeout(operation(), timeoutMs, operationName, abortController)
          )
        );
      } catch (error) {
        if (error.circuitOpen) {
          throw error;
        }

        lastError = error;

        if (error instanceof TimeoutError) {
          log.warn('STELLAR_SERVICE', 'Operation timeout', {
            operation: operationName,
            attempt,
            maxAttempts,
            timeoutMs
          });
        }

        if (this._isTransientNetworkError(error)) {
          this._pool.markUnhealthy(activeServer);
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
        }
      }

      throw error;
    }
  }

  // === Delegate to modules ===
  // Accounts module methods
  async createWallet() { return this.accounts.createWallet(); }
  async getBalance(publicKey) { return this.accounts.getBalance(publicKey); }
  async fundTestnetWallet(publicKey) { return this.accounts.fundTestnetWallet(publicKey); }
  async fundWithFriendbot(publicKey) { return this.accounts.fundWithFriendbot(publicKey); }
  async isAccountFunded(publicKey) { return this.accounts.isAccountFunded(publicKey); }
  async loadAccount(publicKey) { return this.accounts.loadAccount(publicKey); }
  async getAccountSequence(publicKey) { return this.accounts.getAccountSequence(publicKey); }
  async getAccountBalances(publicKey) { return this.accounts.getAccountBalances(publicKey); }
  async setInflationDestination(sourceSecret, destinationPublicKey) { 
    return this.accounts.setInflationDestination(sourceSecret, destinationPublicKey); 
  }
  async getInflationDestination(publicKey) { 
    return this.accounts.getInflationDestination(publicKey); 
  }
  isValidAddress(address) { return this.accounts.isValidAddress(address); }

  // Payments module methods
  async submitSignedTransaction(signedXDR) { return this.payments.submitSignedTransaction(signedXDR); }
  async sendDonation(params) { return this.payments.sendDonation(params); }
  async discoverBestPath(params) { return this.payments.discoverBestPath(params); }
  async pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options = {}) { 
    return this.payments.pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options); 
  }
  async sendBatchDonations(sourceSecret, payments) { 
    return this.payments.sendBatchDonations(sourceSecret, payments); 
  }
  async getTransactionHistory(publicKey, limit = 10) { 
    return this.payments.getTransactionHistory(publicKey, limit); 
  }
  async verifyTransaction(transactionHash) { 
    return this.payments.verifyTransaction(transactionHash); 
  }
  streamTransactions(publicKey, onTransaction, options = {}) { 
    return this.payments.streamTransactions(publicKey, onTransaction, options); 
  }
  async buildTransaction(sourcePublicKey, operations, options = {}) { 
    return this.payments.buildTransaction(sourcePublicKey, operations, options); 
  }
  async buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options = {}) { 
    return this.payments.buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options); 
  }
  async signTransaction(transaction, secretKey) { 
    return this.payments.signTransaction(transaction, secretKey); 
  }
  async submitTransaction(tx) { return this.payments.submitTransaction(tx); }
  async getTransaction(transactionHash) { return this.payments.getTransaction(transactionHash); }
  async sendPayment(sourcePublicKey, destinationPublic, amount, memo = '') { 
    return this.payments.sendPayment(sourcePublicKey, destinationPublic, amount, memo); 
  }
  async pathPaymentStrictSend(sourceSecret, sendAsset, sendAmount, destPublicKey, destAsset, minDestAmount, options = {}) { 
    return this.payments.pathPaymentStrictSend(sourceSecret, sendAsset, sendAmount, destPublicKey, destAsset, minDestAmount, options); 
  }
  async pathPaymentStrictReceive(sourceSecret, sendAsset, maxSendAmount, destPublicKey, destAsset, destAmount, options = {}) { 
    return this.payments.pathPaymentStrictReceive(sourceSecret, sendAsset, maxSendAmount, destPublicKey, destAsset, destAmount, options); 
  }
  async findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount) { 
    return this.payments.findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount); 
  }
  stroopsToXlm(stroops) { return this.payments.stroopsToXlm(stroops); }
  xlmToStroops(xlm) { return this.payments.xlmToStroops(xlm); }
  async simulateTransaction(xdr) { return this.payments.simulateTransaction(xdr); }

  // Fees module methods
  async estimateFee(operationCount = 1) { return this.fees.estimateFee(operationCount); }
  async buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret) { 
    return this.fees.buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret); 
  }
  async bumpSequence(secret, bumpTo) { return this.accounts.bumpSequence(secret, bumpTo); }
  async mergeAccount(sourceSecret, destinationPublic) { 
    return this.accounts.mergeAccount(sourceSecret, destinationPublic); 
  }
  async validateMergeEligibility(publicKey) { 
    return this.accounts.validateMergeEligibility(publicKey); 
  }
  async listClaimableBalances(publicKey) { 
    return this.claimableBalances.listClaimableBalances(publicKey); 
  }
  async createClaimableBalance(sourceSecret, asset, amount, claimants) { 
    return this.claimableBalances.createClaimableBalance(sourceSecret, asset, amount, claimants); 
  }
  async claimBalance(claimantSecret, balanceId) { 
    return this.claimableBalances.claimBalance(claimantSecret, balanceId); 
  }
}

module.exports = StellarService;
