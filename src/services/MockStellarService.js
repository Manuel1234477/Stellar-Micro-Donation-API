
const crypto = require('crypto');
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { getAssetKey, isSameAsset, serializeAsset } = require('../utils/stellarAsset');

// Import decomposed modules
const MockAccounts = require('./mock/accounts');
const MockAssets = require('./mock/assets');
const MockChannels = require('./mock/channels');
const MockClaimableBalances = require('./mock/claimableBalances');
const MockFees = require('./mock/fees');
const MockOffers = require('./mock/offers');
const MockPayments = require('./mock/payments');

const NATIVE_ASSET = { type: 'native', code: 'XLM', issuer: null };

class MockStellarService extends StellarServiceInterface {
  constructor(config = {}) {
    super(config);
    this.wallets = new Map();
    this.transactions = new Map();
    this.streamListeners = new Map();
    this.network = config.network || 'testnet';
    this.horizonUrl = config.horizonUrl || 'https://horizon-testnet.stellar.org';

    this.config = {
      networkDelay: config.networkDelay || 0,
      failureRate: config.failureRate || 0,
      rateLimit: config.rateLimit || null,
      minAccountBalance: config.minAccountBalance || '1.0000000',
      baseReserve: config.baseReserve || '1.0000000',
      strictValidation: config.strictValidation !== false,
      pathRates: config.pathRates || {},
    };

    this.requestTimestamps = [];
    
    // Mock system time for testing time-bound transactions
    // Can be overridden via setMockSystemTime() for testing clock-based failures
    this.mockSystemTime = null;
    
    this.failureSimulation = {
      enabled: false,
      type: null,
      probability: 0,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 0,
    };

    // Initialize decomposed modules
    this.accounts = new MockAccounts(this);
    this.assets = new MockAssets(this);
    this.channels = new MockChannels(this);
    this.claimableBalances = new MockClaimableBalances(this);
    this.fees = new MockFees(this);
    this.offers = new MockOffers(this);
    this.payments = new MockPayments(this);
  }

  // === Utility and internal methods ===
  enableFailureSimulation(type, probability = 1.0) {
    this.failureSimulation.enabled = true;
    this.failureSimulation.type = type;
    this.failureSimulation.probability = probability;
    this.failureSimulation.consecutiveFailures = 0;
    log.info('MOCK_STELLAR_SERVICE', 'Failure simulation enabled', { type, probability });
  }

  disableFailureSimulation() {
    this.failureSimulation.enabled = false;
    this.failureSimulation.type = null;
    this.failureSimulation.probability = 0;
    this.failureSimulation.consecutiveFailures = 0;
  }

  setMaxConsecutiveFailures(max) {
    this.failureSimulation.maxConsecutiveFailures = max;
  }

  setMockSystemTime(unixTimestamp) {
    this.mockSystemTime = unixTimestamp;
  }

  getCurrentSystemTime() {
    if (this.mockSystemTime !== null) {
      return this.mockSystemTime;
    }
    return Math.floor(Date.now() / 1000);
  }

  resetMockSystemTime() {
    this.mockSystemTime = null;
  }

  getNetwork() { return this.network; }
  getHorizonUrl() { return this.horizonUrl; }

  _isRetryableError(error) {
    return Boolean(error && error.details && error.details.retryable);
  }

  async _executeWithRetry(operation) {
    const maxFailures = this.failureSimulation.maxConsecutiveFailures;
    const maxAttempts = maxFailures > 0 ? maxFailures + 1 : 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this._isRetryableError(error) || attempt === maxAttempts) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  _ensureAssetBalances(wallet) {
    if (!wallet.assetBalances) {
      wallet.assetBalances = { native: wallet.balance || '0.0000000' };
    }
    if (!Object.prototype.hasOwnProperty.call(wallet.assetBalances, 'native')) {
      wallet.assetBalances.native = wallet.balance || '0.0000000';
    }
    wallet.balance = wallet.assetBalances.native;
  }

  _getWalletAssetBalance(wallet, asset) {
    this._ensureAssetBalances(wallet);
    return parseFloat(wallet.assetBalances[getAssetKey(asset)] || '0');
  }

  _setWalletAssetBalance(wallet, asset, amount) {
    this._ensureAssetBalances(wallet);
    wallet.assetBalances[getAssetKey(asset)] = Number(amount).toFixed(7);
    wallet.balance = wallet.assetBalances.native;
  }

  _getConversionRate(sourceAsset, destAsset) {
    if (isSameAsset(sourceAsset, destAsset)) {
      return 1;
    }

    const configuredRate = this.config.pathRates[`${getAssetKey(sourceAsset)}->${getAssetKey(destAsset)}`];
    if (configuredRate !== undefined) {
      return Number(configuredRate);
    }

    if (destAsset.type === 'native') {
      return 0.8;
    }

    if (sourceAsset.type === 'native') {
      return 1.2;
    }

    return 0.65;
  }

  _findWalletBySecret(secretKey) {
    if (typeof secretKey === 'object' && secretKey.secretKey) {
      secretKey = secretKey.secretKey;
    }
    for (const wallet of this.wallets.values()) {
      if (wallet.secretKey === secretKey) {
        return wallet;
      }
    }
    return null;
  }

  _secretToPublic(secret) {
    if (secret && typeof secret === 'object' && secret.secretKey) {
      secret = secret.secretKey;
    }
    const wallet = this._findWalletBySecret(secret);
    if (wallet) {
      return wallet.publicKey;
    }
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const hash = crypto.createHash('sha256').update(String(secret || '')).digest();
    let key = 'G';
    for (let i = 0; i < 55; i += 1) {
      key += base32Chars[hash[i % hash.length] % base32Chars.length];
    }
    return key;
  }

  _ensureDestinationFunded(wallet) {
    const destBalance = parseFloat(wallet.balance);
    const minBalance = parseFloat(this.config.minAccountBalance);
    if (destBalance < minBalance) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Destination account is not funded. Stellar requires accounts to maintain a minimum balance of ${this.config.minAccountBalance} XLM. ` +
        'Please fund the account first using Friendbot (testnet) or send an initial funding transaction.',
        { retryable: false }
      );
    }
  }

  _applyAssetTransfer({ sourceWallet, destWallet, asset, amountNum }) {
    const sourceBalance = this._getWalletAssetBalance(sourceWallet, asset);
    const destBalance = this._getWalletAssetBalance(destWallet, asset);

    if (asset.type === 'native') {
      const baseReserve = parseFloat(this.config.baseReserve);
      if (sourceBalance - amountNum < baseReserve) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Insufficient balance. Account must maintain minimum balance of ${this.config.baseReserve} XLM. ` +
          `Available: ${sourceBalance} XLM, Required: ${amountNum + baseReserve} XLM (${amountNum} + ${baseReserve} reserve)`
        );
      }
    } else if (sourceBalance < amountNum) {
      throw new BusinessLogicError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        `Insufficient ${asset.code} balance for payment`
      );
    }

    this._setWalletAssetBalance(sourceWallet, asset, sourceBalance - amountNum);
    this._setWalletAssetBalance(destWallet, asset, destBalance + amountNum);
  }

  _storeTransaction(transaction) {
    if (!this.transactions.has(transaction.source)) {
      this.transactions.set(transaction.source, []);
    }
    if (!this.transactions.has(transaction.destination)) {
      this.transactions.set(transaction.destination, []);
    }

    this.transactions.get(transaction.source).push(transaction);
    this.transactions.get(transaction.destination).push(transaction);
    this._notifyStreamListeners(transaction.source, transaction);
    this._notifyStreamListeners(transaction.destination, transaction);

    return transaction;
  }

  _notifyStreamListeners(publicKey, transaction) {
    const listeners = this.streamListeners.get(publicKey);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(transaction);
        } catch (error) {
          log.error('MOCK_STELLAR_SERVICE', 'Error in stream listener', { error: error.message });
        }
      }
    }
  }

  _simulateFailure() {
    if (!this.failureSimulation.enabled) return;

    if (Math.random() > this.failureSimulation.probability) {
      this.failureSimulation.consecutiveFailures = 0;
      return;
    }

    if (
      this.failureSimulation.maxConsecutiveFailures > 0 &&
      this.failureSimulation.consecutiveFailures >= this.failureSimulation.maxConsecutiveFailures
    ) {
      this.failureSimulation.consecutiveFailures = 0;
      this.failureSimulation.enabled = false;
      return;
    }

    this.failureSimulation.consecutiveFailures += 1;

    switch (this.failureSimulation.type) {
      case 'timeout':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Request timeout - Stellar network may be experiencing high load. Please try again.',
          { retryable: true, retryAfter: 5000 }
        );
      case 'network_error':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Network error: Unable to connect to Stellar Horizon server. Check your connection.',
          { retryable: true, retryAfter: 3000 }
        );
      case 'service_unavailable':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Service temporarily unavailable: Stellar Horizon is under maintenance. Please try again later.',
          { retryable: true, retryAfter: 10000 }
        );
      case 'bad_sequence':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'tx_bad_seq: Transaction sequence number does not match source account. This usually indicates a concurrent transaction.',
          { retryable: true, retryAfter: 1000 }
        );
      case 'tx_failed':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'tx_failed: Transaction failed due to network congestion or insufficient fee. Please retry with higher fee.',
          { retryable: true, retryAfter: 2000 }
        );
      case 'tx_insufficient_fee':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'tx_insufficient_fee: Transaction fee is too low for current network conditions.',
          { retryable: true, retryAfter: 1000 }
        );
      case 'connection_refused':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Connection refused: Unable to establish connection to Stellar network.',
          { retryable: true, retryAfter: 5000 }
        );
      case 'rate_limit_horizon':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Horizon rate limit exceeded: Too many requests to Stellar network. Please slow down.',
          { retryable: true, retryAfter: 60000 }
        );
      case 'partial_response':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Incomplete response from Stellar network. Data may be corrupted.',
          { retryable: true, retryAfter: 2000 }
        );
      case 'ledger_closed':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Ledger already closed: Transaction missed the ledger window. Please resubmit.',
          { retryable: true, retryAfter: 5000 }
        );
      case 'fee_bump_failure':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Fee bump transaction failed: the inner transaction has already been applied or the fee is still too low.',
          { retryable: false }
        );
      case 'path_payment_failed':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Path payment failed on the Stellar DEX.',
          { retryable: false }
        );
      case 'no_path':
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'No Stellar path payment route was found.',
          { retryable: false }
        );
      default:
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Unknown network error occurred',
          { retryable: true, retryAfter: 3000 }
        );
    }
  }

  async _simulateNetworkDelay() {
    const latency = MockStellarService._getLatencyMs();
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    } else if (this.config.networkDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.networkDelay));
    }
  }

  static _getLatencyMs() {
    if (MockStellarService._latencyRange) {
      const { min, max } = MockStellarService._latencyRange;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    if (MockStellarService._latencyMs !== undefined) {
      return MockStellarService._latencyMs;
    }
    const envMs = parseInt(process.env.MOCK_STELLAR_LATENCY_MS, 10);
    return Number.isFinite(envMs) && envMs > 0 ? envMs : 0;
  }

  static setLatency(ms) {
    MockStellarService._latencyMs = ms;
    MockStellarService._latencyRange = null;
  }

  static setLatencyRange(minMs, maxMs) {
    MockStellarService._latencyRange = { min: minMs, max: maxMs };
    MockStellarService._latencyMs = undefined;
  }

  static resetLatency() {
    MockStellarService._latencyMs = undefined;
    MockStellarService._latencyRange = null;
  }

  _checkRateLimit() {
    if (!this.config.rateLimit) return;

    const now = Date.now();
    const oneSecondAgo = now - 1000;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > oneSecondAgo);

    if (this.requestTimestamps.length >= this.config.rateLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Rate limit exceeded. Please try again later.',
        { retryAfter: 1000 }
      );
    }

    this.requestTimestamps.push(now);
  }

  _simulateRandomFailure() {
    if (this.config.failureRate > 0 && Math.random() < this.config.failureRate) {
      const errors = [
        'tx_bad_seq: Transaction sequence number does not match source account',
        'tx_insufficient_balance: Insufficient balance for transaction',
        'tx_failed: Transaction failed due to network congestion',
        'timeout: Request timeout - network may be experiencing high load',
      ];
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        errors[Math.floor(Math.random() * errors.length)]
      );
    }
  }

  _validatePublicKey(publicKey) {
    if (!this.config.strictValidation) return;

    if (!publicKey || typeof publicKey !== 'string') {
      throw new ValidationError('Public key must be a string');
    }

    if (!publicKey.startsWith('G') || publicKey.length !== 56) {
      throw new ValidationError('Invalid Stellar public key format. Must start with G and be 56 characters long.');
    }

    if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
      throw new ValidationError('Invalid Stellar public key format. Contains invalid characters.');
    }
  }

  _validateSecretKey(secretKey) {
    if (!this.config.strictValidation) return;

    if (!secretKey || typeof secretKey !== 'string') {
      throw new ValidationError('Secret key must be a string');
    }

    if (!secretKey.startsWith('S') || secretKey.length !== 56) {
      throw new ValidationError('Invalid Stellar secret key format. Must start with S and be 56 characters long.');
    }

    if (!/^S[A-Z2-7]{55}$/.test(secretKey)) {
      throw new ValidationError('Invalid Stellar secret key format. Contains invalid characters.');
    }
  }

  _validateAmount(amount) {
    if (!this.config.strictValidation) return;

    const amountNum = parseFloat(amount);
    if (Number.isNaN(amountNum)) {
      throw new ValidationError('Amount must be a valid number');
    }
    if (amountNum <= 0) {
      throw new ValidationError('Amount must be greater than zero');
    }
    const maxAllowedAmount = Number('922337203685.4775807');
    if (amountNum > maxAllowedAmount) {
      throw new ValidationError('Amount exceeds maximum allowed value (922337203685.4775807 XLM)');
    }

    const decimalPart = amount.toString().split('.')[1];
    if (decimalPart && decimalPart.length > 7) {
      throw new ValidationError('Amount cannot have more than 7 decimal places');
    }
  }

  _generateKeypair() {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '234567';
    const generateKey = (prefix) => {
      let key = prefix;
      for (let i = 0; i < 55; i += 1) {
        key += base32Chars[Math.floor(Math.random() * base32Chars.length)];
      }
      return key;
    };

    return {
      publicKey: generateKey('G'),
      secretKey: generateKey('S'),
    };
  }

  setSubmitTransactionFailure(shouldFail) {
    this._submitTransactionShouldFail = Boolean(shouldFail);
  }

  // === Delegate to modules ===
  // Accounts module methods
  async createWallet() { return this.accounts.createWallet(); }
  async getBalance(publicKey) { return this.accounts.getBalance(publicKey); }
  async fundTestnetWallet(publicKey) { return this.accounts.fundTestnetWallet(publicKey); }
  async fundWithFriendbot(publicKey) { return this.accounts.fundWithFriendbot(publicKey); }
  async isAccountFunded(publicKey) { return this.accounts.isAccountFunded(publicKey); }
  async loadAccount(address) { return this.accounts.loadAccount(address); }
  async getAccountSequence(address) { return this.accounts.getAccountSequence(address); }
  async getAccountBalances(publicKey) { return this.accounts.getAccountBalances(publicKey); }
  async setInflationDestination(sourceSecret, destinationPublicKey) { 
    return this.accounts.setInflationDestination(sourceSecret, destinationPublicKey); 
  }
  async getInflationDestination(publicKey) { 
    return this.accounts.getInflationDestination(publicKey); 
  }
  isValidAddress(address) { return this.accounts.isValidAddress(address); }

  // Payments module methods
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
  streamTransactions(publicKey, onTransaction) { 
    return this.payments.streamTransactions(publicKey, onTransaction); 
  }
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
  async getTransaction(transactionHash) { 
    return this.payments.getTransaction(transactionHash); 
  }
  stroopsToXlm(stroops) { return this.payments.stroopsToXlm(stroops); }
  xlmToStroops(xlm) { return this.payments.xlmToStroops(xlm); }
  async simulateTransaction(xdr) { return this.payments.simulateTransaction(xdr); }

  // Delegate other modules' methods as needed
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
}

module.exports = MockStellarService;
