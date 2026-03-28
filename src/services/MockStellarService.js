/**
 * Mock Stellar Service - Testing and Development Layer
 *
 * RESPONSIBILITY: In-memory mock implementation for testing without network calls
 * OWNER: QA/Testing Team
 * DEPENDENCIES: StellarServiceInterface, error utilities
 *
 * Simulates Stellar blockchain behavior for development and testing environments.
 * Provides realistic error scenarios, failure simulation, and instant responses
 * without requiring actual blockchain network connectivity.
 *
 * LIMITATIONS:
 * - No actual blockchain consensus or validation
 * - No network latency simulation (instant responses unless configured)
 * - No multi-signature support
 * - No trustline enforcement
 * - Simplified path payment and DEX pricing logic for deterministic offline tests
 * - Simplified fee structure (no actual fees charged)
 * - Transaction finality is immediate (no pending states)
 */

const crypto = require('crypto');
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');
const { NotFoundError, ValidationError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { getAssetKey, isSameAsset, serializeAsset } = require('../utils/stellarAsset');

const NATIVE_ASSET = { type: 'native', code: 'XLM', issuer: null };

class MockStellarService extends StellarServiceInterface {
  constructor(config = {}) {
    super();
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
  }

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

  /**
   * Set mock system time for testing time-bound transactions.
   * @param {number} unixTimestamp - Unix timestamp in seconds (or null to use real time)
   */
  setMockSystemTime(unixTimestamp) {
    this.mockSystemTime = unixTimestamp;
  }

  /**
   * Get current system time in Unix seconds.
   * Returns mock time if set, otherwise current real time.
   * @returns {number} Unix timestamp in seconds
   */
  getCurrentSystemTime() {
    if (this.mockSystemTime !== null) {
      return this.mockSystemTime;
    }
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Reset mock system time to use real time.
   */
  resetMockSystemTime() {
    this.mockSystemTime = null;
  }

  getNetwork() { return this.network; }
  getHorizonUrl() { return this.horizonUrl; }

  /**
   * Load account state from mock wallet storage.
   * @param {string} address
   * @returns {Promise<Object>}
   */
  async loadAccount(address) {
    if (!this.isValidAddress(address)) {
      throw new ValidationError('Invalid Stellar address');
    }

    const account = this.wallets.get(address);
    if (!account) {
      throw new NotFoundError('Account not found in mock wallets', ERROR_CODES.WALLET_NOT_FOUND);
    }

    return {
      accountId: () => address,
      sequenceNumber: () => account.sequence || '1',
      balances: account.balances || [{ asset_type: 'native', balance: account.balance || '0.0000000' }],
    };
  }

  /**
   * Validate a Stellar public key.
   * @param {string} address
   * @returns {boolean}
   */
  isValidAddress(address) {
    return typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address);
  }

  /**
   * Return mock account sequence number for an address.
   * @param {string} address
   * @returns {Promise<string>}
   */
  async getAccountSequence(address) {
    if (!this.isValidAddress(address)) {
      throw new ValidationError('Invalid Stellar address');
    }
    const account = this.wallets.get(address);
    if (!account) {
      throw new NotFoundError('Account not found in mock wallets', ERROR_CODES.WALLET_NOT_FOUND);
    }
    return account.sequence || '12345';
  }

  /**
   * Convert stroops to XLM.
   * @param {string|number} stroops
   * @returns {string}
   */
  stroopsToXlm(stroops) {
    const numberValue = Number(stroops);
    if (Number.isNaN(numberValue)) {
      throw new ValidationError('Invalid stroops amount');
    }
    return (numberValue / 1e7).toFixed(7);
  }

  /**
   * Convert XLM to stroops.
   * @param {string|number} xlm
   * @returns {string}
   */
  xlmToStroops(xlm) {
    const numberValue = Number(xlm);
    if (Number.isNaN(numberValue)) {
      throw new ValidationError('Invalid XLM amount');
    }
    return BigInt(Math.round(numberValue * 1e7)).toString();
  }

  /**
   * Build a mock Stellar transaction.
   * @param {string} sourcePublicKey
   * @param {Array<Object>} operations
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async buildTransaction(sourcePublicKey, operations, options = {}) {
    if (!this.isValidAddress(sourcePublicKey)) {
      throw new ValidationError('Invalid source public key');
    }
    return {
      sourcePublicKey,
      operations: Array.isArray(operations) ? operations : [],
      options,
      mockTransactionId: `mock_tx_${crypto.randomBytes(8).toString('hex')}`,
    };
  }

  /**
   * Build a mock payment transaction.
   * @param {string} sourcePublicKey
   * @param {string} destinationPublicKey
   * @param {string|number} amount
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options = {}) {
    if (!this.isValidAddress(sourcePublicKey) || !this.isValidAddress(destinationPublicKey)) {
      throw new ValidationError('Invalid source or destination public key');
    }

    return this.buildTransaction(sourcePublicKey, [{
      type: 'payment',
      destination: destinationPublicKey,
      amount: String(amount),
      asset: options.asset || NATIVE_ASSET,
    }], options);
  }

  /**
   * Sign a mock transaction.
   * @param {Object} transaction
   * @param {string} secretKey
   * @returns {Promise<Object>}
   */
  async signTransaction(transaction, secretKey) {
    if (!transaction || typeof transaction !== 'object') {
      throw new ValidationError('Invalid transaction');
    }
    if (!secretKey || typeof secretKey !== 'string') {
      throw new ValidationError('Invalid secret key');
    }

    return {
      ...transaction,
      signature: `mock_sign_${crypto.randomBytes(12).toString('hex')}`,
      signedBy: secretKey,
      hash: `mock_hash_${crypto.randomBytes(12).toString('hex')}`,
    };
  }

  /**
   * Set a flag to make the next submitTransaction call fail.
   * @param {boolean} shouldFail
   * @returns {void}
   */
  setSubmitTransactionFailure(shouldFail) {
    this._submitTransactionShouldFail = Boolean(shouldFail);
  }

  /**
   * Submit a mock transaction.
   * @param {Object} tx
   * @returns {Promise<Object>}
   */
  async submitTransaction(tx) {
    if (!tx || typeof tx !== 'object') {
      throw new ValidationError('Invalid transaction');
    }

    if (this._submitTransactionShouldFail) {
      this._submitTransactionShouldFail = false;
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Mock submitTransaction failure');
    }

    const hash = tx.hash || `mock_submitted_${crypto.randomBytes(12).toString('hex')}`;
    return {
      successful: true,
      hash,
      ledger: Math.floor(Math.random() * 1000000) + 1,
      result: 'success',
    };
  }

  /**
   * Return account balances for a mock account.
   * @param {string} publicKey
   * @returns {Promise<Object>}
   */
  async getAccountBalances(publicKey) {
    if (!this.isValidAddress(publicKey)) {
      throw new ValidationError('Invalid public key');
    }
    const account = this.wallets.get(publicKey);
    if (!account) {
      throw new NotFoundError('Account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }
    this._ensureAssetBalances(account);
    return { balances: [{ asset_type: 'native', balance: account.assetBalances.native }] };
  }

  /**
   * Get a mock transaction by hash.
   * @param {string} transactionHash
   * @returns {Promise<Object>}
   */
  async getTransaction(transactionHash) {
    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new ValidationError('Invalid transaction hash');
    }

    for (const txList of this.transactions.values()) {
      const tx = txList.find((item) => item.transactionId === transactionHash || item.hash === transactionHash);
      if (tx) {
        return tx;
      }
    }

    throw new NotFoundError('Transaction not found', ERROR_CODES.TRANSACTION_NOT_FOUND);
  }

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
    for (const wallet of this.wallets.values()) {
      if (wallet.secretKey === secretKey) {
        return wallet;
      }
    }

    return null;
  }

  _ensureDestinationFunded(wallet) {
    const destBalance = parseFloat(wallet.balance);
    const minBalance = parseFloat(this.config.minAccountBalance);
    if (destBalance < minBalance) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Destination account is not funded. Stellar requires accounts to maintain a minimum balance of ${this.config.minAccountBalance} XLM. ` +
        'Please fund the account first using Friendbot (testnet) or send an initial funding transaction.'
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
    if (this.config.networkDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.networkDelay));
    }
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
    // eslint-disable-next-line no-secrets/no-secrets
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

  async createWallet() {
    await this._simulateNetworkDelay();
    this._checkRateLimit();

    const keypair = this._generateKeypair();
    this.wallets.set(keypair.publicKey, {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
      balance: '0.0000000',
      assetBalances: { native: '0.0000000' },
      createdAt: new Date().toISOString(),
      sequence: '0',
    });
    this.transactions.set(keypair.publicKey, []);

    return keypair;
  }

  async getBalance(publicKey) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validatePublicKey(publicKey);
      this._simulateFailure();

      const wallet = this.wallets.get(publicKey);
      if (!wallet) {
        throw new NotFoundError(
          `Account not found. The account ${publicKey} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      this._ensureAssetBalances(wallet);
      return {
        balance: parseFloat(wallet.assetBalances.native) === 0 ? '0' : wallet.assetBalances.native,
        asset: 'XLM',
      };
    });
  }

  async fundTestnetWallet(publicKey) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validatePublicKey(publicKey);
      this._simulateFailure();
      this._simulateRandomFailure();

      const wallet = this.wallets.get(publicKey);
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

      this._setWalletAssetBalance(wallet, NATIVE_ASSET, 10000);
      wallet.fundedAt = new Date().toISOString();
      wallet.sequence = '1';

      return { balance: wallet.assetBalances.native };
    });
  }

  /**
   * Fund a new account via Friendbot (testnet only).
   * On mainnet, logs a warning and returns { funded: false }.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{funded: boolean, balance?: string}>}
   */
  async fundWithFriendbot(publicKey) {
    if (this.network !== 'testnet') {
      return { funded: false };
    }
    try {
      const result = await this.fundTestnetWallet(publicKey);
      return { funded: true, balance: result.balance };
    } catch (err) {
      return { funded: false, error: err.message };
    }
  }

  /**
   * Check if an account is funded
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{funded: boolean, balance: string, exists: boolean}>}
   */
  async isAccountFunded(publicKey) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._validatePublicKey(publicKey);

    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      return { funded: false, balance: '0', exists: false };
    }

    const balance = parseFloat(wallet.balance);
    const minBalance = parseFloat(this.config.minAccountBalance);
    return {
      funded: balance >= minBalance,
      balance: wallet.balance,
      exists: true,
    };
  }

  /**
   * Send a mock donation transaction.
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.destinationPublic - Destination public key
   * @param {string} params.amount - Amount to transfer
   * @param {string} [params.memo] - Transaction memo
   * @param {string} [params.memoType='text'] - Stellar memo type
   * @param {Object} [params.asset=NATIVE_ASSET] - Asset to transfer
   * @param {number} [params.validAfter=0] - Unix timestamp of minimum valid time (0 = no limit)
   * @param {number} [params.validBefore=0] - Unix timestamp of maximum valid time (0 = no limit)
   * @returns {Promise<{transactionId: string, ledger: number, status: string, confirmedAt: string}>}
   */
  async sendDonation({ sourceSecret, destinationPublic, amount, memo, memoType = 'text', asset = NATIVE_ASSET, validAfter = 0, validBefore = 0 }) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validateSecretKey(sourceSecret);
      this._validatePublicKey(destinationPublic);
      this._validateAmount(amount);
      this._simulateFailure();
      this._simulateRandomFailure();

      // Validate time bounds: validAfter < validBefore if both are set
      if (validAfter && validBefore && validAfter >= validBefore) {
        throw new ValidationError('validAfter must be strictly less than validBefore');
      }

      // Check time bounds against current mock system time
      const currentTime = this.getCurrentSystemTime();
      
      if (validAfter && currentTime < validAfter) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Transaction error: Time bounds violation. Current time (${currentTime}) is before validAfter (${validAfter}). Transaction is not yet valid.`,
          { retryable: false }
        );
      }

      if (validBefore && currentTime > validBefore) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Transaction error: Time bounds violation. Current time (${currentTime}) is after validBefore (${validBefore}). Transaction has expired.`,
          { retryable: false }
        );
      }

      const MemoValidator = require('../utils/memoValidator');
      if (memo) {
        const memoValidation = MemoValidator.validateWithType(memo, memoType);
        if (!memoValidation.valid) {
          throw new ValidationError(memoValidation.error);
        }
      }

      const sourceWallet = this._findWalletBySecret(sourceSecret);
      if (!sourceWallet) {
        throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
      }
      if (sourceWallet.publicKey === destinationPublic) {
        throw new ValidationError('Source and destination accounts cannot be the same.');
      }

      const destWallet = this.wallets.get(destinationPublic);
      if (!destWallet) {
        throw new NotFoundError(
          `Destination account not found. The account ${destinationPublic} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      this._ensureDestinationFunded(destWallet);

      this._applyAssetTransfer({
        sourceWallet,
        destWallet,
        asset,
        amountNum: parseFloat(amount),
      });

      sourceWallet.sequence = (parseInt(sourceWallet.sequence, 10) + 1).toString();

      const transaction = this._storeTransaction({
        transactionId: `mock_${crypto.randomBytes(16).toString('hex')}`,
        source: sourceWallet.publicKey,
        destination: destinationPublic,
        amount: Number(amount).toFixed(7),
        asset: serializeAsset(asset),
        memo: memo || '',
        memoType,
        validAfter: validAfter || 0,
        validBefore: validBefore || 0,
        timestamp: new Date().toISOString(),
        ledger: Math.floor(Math.random() * 1000000) + 1000000,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        fee: '0.0000100',
        sequence: sourceWallet.sequence,
      });

      return {
        transactionId: transaction.transactionId,
        ledger: transaction.ledger,
        status: transaction.status,
        confirmedAt: transaction.confirmedAt,
      };
    });
  }

  /**
   * Discover a deterministic mock path quote between two assets.
   * @param {Object} params
   * @param {Object} params.sourceAsset - Source asset
   * @param {string} [params.sourceAmount] - Source amount
   * @param {Object} params.destAsset - Destination asset
   * @param {string} [params.destAmount] - Destination amount
   * @returns {Promise<Object|null>} Path estimate or null when unavailable
   */
  async discoverBestPath({ sourceAsset, sourceAmount, destAsset, destAmount }) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();

      if (this.failureSimulation.enabled && this.failureSimulation.type === 'no_path') {
        return null;
      }

      const rate = this._getConversionRate(sourceAsset, destAsset);
      if (!rate || !Number.isFinite(rate)) {
        return null;
      }

      const resolvedSourceAmount = sourceAmount || (parseFloat(destAmount) / rate).toFixed(7);
      const resolvedDestAmount = destAmount || (parseFloat(sourceAmount) * rate).toFixed(7);
      const conversionRate = (parseFloat(resolvedDestAmount) / parseFloat(resolvedSourceAmount)).toFixed(7);
      const path = sourceAsset.type !== 'native' && destAsset.type !== 'native'
        ? [serializeAsset(NATIVE_ASSET)]
        : [];

      return {
        sourceAsset: serializeAsset(sourceAsset),
        sourceAmount: resolvedSourceAmount,
        destAsset: serializeAsset(destAsset),
        destAmount: resolvedDestAmount,
        conversionRate,
        path,
      };
    });
  }

  /**
   * Execute a mock path payment using the deterministic quote produced by discoverBestPath.
   * @param {Object} sourceAsset - Source asset
   * @param {string} sourceAmount - Source amount
   * @param {Object} destAsset - Destination asset
   * @param {string} destAmount - Destination amount
   * @param {Array<Object>} path - Submitted path
   * @param {Object} [options={}] - Execution options
   * @returns {Promise<{transactionId: string, ledger: number, status: string, confirmedAt: string}>}
   */
  async pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options = {}) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._simulateFailure();

      if (this.failureSimulation.enabled && this.failureSimulation.type === 'path_payment_failed') {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Path payment failed on the Stellar DEX.'
        );
      }

      const estimate = await this.discoverBestPath({
        sourceAsset,
        sourceAmount,
        destAsset,
        destAmount,
      });

      if (!estimate) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'No Stellar path payment route was found.'
        );
      }

      const submittedPath = (path || []).map((asset) => serializeAsset(asset));
      if (JSON.stringify(submittedPath) !== JSON.stringify(estimate.path || [])) {
        throw new ValidationError('Submitted path does not match the server-discovered route');
      }

      const sourceWallet = this._findWalletBySecret(options.sourceSecret);
      if (!sourceWallet) {
        throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
      }

      const destWallet = this.wallets.get(options.destinationPublic);
      if (!destWallet) {
        throw new NotFoundError(
          `Destination account not found. The account ${options.destinationPublic} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      this._ensureDestinationFunded(destWallet);

      const sourceBalance = this._getWalletAssetBalance(sourceWallet, sourceAsset);
      if (sourceAsset.type === 'native') {
        const baseReserve = parseFloat(this.config.baseReserve);
        if (sourceBalance - parseFloat(sourceAmount) < baseReserve) {
          throw new BusinessLogicError(
            ERROR_CODES.TRANSACTION_FAILED,
            `Insufficient balance. Account must maintain minimum balance of ${this.config.baseReserve} XLM.`
          );
        }
      } else if (sourceBalance < parseFloat(sourceAmount)) {
        throw new BusinessLogicError(
          ERROR_CODES.INSUFFICIENT_BALANCE,
          `Insufficient ${sourceAsset.code} balance for payment`
        );
      }

      this._setWalletAssetBalance(sourceWallet, sourceAsset, sourceBalance - parseFloat(sourceAmount));
      const destBalance = this._getWalletAssetBalance(destWallet, destAsset);
      this._setWalletAssetBalance(destWallet, destAsset, destBalance + parseFloat(destAmount));
      sourceWallet.sequence = (parseInt(sourceWallet.sequence, 10) + 1).toString();

      const transaction = this._storeTransaction({
        transactionId: `mock_${crypto.randomBytes(16).toString('hex')}`,
        source: sourceWallet.publicKey,
        destination: options.destinationPublic,
        amount: Number(sourceAmount).toFixed(7),
        destinationAmount: Number(destAmount).toFixed(7),
        asset: serializeAsset(sourceAsset),
        destinationAsset: serializeAsset(destAsset),
        path: estimate.path || [],
        memo: options.memo || '',
        timestamp: new Date().toISOString(),
        ledger: Math.floor(Math.random() * 1000000) + 1000000,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        fee: '0.0000100',
        sequence: sourceWallet.sequence,
      });

      return {
        transactionId: transaction.transactionId,
        ledger: transaction.ledger,
        status: transaction.status,
        confirmedAt: transaction.confirmedAt,
        envelopeXdr: 'mock_envelope_' + crypto.randomBytes(8).toString('hex'),
        fee: 100,
      };
    });
  }

  /**
   * Send multiple payments from the same source in a single mock batch transaction.
   * @param {string} sourceSecret - Source account secret key
   * @param {Array<{destinationPublic: string, amount: string, memo?: string}>} payments - Payment list
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async sendBatchDonations(sourceSecret, payments) {
    let lastResult;
    for (const payment of payments) {
      lastResult = await this.sendDonation({
        sourceSecret,
        destinationPublic: payment.destinationPublic,
        amount: payment.amount,
        memo: payment.memo,
      });
    }
    return { transactionId: lastResult.transactionId, ledger: lastResult.ledger };
  }

  /**
   * Get mock transaction history
   * @param {string} publicKey - Stellar public key
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Promise<Array>}
   */
  async getTransactionHistory(publicKey, limit = 10) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._validatePublicKey(publicKey);

    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }

    return (this.transactions.get(publicKey) || []).slice(-limit).reverse();
  }

  async verifyTransaction(transactionHash) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();

    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new ValidationError('Transaction hash must be a valid string');
    }

    for (const txList of this.transactions.values()) {
      const transaction = txList.find((tx) => tx.transactionId === transactionHash);
      if (transaction) {
        return {
          verified: true,
          status: transaction.status,
          transaction: {
            id: transaction.transactionId,
            source: transaction.source,
            destination: transaction.destination,
            amount: transaction.amount,
            asset: transaction.asset,
            destinationAmount: transaction.destinationAmount,
            destinationAsset: transaction.destinationAsset,
            path: transaction.path,
            memo: transaction.memo,
            timestamp: transaction.timestamp,
            ledger: transaction.ledger,
            status: transaction.status,
            confirmedAt: transaction.confirmedAt,
            fee: transaction.fee,
            sequence: transaction.sequence,
          },
        };
      }
    }

    throw new NotFoundError(
      `Transaction not found. The transaction ${transactionHash} does not exist on the network.`,
      ERROR_CODES.TRANSACTION_NOT_FOUND
    );
  }

  streamTransactions(publicKey, onTransaction) {
    this._validatePublicKey(publicKey);

    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }
    if (typeof onTransaction !== 'function') {
      throw new ValidationError('onTransaction must be a function');
    }

    if (!this.streamListeners.has(publicKey)) {
      this.streamListeners.set(publicKey, []);
    }
    this.streamListeners.get(publicKey).push(onTransaction);

    return () => {
      const listeners = this.streamListeners.get(publicKey);
      if (listeners) {
        const index = listeners.indexOf(onTransaction);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  _notifyStreamListeners(publicKey, transaction) {
    const listeners = this.streamListeners.get(publicKey) || [];
    listeners.forEach((callback) => {
      try {
        callback(transaction);
      } catch (error) {
        log.error('MOCK_STELLAR_SERVICE', 'Stream listener callback failed', { error: error.message });
      }
    });
  }

  async sendPayment(sourcePublicKey, destinationPublic, amount, memo = '') {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validatePublicKey(sourcePublicKey);
      this._validatePublicKey(destinationPublic);
      this._validateAmount(amount.toString());
      this._simulateFailure();
      this._simulateRandomFailure();

      let sourceWallet = this.wallets.get(sourcePublicKey);
      if (!sourceWallet) {
        sourceWallet = {
          publicKey: sourcePublicKey,
          secretKey: this._generateKeypair().secretKey,
          balance: '10000.0000000',
          assetBalances: { native: '10000.0000000' },
          createdAt: new Date().toISOString(),
          sequence: '0',
        };
        this.wallets.set(sourcePublicKey, sourceWallet);
      }

      let destWallet = this.wallets.get(destinationPublic);
      if (!destWallet) {
        destWallet = {
          publicKey: destinationPublic,
          secretKey: this._generateKeypair().secretKey,
          balance: '1.0000000',
          assetBalances: { native: '1.0000000' },
          createdAt: new Date().toISOString(),
          sequence: '0',
        };
        this.wallets.set(destinationPublic, destWallet);
      }

      this._applyAssetTransfer({
        sourceWallet,
        destWallet,
        asset: NATIVE_ASSET,
        amountNum: parseFloat(amount),
      });
      sourceWallet.sequence = (parseInt(sourceWallet.sequence, 10) + 1).toString();

      const transaction = this._storeTransaction({
        hash: `mock_${crypto.randomBytes(16).toString('hex')}`,
        source: sourcePublicKey,
        destination: destinationPublic,
        amount: Number(amount).toFixed(7),
        memo,
        timestamp: new Date().toISOString(),
        ledger: Math.floor(Math.random() * 1000000) + 1000000,
        status: 'confirmed',
        fee: '0.0000100',
        sequence: sourceWallet.sequence,
      });

      log.info('MOCK_STELLAR_SERVICE', 'Payment simulated', {
        amount: Number(amount).toFixed(7),
        source: `${sourcePublicKey.substring(0, 8)}...`,
        destination: `${destinationPublic.substring(0, 8)}...`,
      });

      return {
        hash: transaction.hash,
        ledger: transaction.ledger,
      };
    });
  }

  getSecretForPublicKey(publicKey) {
    const wallet = this.wallets.get(publicKey);
    return wallet ? wallet.secretKey : null;
  }

  setAssetBalance(publicKey, asset, amount) {
    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }

    this._setWalletAssetBalance(wallet, asset, Number(amount));
  }

  /**
   * Clear all mock data (useful for testing).
   * @private
   */
  _clearAllData() {
    this.wallets.clear();
    this.transactions.clear();
    this.streamListeners.clear();
    if (this.claimableBalances) this.claimableBalances.clear();
    if (this.offers) this.offers.clear();
    if (this.sponsorships) this.sponsorships.clear();
  }

  _getState() {
    return {
      wallets: Array.from(this.wallets.values()),
      transactions: Object.fromEntries(this.transactions),
      streamListeners: this.streamListeners.size,
    };
  }

  /**
   * Create a claimable balance on the mock Stellar network.
   *
   * @param {Object} params
   * @param {string} params.sourceSecret - Funding account secret key
   * @param {string} params.amount - Amount in XLM
   * @param {Array<{destination: string, predicate?: Object}>} params.claimants - List of claimants
   * @param {Object} [params.predicate] - Optional time-based predicate applied to all claimants
   * @returns {Promise<{balanceId: string, transactionId: string, ledger: number}>}
   */
  async createClaimableBalance({ sourceSecret, amount, claimants, predicate = null }) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    this._validateSecretKey(sourceSecret);
    this._validateAmount(amount);

    if (!Array.isArray(claimants) || claimants.length === 0) {
      throw new ValidationError('At least one claimant is required');
    }
    if (claimants.length > 10) {
      throw new ValidationError('Maximum 10 claimants allowed');
    }
    for (const c of claimants) {
      this._validatePublicKey(c.destination);
    }

    // Derive source public key from secret (mock: just look it up or derive)
    const sourcePublic = this._secretToPublic(sourceSecret);
    const wallet = this.wallets.get(sourcePublic);
    if (!wallet) {
      throw new NotFoundError('Source account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const amountNum = parseFloat(amount);
    const balanceNum = parseFloat(wallet.balance);
    if (balanceNum < amountNum) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Insufficient balance for claimable balance creation'
      );
    }

    // Deduct from source
    wallet.balance = (balanceNum - amountNum).toFixed(7);

    const balanceId = `00000000${crypto.randomBytes(28).toString('hex')}`;
    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    if (!this.claimableBalances) this.claimableBalances = new Map();

    this.claimableBalances.set(balanceId, {
      balanceId,
      amount,
      claimants: claimants.map(c => ({ destination: c.destination, predicate: c.predicate || predicate || null })),
      sponsor: sourcePublic,
      claimed: false,
      claimedBy: null,
      createdAt: new Date().toISOString(),
      predicate,
    });

    return { balanceId, transactionId: txId, ledger };
  }

  /**
   * Claim a claimable balance.
   *
   * @param {Object} params
   * @param {string} params.balanceId - Claimable balance ID
   * @param {string} params.claimantSecret - Claimant account secret key
   * @returns {Promise<{transactionId: string, ledger: number, amount: string}>}
   */
  async claimBalance({ balanceId, claimantSecret }) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    this._validateSecretKey(claimantSecret);

    if (!this.claimableBalances) this.claimableBalances = new Map();

    const balance = this.claimableBalances.get(balanceId);
    if (!balance) {
      throw new NotFoundError('Claimable balance not found', ERROR_CODES.NOT_FOUND);
    }
    if (balance.claimed) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Claimable balance has already been claimed'
      );
    }

    const claimantPublic = this._secretToPublic(claimantSecret);
    const eligible = balance.claimants.find(c => c.destination === claimantPublic);
    if (!eligible) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Account is not an eligible claimant for this balance'
      );
    }

    // Check time predicate if present
    const pred = eligible.predicate || balance.predicate;
    if (pred) {
      const now = Date.now();
      if (pred.notBefore && now < pred.notBefore) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Claimable balance is not yet available (notBefore condition not met)'
        );
      }
      if (pred.notAfter && now > pred.notAfter) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Claimable balance has expired (notAfter condition exceeded)'
        );
      }
    }

    // Credit claimant
    let claimantWallet = this.wallets.get(claimantPublic);
    if (!claimantWallet) {
      // Auto-create wallet for unactivated accounts (the main use-case)
      claimantWallet = { publicKey: claimantPublic, balance: '0', createdAt: new Date().toISOString() };
      this.wallets.set(claimantPublic, claimantWallet);
    }
    claimantWallet.balance = (parseFloat(claimantWallet.balance) + parseFloat(balance.amount)).toFixed(7);

    balance.claimed = true;
    balance.claimedBy = claimantPublic;
    balance.claimedAt = new Date().toISOString();

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    return { transactionId: txId, ledger, amount: balance.amount };
  }

  /**
   * Simulate submitting a fully-signed multi-sig transaction.
   *
   * @param {Object} params
   * @param {string}   params.transaction_xdr    - Base-64 XDR of the unsigned transaction
   * @param {string}   params.network_passphrase - Stellar network passphrase
   * @param {Object[]} params.signatures         - [{signer, signed_xdr}]
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async submitMultiSigTransaction({ transaction_xdr, network_passphrase, signatures }) {
    this._simulateFailure();

    if (!transaction_xdr || !network_passphrase) {
      throw new ValidationError('transaction_xdr and network_passphrase are required');
    }
    if (!Array.isArray(signatures) || signatures.length === 0) {
      throw new ValidationError('At least one signature is required');
    }

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    log.info('MOCK_STELLAR_SERVICE', 'Multi-sig transaction submitted', {
      txId,
      ledger,
      signerCount: signatures.length,
    });

    return { transactionId: txId, ledger };
  }

  /**
   * Simulate (dry-run) a Stellar transaction without hitting any real Horizon endpoint.
   *
   * Behavior:
   * - Returns `success: false` with a descriptive error if `xdr` is falsy, empty, or null.
   * - Returns `success: false` with the configured failure message when failure simulation
   *   is enabled (`this.failureSimulation.enabled` is true).
   * - Otherwise returns `success: true` with a realistic `estimatedFee` based on the
   *   configured mock fee multiplier, a stub `estimatedResult`, and a `simulatedAt` timestamp.
   *
   * Configurable failure modes:
   * - Call `enableFailureSimulation(type)` before invoking this method to trigger a
   *   `success: false` result. The `errors` array will reflect the configured failure type.
   *
   * IMPORTANT: This method never calls any real Horizon network endpoint.
   *
   * @param {string} xdr - Base64-encoded Stellar transaction envelope XDR (not validated in mock)
   * @returns {Promise<{
   *   success: boolean,
   *   estimatedFee?: { stroops: number, xlm: string },
   *   estimatedResult?: { operationType: string, sourceAccount: string|null, destinationAccount: string|null },
   *   errors?: string[],
   *   simulatedAt: string
   * }>} Simulation_Result
   */
  async simulateTransaction(xdr) {
    const simulatedAt = new Date().toISOString();

    // Guard: xdr must be a non-empty string
    if (!xdr || typeof xdr !== 'string' || xdr.trim() === '') {
      return {
        success: false,
        errors: ['xdr is required and must be a non-empty string'],
        simulatedAt,
      };
    }

    // Failure simulation
    if (this.failureSimulation.enabled) {
      const failureType = this.failureSimulation.type || 'unknown';
      return {
        success: false,
        errors: [`Simulation failed: ${failureType}`],
        simulatedAt,
      };
    }

    // Return a realistic success result
    const BASE_FEE_STROOPS = 100;
    const multiplier = this.config.feeMultiplier !== undefined ? this.config.feeMultiplier : 1;
    const feePerOp = Math.round(BASE_FEE_STROOPS * multiplier);
    const estimatedFeeStroops = feePerOp; // mock assumes 1 operation

    return {
      success: true,
      estimatedFee: {
        stroops: estimatedFeeStroops,
        xlm: (estimatedFeeStroops / 1e7).toFixed(7),
      },
      estimatedResult: {
        operationType: 'payment',
        sourceAccount: null,
        destinationAccount: null,
      },
      simulatedAt,
    };
  }

  /**
   * Estimate the transaction fee for a given number of operations.
   * Simulates fee variations including surge pricing.
   * @param {number} [operationCount=1]
   * @returns {Promise<{feeStroops: number, feeXLM: string, baseFee: number, surgeProtection: boolean, surgeMultiplier: number}>}
   */
  async estimateFee(operationCount = 1) {
    await this._simulateNetworkDelay();
    this._simulateFailure();

    const BASE_FEE_STROOPS = 100;
    // Simulate fee multiplier: normally 1x, occasionally surge (configurable via config.feeMultiplier)
    const multiplier = this.config.feeMultiplier !== undefined ? this.config.feeMultiplier : 1;
    const recommendedFee = Math.round(BASE_FEE_STROOPS * multiplier);
    const totalFeeStroops = recommendedFee * operationCount;
    const surgeProtection = multiplier >= 5;

    return {
      feeStroops: totalFeeStroops,
      feeXLM: (totalFeeStroops / 1e7).toFixed(7),
      baseFee: BASE_FEE_STROOPS,
      surgeProtection,
      surgeMultiplier: parseFloat(multiplier.toFixed(2)),
    };
  }

  /**
   * Mock implementation of fee bump transaction.
   * @param {string} envelopeXdr - Original transaction envelope XDR (not validated in mock)
   * @param {number} newFeeStroops - New fee in stroops
   * @param {string} feeSourceSecret - Fee source secret key (validated for format only)
   * @returns {Promise<{hash: string, ledger: number, fee: number, envelopeXdr: string}>}
   */
  async buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    if (!envelopeXdr) {
      throw new ValidationError('envelopeXdr is required');
    }
    if (!newFeeStroops || newFeeStroops < 100) {
      throw new ValidationError('newFeeStroops must be at least 100 (base fee)');
    }
    if (feeSourceSecret) {
      this._validateSecretKey(feeSourceSecret);
    }

    const hash = 'mock_feebump_' + crypto.randomBytes(16).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    log.info('MOCK_STELLAR_SERVICE', 'Fee bump transaction submitted', {
      originalEnvelopeLength: envelopeXdr.length,
      newFeeStroops,
      hash,
      ledger,
    });

    return {
      hash,
      ledger,
      fee: newFeeStroops,
      envelopeXdr: 'mock_feebump_envelope_' + crypto.randomBytes(8).toString('hex'),
    };
  }

  /**
   * Simulate bumping an account's sequence number.
   * Updates the in-memory wallet sequence and returns a mock transaction result.
   *
   * @param {string} secret - Secret key of the account to bump
   * @param {string|number} bumpTo - Target sequence number (must be > current)
   * @returns {Promise<{hash: string, ledger: number, newSequence: string}>}
   */
  async bumpSequence(secret, bumpTo) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    if (!secret) {
      throw new ValidationError('secret is required');
    }
    this._validateSecretKey(secret);

    const bumpToNum = BigInt(bumpTo);
    if (bumpToNum < BigInt(0)) {
      throw new ValidationError('bumpTo must be a non-negative integer');
    }

    const wallet = this._findWalletBySecret(secret);
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

  /**
   * Create a mock DEX offer.
   *
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.sellingAsset - Asset being sold ('XLM' or 'CODE:ISSUER')
   * @param {string} params.buyingAsset  - Asset being bought ('XLM' or 'CODE:ISSUER')
   * @param {string} params.amount       - Amount of selling asset
   * @param {string} params.price        - Price ratio 'n/d' or decimal string
   * @param {number} [params.offerId=0]  - 0 to create; existing ID to update/cancel
   * @returns {Promise<{offerId: number, transactionId: string, ledger: number}>}
   */
  async createOffer({ sourceSecret, sellingAsset, buyingAsset, amount, price, offerId = 0 }) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();
    this._validateSecretKey(sourceSecret);

    if (!sellingAsset || !buyingAsset) throw new ValidationError('sellingAsset and buyingAsset are required');
    if (sellingAsset === buyingAsset) throw new ValidationError('sellingAsset and buyingAsset must be different');

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) throw new ValidationError('amount must be a non-negative number');

    const priceNum = typeof price === 'string' && price.includes('/')
      ? parseInt(price.split('/')[0], 10) / parseInt(price.split('/')[1], 10)
      : parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) throw new ValidationError('price must be a positive number');

    const sourcePublic = this._secretToPublic(sourceSecret);
    const wallet = this.wallets.get(sourcePublic);
    if (!wallet) throw new NotFoundError('Source account not found', ERROR_CODES.WALLET_NOT_FOUND);

    if (!this.offers) this.offers = new Map();

    // Cancel (amount=0) or update existing offer
    if (offerId !== 0) {
      const existing = this.offers.get(offerId);
      if (!existing) throw new NotFoundError(`Offer ${offerId} not found`, ERROR_CODES.NOT_FOUND);
      if (existing.seller !== sourcePublic) throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Not the offer owner');
      if (amountNum === 0) {
        this.offers.delete(offerId);
      } else {
        existing.amount = amountNum.toFixed(7);
        existing.price = priceNum.toFixed(7);
      }
      const txId = crypto.randomBytes(32).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;
      return { offerId, transactionId: txId, ledger };
    }

    // Create new offer
    const newOfferId = Date.now() * 1000 + (this._offerCounter = ((this._offerCounter || 0) + 1) % 1000);
    this.offers.set(newOfferId, {
      id: newOfferId,
      seller: sourcePublic,
      sellingAsset,
      buyingAsset,
      amount: amountNum.toFixed(7),
      price: priceNum.toFixed(7),
      createdAt: new Date().toISOString(),
    });

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { offerId: newOfferId, transactionId: txId, ledger };
  }

  /**
   * Cancel a mock DEX offer.
   *
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.sellingAsset - Asset being sold in the offer
   * @param {string} params.buyingAsset  - Asset being bought in the offer
   * @param {number} params.offerId      - ID of the offer to cancel
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async cancelOffer({ sourceSecret, sellingAsset, buyingAsset, offerId }) {
    const result = await this.createOffer({ sourceSecret, sellingAsset, buyingAsset, amount: '0', price: '1', offerId });
    return { transactionId: result.transactionId, ledger: result.ledger };
  }

  /**
   * Merge a source account into a destination account (mock implementation).
   *
   * Transfers the entire balance of the source account to the destination,
   * then marks the source wallet as merged/closed in the in-memory store.
   *
   * @param {string} sourceSecret      - Secret key of the account to merge (close)
   * @param {string} destinationPublic - Public key of the account to receive all funds
   * @returns {Promise<{hash: string, ledger: number, mergedAmount: string}>}
   * @throws {ValidationError}    If keys are invalid or accounts are the same
   * @throws {NotFoundError}      If source or destination account does not exist
   * @throws {BusinessLogicError} If simulated failure is active
   */
  async mergeAccount(sourceSecret, destinationPublic) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validateSecretKey(sourceSecret);
      this._validatePublicKey(destinationPublic);
      this._simulateFailure();

      // Resolve source wallet by secret key
      let sourceWallet = null;
      for (const wallet of this.wallets.values()) {
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

      const destWallet = this.wallets.get(destinationPublic);
      if (!destWallet) {
        throw new NotFoundError(
          `Destination account not found. The account ${destinationPublic} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      const mergedAmount = sourceWallet.balance;
      const mergedAmountNum = parseFloat(mergedAmount);

      // Transfer entire balance to destination
      destWallet.balance = (parseFloat(destWallet.balance) + mergedAmountNum).toFixed(7);

      // Close source account (zero balance, mark merged)
      sourceWallet.balance = '0';
      sourceWallet.merged = true;
      sourceWallet.mergedAt = new Date().toISOString();
      sourceWallet.mergedInto = destinationPublic;

      const hash = 'mock_merge_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      // Record merge transaction for both accounts
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

      if (!this.transactions.has(sourceWallet.publicKey)) {
        this.transactions.set(sourceWallet.publicKey, []);
      }
      if (!this.transactions.has(destinationPublic)) {
        this.transactions.set(destinationPublic, []);
      }
      this.transactions.get(sourceWallet.publicKey).push(tx);
      this.transactions.get(destinationPublic).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Account merge simulated', {
        source: `${sourceWallet.publicKey.substring(0, 8)}...`,
        destination: `${destinationPublic.substring(0, 8)}...`,
        mergedAmount,
      });

      return { hash, ledger, mergedAmount };
    });
  }

  /**
   * Issue a custom Stellar asset to a recipient (mock implementation).
   *
   * Validates inputs, creates an in-memory asset balance for the recipient,
   * and records the issuance transaction.
   *
   * @param {string} issuerSecret    - Secret key of the issuer account
   * @param {string} assetCode       - Asset code (1-12 alphanumeric characters)
   * @param {string} amount          - Amount to issue
   * @param {string} recipientPublic - Public key of the recipient
  /**
   * Mock implementation of addTrustline (changeTrust operation).
   *
   * Stores the trustline limit in `this.trustlines` keyed by
   * `${accountPublic}:${assetCode}:${issuerPublic}` so tests can verify state.
   *
   * @param {string} accountSecret - Secret key of the trusting account
   * @param {string} assetCode     - Asset code (1-12 alphanumeric characters)
   * @param {string} issuerPublic  - Public key of the asset issuer
   * @param {string|null} [limit]  - Trust limit string, or null for unlimited
   * @returns {Promise<{hash: string, ledger: number, assetCode: string, issuerPublic: string, limit: string}>}
   * @throws {ValidationError} If inputs are invalid or limit exceeds Stellar maximum
   */
  async addTrustline(accountSecret, assetCode, issuerPublic, limit = null) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._validateSecretKey(accountSecret);
    this._validatePublicKey(issuerPublic);
    this._simulateFailure();

    if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
      throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
    }

    const STELLAR_MAX_LIMIT = '922337203685.4775807';

    if (limit !== null && limit !== undefined) {
      const limitNum = parseFloat(limit);
      if (isNaN(limitNum) || limitNum <= 0) {
        throw new ValidationError('Trust limit must be a positive numeric string');
      }
      if (parseFloat(limit) > parseFloat(STELLAR_MAX_LIMIT)) {
        throw new ValidationError(`Trust limit cannot exceed Stellar maximum of ${STELLAR_MAX_LIMIT}`);
      }
    }

    // Resolve account public key from secret
    let accountPublic = null;
    for (const w of this.wallets.values()) {
      if (w.secretKey === accountSecret) { accountPublic = w.publicKey; break; }
    }
    if (!accountPublic) {
      throw new ValidationError('Invalid account secret key. No matching account found.');
    }

    const resolvedLimit = limit !== null && limit !== undefined ? String(limit) : STELLAR_MAX_LIMIT;

    // Store trustline state for test verification
    if (!this.trustlines) this.trustlines = new Map();
    const key = `${accountPublic}:${assetCode}:${issuerPublic}`;
    this.trustlines.set(key, { assetCode, issuerPublic, limit: resolvedLimit, accountPublic });

    const hash = 'mock_trustline_' + crypto.randomBytes(16).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    log.info('MOCK_STELLAR_SERVICE', 'Trustline established', {
      assetCode, issuerPublic, limit: resolvedLimit, hash,
    });

    return { hash, ledger, assetCode, issuerPublic, limit: resolvedLimit };
  }

  /**
   * Retrieve a stored trustline from mock state (test helper).
   * @param {string} accountPublic - Public key of the trusting account
   * @param {string} assetCode     - Asset code
   * @param {string} issuerPublic  - Issuer public key
   * @returns {Object|undefined}
   */
  getTrustline(accountPublic, assetCode, issuerPublic) {
    if (!this.trustlines) return undefined;
    return this.trustlines.get(`${accountPublic}:${assetCode}:${issuerPublic}`);
  }

  /**
   * @returns {Promise<{hash: string, ledger: number, assetCode: string, issuerPublic: string, amount: string}>}
   * @throws {ValidationError}    If inputs are invalid
   * @throws {BusinessLogicError} If simulated failure is active
   */
  async issueAsset(issuerSecret, assetCode, amount, recipientPublic) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validateSecretKey(issuerSecret);
      this._validatePublicKey(recipientPublic);
      this._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      // Resolve issuer wallet
      let issuerWallet = null;
      for (const w of this.wallets.values()) {
        if (w.secretKey === issuerSecret) { issuerWallet = w; break; }
      }
      if (!issuerWallet) {
        throw new ValidationError('Invalid issuer secret key. No matching account found.');
      }

      if (issuerWallet.publicKey === recipientPublic) {
        throw new ValidationError('Issuer and recipient cannot be the same account');
      }

      // Ensure recipient wallet exists
      if (!this.wallets.has(recipientPublic)) {
        throw new NotFoundError(
          `Recipient account not found: ${recipientPublic}`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      // Track asset balances: assetKey -> Map<holderPublic, balance>
      if (!this.assetBalances) this.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerWallet.publicKey}`;
      if (!this.assetBalances.has(assetKey)) this.assetBalances.set(assetKey, new Map());

      const holders = this.assetBalances.get(assetKey);
      const current = parseFloat(holders.get(recipientPublic) || '0');
      holders.set(recipientPublic, (current + amountNum).toFixed(7));

      const hash = 'mock_issue_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash, type: 'asset_issuance', assetCode,
        issuer: issuerWallet.publicKey, recipient: recipientPublic,
        amount: amountNum.toFixed(7), timestamp: new Date().toISOString(),
        ledger, status: 'confirmed',
      };

      if (!this.transactions.has(issuerWallet.publicKey)) this.transactions.set(issuerWallet.publicKey, []);
      if (!this.transactions.has(recipientPublic)) this.transactions.set(recipientPublic, []);
      this.transactions.get(issuerWallet.publicKey).push(tx);
      this.transactions.get(recipientPublic).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Asset issued', {
        assetCode, amount: amountNum.toFixed(7),
        issuer: `${issuerWallet.publicKey.substring(0, 8)}...`,
        recipient: `${recipientPublic.substring(0, 8)}...`,
      });

      return {
        hash, ledger, assetCode,
        issuerPublic: issuerWallet.publicKey,
        amount: amountNum.toFixed(7),
      };
    });
  }

  /**
   * Burn a custom Stellar asset by sending it back to the issuer (mock implementation).
   *
   * Deducts the amount from the holder's in-memory balance.
   *
   * @param {string} holderSecret  - Secret key of the asset holder
   * @param {string} assetCode     - Asset code to burn
   * @param {string} issuerPublic  - Public key of the asset issuer
   * @param {string} amount        - Amount to burn
   * @returns {Promise<{hash: string, ledger: number, assetCode: string, amount: string}>}
   * @throws {ValidationError}    If inputs are invalid or insufficient balance
   * @throws {BusinessLogicError} If simulated failure is active
   */
  async burnAsset(holderSecret, assetCode, issuerPublic, amount) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validateSecretKey(holderSecret);
      this._validatePublicKey(issuerPublic);
      this._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      // Resolve holder wallet
      let holderWallet = null;
      for (const w of this.wallets.values()) {
        if (w.secretKey === holderSecret) { holderWallet = w; break; }
      }
      if (!holderWallet) {
        throw new ValidationError('Invalid holder secret key. No matching account found.');
      }

      if (holderWallet.publicKey === issuerPublic) {
        throw new ValidationError('Holder and issuer cannot be the same account');
      }

      if (!this.assetBalances) this.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerPublic}`;
      const holders = this.assetBalances.get(assetKey);
      const currentBalance = parseFloat((holders && holders.get(holderWallet.publicKey)) || '0');

      if (currentBalance < amountNum) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Insufficient asset balance. Have ${currentBalance.toFixed(7)}, need ${amountNum.toFixed(7)}`
        );
      }

      // Deduct from holder
      if (!holders) this.assetBalances.set(assetKey, new Map());
      this.assetBalances.get(assetKey).set(
        holderWallet.publicKey,
        (currentBalance - amountNum).toFixed(7)
      );

      const hash = 'mock_burn_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash, type: 'asset_burn', assetCode,
        issuer: issuerPublic, holder: holderWallet.publicKey,
        amount: amountNum.toFixed(7), timestamp: new Date().toISOString(),
        ledger, status: 'confirmed',
      };

      if (!this.transactions.has(holderWallet.publicKey)) this.transactions.set(holderWallet.publicKey, []);
      this.transactions.get(holderWallet.publicKey).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Asset burned', {
        assetCode, amount: amountNum.toFixed(7),
        holder: `${holderWallet.publicKey.substring(0, 8)}...`,
      });

      return { hash, ledger, assetCode, amount: amountNum.toFixed(7) };
    });
  }

  /**
   * Mock implementation of clawback.
   * Reclaims an asset from a holder back to the issuer.
   *
   * @param {string} issuerSecret - Secret key of the asset issuer
   * @param {string} from         - Public key of the holder to clawback from
   * @param {string} assetCode    - Asset code
   * @param {string} amount       - Amount to clawback
   * @returns {Promise<{hash: string, ledger: number, assetCode: string, from: string, amount: string}>}
   */
  async clawback(issuerSecret, from, assetCode, amount) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validateSecretKey(issuerSecret);
      this._validatePublicKey(from);
      this._simulateFailure();

      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new ValidationError('Amount must be a positive number');
      }

      const issuerWallet = this._findWalletBySecret(issuerSecret);
      if (!issuerWallet) throw new ValidationError('Invalid issuer secret key');

      if (!this.assetBalances) this.assetBalances = new Map();
      const assetKey = `${assetCode}:${issuerWallet.publicKey}`;
      const holders = this.assetBalances.get(assetKey) || new Map();
      const currentBalance = parseFloat(holders.get(from) || '0');

      if (currentBalance < amountNum) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Insufficient asset balance for clawback. Have ${currentBalance.toFixed(7)}, need ${amountNum.toFixed(7)}`
        );
      }

      holders.set(from, (currentBalance - amountNum).toFixed(7));
      this.assetBalances.set(assetKey, holders);

      const hash = 'mock_clawback_' + crypto.randomBytes(16).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;

      const tx = {
        hash, type: 'clawback', assetCode,
        issuer: issuerWallet.publicKey, from,
        amount: amountNum.toFixed(7), timestamp: new Date().toISOString(),
        ledger, status: 'confirmed',
      };
      if (!this.transactions.has(issuerWallet.publicKey)) this.transactions.set(issuerWallet.publicKey, []);
      this.transactions.get(issuerWallet.publicKey).push(tx);

      log.info('MOCK_STELLAR_SERVICE', 'Asset clawback executed', {
        assetCode, amount: amountNum.toFixed(7), from: `${from.substring(0, 8)}...`,
      });

      return { hash, ledger, assetCode, from, amount: amountNum.toFixed(7) };
    });
  }

  /**
   * Get all holders of a specific asset (mock implementation).
   *
   * @param {string} assetCode    - Asset code
   * @param {string} issuerPublic - Issuer public key
   * @returns {Array<{holderPublicKey: string, balance: string}>}
   */
  getAssetHolders(assetCode, issuerPublic) {
    if (!this.assetBalances) return [];
    const assetKey = `${assetCode}:${issuerPublic}`;
    const holders = this.assetBalances.get(assetKey);
    if (!holders) return [];
    return Array.from(holders.entries())
      .filter(([, bal]) => parseFloat(bal) > 0)
      .map(([holderPublicKey, balance]) => ({ holderPublicKey, balance }));
  }



  /**
   * Get mock service state (useful for testing)
   * @private
   * Get the mock order book for a trading pair.
   *
   * @param {string} sellingAsset - Base asset ('XLM' or 'CODE:ISSUER')
   * @param {string} buyingAsset  - Counter asset ('XLM' or 'CODE:ISSUER')
   * @param {number} [limit=20]   - Max entries per side
   * @returns {Promise<{bids: Array, asks: Array, base: Object, counter: Object}>}
   */
  async getOrderBook(sellingAsset, buyingAsset, limit = 20) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    if (!sellingAsset || !buyingAsset) throw new ValidationError('sellingAsset and buyingAsset are required');

    if (!this.offers) this.offers = new Map();

    const asks = Array.from(this.offers.values())
      .filter(o => o.sellingAsset === sellingAsset && o.buyingAsset === buyingAsset)
      .slice(0, limit)
      .map(o => ({ price: o.price, amount: o.amount, price_r: { n: 1, d: 1 } }));

    const bids = Array.from(this.offers.values())
      .filter(o => o.sellingAsset === buyingAsset && o.buyingAsset === sellingAsset)
      .slice(0, limit)
      .map(o => ({ price: o.price, amount: o.amount, price_r: { n: 1, d: 1 } }));

    return {
      bids,
      asks,
      base: { asset_type: sellingAsset === 'XLM' ? 'native' : 'credit_alphanum4', asset_code: sellingAsset },
      counter: { asset_type: buyingAsset === 'XLM' ? 'native' : 'credit_alphanum4', asset_code: buyingAsset },
    };
  }

  /**
   * Create a sponsored account in the mock service.
   *
   * @param {string} sponsorSecret    - Secret key of the sponsoring account
   * @param {string} newAccountPublic - Public key of the new account to sponsor
   * @returns {Promise<{transactionId: string, ledger: number, sponsored: true}>}
   */
  async createSponsoredAccount(sponsorSecret, newAccountPublic) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();
    this._validateSecretKey(sponsorSecret);
    this._validatePublicKey(newAccountPublic);

    const sponsorPublic = this._secretToPublic(sponsorSecret);
    if (!this.wallets.has(sponsorPublic)) {
      throw new NotFoundError('Sponsor account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }
    if (this.wallets.has(newAccountPublic)) {
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Account already exists');
    }

    // Create the new account with zero balance — sponsor covers the reserve
    this.wallets.set(newAccountPublic, {
      publicKey: newAccountPublic,
      balance: '0.0000000',
      sponsored: true,
      sponsoredBy: sponsorPublic,
      createdAt: new Date().toISOString(),
      sequence: '0',
    });
    this.transactions.set(newAccountPublic, []);

    if (!this.sponsorships) this.sponsorships = new Map();
    this.sponsorships.set(newAccountPublic, { sponsor: sponsorPublic, revokedAt: null });

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { transactionId: txId, ledger, sponsored: true };
  }

  /**
   * Revoke sponsorship for an account in the mock service.
   *
   * @param {string} sponsorSecret   - Secret key of the current sponsor
   * @param {string} sponsoredPublic - Public key of the sponsored account
   * @returns {Promise<{transactionId: string, ledger: number, revoked: true}>}
   */
  async revokeSponsoredAccount(sponsorSecret, sponsoredPublic) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();
    this._validateSecretKey(sponsorSecret);
    this._validatePublicKey(sponsoredPublic);

    const sponsorPublic = this._secretToPublic(sponsorSecret);
    if (!this.wallets.has(sponsorPublic)) {
      throw new NotFoundError('Sponsor account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    if (!this.sponsorships) this.sponsorships = new Map();
    const record = this.sponsorships.get(sponsoredPublic);
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
    const wallet = this.wallets.get(sponsoredPublic);
    if (wallet) { wallet.sponsored = false; wallet.sponsoredBy = null; }

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { transactionId: txId, ledger, revoked: true };
  }

  /**
   * Set or update an account data entry (mock implementation)
   * @param {string} secret - Secret key of the account
   * @param {string} key - Data entry key
   * @param {string} value - Data entry value
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async setAccountData(secret, key, value) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    const publicKey = this._secretToPublic(secret);
    if (!this.wallets.has(publicKey)) throw new NotFoundError('Account not found');
    if (!this.wallets.get(publicKey)._data) this.wallets.get(publicKey)._data = {};
    this.wallets.get(publicKey)._data[key] = value;
    const hash = `mock_${require('crypto').randomBytes(16).toString('hex')}`;
    return { hash, ledger: Math.floor(Math.random() * 1000000) + 1 };
  }

  /**
   * Load a mock account object for the given public key.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{id: string, sequence: string, balances: Array}>}
   * @throws {NotFoundError} if the account does not exist
   */
  async loadAccount(publicKey) {
    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }

    // Initialize data_attr if it doesn't exist
    if (!wallet.data_attr) {
      wallet.data_attr = {};
    }

    // Store the value (base64-encoded to simulate Stellar's binary storage)
    wallet.data_attr[key] = Buffer.from(value).toString('base64');

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { hash: txId, ledger };
  }

  /**
   * Delete an account data entry by setting its value to null
   * @param {string} secret - Secret key of the account
   * @param {string} key - Data entry key to delete
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async deleteAccountData(secret, key) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();
    this._simulateFailure();

    const publicKey = this._secretToPublic(secret);
    return {
      id: publicKey,
      sequence: wallet.sequence,
      balances: [{ asset_type: 'native', asset_code: 'XLM', balance: wallet.balance }],
    };
  }

  /**
   * Submit a mock transaction and store it.
   * @param {Object} transaction - Mock transaction object (must have _isMockTransaction: true)
   * @returns {Promise<{hash: string, ledger: number, status: string}>}
   */
  async submitTransaction(transaction) {
    const hash = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    const key = (transaction && transaction.source) || '_submitted';
    if (!this.transactions.has(key)) {
      this.transactions.set(key, []);
    }
    this.transactions.get(key).push({ ...transaction, hash, ledger, status: 'confirmed' });
    return { hash, ledger, status: 'confirmed' };
  }

  /**
   * Build a mock unsigned payment transaction envelope.
   * @param {string} sourcePublicKey - Source account public key
   * @param {string} destinationPublicKey - Destination account public key
   * @param {string} amount - Amount to send
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Unsigned mock transaction
   */
  async buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options) {
    return {
      type: 'payment',
      source: sourcePublicKey,
      destination: destinationPublicKey,
      amount,
      options,
      _isMockTransaction: true,
      _unsigned: true,
    };
  }

  /**
   * Get the current sequence number for an account.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<string>} Sequence number as a string
   * @throws {NotFoundError} if the account does not exist
   */
  async getAccountSequence(publicKey) {
    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }
    return String(wallet.sequence);
  }

  /**
   * Build a mock unsigned transaction envelope with arbitrary operations.
   * @param {string} sourcePublicKey - Source account public key
   * @param {Array} operations - Array of operation objects
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Unsigned mock transaction
   */
  async buildTransaction(sourcePublicKey, operations, options) {
    return {
      type: 'transaction',
      source: sourcePublicKey,
      operations,
      options,
      _isMockTransaction: true,
      _unsigned: true,
    };
  }

  /**
   * Sign a mock transaction with the given secret key.
   * @param {Object} transaction - Mock transaction to sign
   * @param {string} secretKey - Secret key to sign with
   * @returns {Promise<Object>} Signed mock transaction
   */
  async signTransaction(transaction, secretKey) {
    return { ...transaction, _signed: true, _secretKey: secretKey };
  }

  /**
   * Get all balances for an account.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<Array>} Array of balance objects with asset_type, asset_code, and balance
   * @throws {NotFoundError} if the account does not exist
   */
  async getAccountBalances(publicKey) {
    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }

    // Initialize data_attr if it doesn't exist
    if (!wallet.data_attr) {
      wallet.data_attr = {};
    }

    // Delete the key
    delete wallet.data_attr[key];

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { hash: txId, ledger };
    const balances = [{ asset_type: 'native', asset_code: 'XLM', balance: wallet.balance }];
    if (wallet.assetBalances) {
      for (const [key, balance] of Object.entries(wallet.assetBalances)) {
        if (key !== 'native') {
          balances.push({ asset_type: 'credit_alphanum4', asset_code: key, balance });
        }
      }
    }
    return balances;
  }

  /**
   * Retrieve a stored transaction by its hash.
   * @param {string} transactionHash - Transaction hash to look up
   * @returns {Promise<Object>} The stored transaction record
   * @throws {NotFoundError} if the transaction does not exist
   */
  async getTransaction(transactionHash) {
    for (const txList of this.transactions.values()) {
      if (!Array.isArray(txList)) continue;
      const found = txList.find(
        (tx) => tx.transactionId === transactionHash || tx.hash === transactionHash
      );
      if (found) return found;
    }
    throw new NotFoundError(
      `Transaction not found. The transaction ${transactionHash} does not exist on the network.`,
      ERROR_CODES.TRANSACTION_NOT_FOUND
    );
  }

  /**
   * Check whether an address is a valid Stellar public key.
   * Returns false for null/undefined/invalid inputs — never throws.
   * @param {string} address - Address to validate
   * @returns {boolean}
   */
  isValidAddress(address) {
    if (!address || typeof address !== 'string') return false;
    return /^G[A-Z2-7]{55}$/.test(address);
  }

  /**
   * Convert stroops to XLM.
   * @param {number|string} stroops - Amount in stroops
   * @returns {string} XLM amount with 7 decimal places
   */
  stroopsToXlm(stroops) {
    return (Number(stroops) / 10_000_000).toFixed(7);
  }

  /**
   * Convert XLM to stroops.
   * @param {number|string} xlm - Amount in XLM
   * @returns {number} Amount in stroops (integer)
   */
  xlmToStroops(xlm) {
    return Math.round(Number(xlm) * 10_000_000);
  }

  /**
   * Derive a mock public key from a secret key (deterministic for test consistency).
   * @private
   */
  _secretToPublic(secretKey) {
    // Check if we have a wallet with this secret
    for (const [pub, wallet] of this.wallets.entries()) {
      if (wallet.secretKey === secretKey) return pub;
    }
    // Deterministic derivation for unknown secrets: hash S→G
    const hash = crypto.createHash('sha256').update(secretKey).digest('hex');
    // eslint-disable-next-line no-secrets/no-secrets
    const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let pub = 'G';
    for (let i = 0; i < 55; i++) {
      pub += base32[parseInt(hash[i % 64], 16) % 32];
    }
    return pub;
  }

  /**
   * Get the home domain for a wallet by public key.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<string|null>} The home domain or null if not set / not found
   */
  async getHomeDomain(publicKey) {
    const wallet = this.wallets.get(publicKey);
    if (!wallet) return null;
    return wallet.homeDomain || null;
  }

  /**
   * Set the home domain for a wallet.
   * @param {string} sourceSecret - Secret key of the source account
   * @param {string} domain - Hostname to set as home domain (no protocol, no path, max 32 chars)
   * @returns {Promise<{hash: string, ledger: number}>}
   * @throws {ValidationError} If domain format is invalid
   */
  async setHomeDomain(sourceSecret, domain) {
    if (!domain || typeof domain !== 'string') {
      throw new ValidationError('domain must be a non-empty string');
    }
    if (domain.length > 32) {
      throw new ValidationError('domain must be 32 characters or fewer per Stellar spec');
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(domain)) {
      throw new ValidationError('domain must be a valid hostname with no protocol or path');
    }

    const sourceWallet = this._findWalletBySecret(sourceSecret);
    if (!sourceWallet) {
      throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
    }

    sourceWallet.homeDomain = domain;

    const hash = `mock_${crypto.randomBytes(16).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;

    return { hash, ledger };
  }

  /**
   * Get the inflation destination for a wallet by public key.
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<string|null>} The inflation destination or null if not set / not found
   */
  async getInflationDestination(publicKey) {
    const wallet = this.wallets.get(publicKey);
    if (!wallet) return null;
    return wallet.inflationDestination || null;
  }

  /**
   * Set the inflation destination for a wallet.
   * @param {string} sourceSecret - Secret key of the source account
   * @param {string} destinationPublicKey - Stellar public key to set as inflation destination
   * @returns {Promise<{hash: string, ledger: number}>}
   * @throws {ValidationError} If destinationPublicKey is not a valid Stellar public key
   */
  async setInflationDestination(sourceSecret, destinationPublicKey) {
    if (
      !destinationPublicKey ||
      typeof destinationPublicKey !== 'string' ||
      !destinationPublicKey.startsWith('G') ||
      destinationPublicKey.length !== 56 ||
      !/^G[A-Z2-7]{55}$/.test(destinationPublicKey)
    ) {
      throw new ValidationError(
        'Invalid destination: must be a valid Stellar public key (56-character Base32 string starting with G).'
      );
    }

    const sourceWallet = this._findWalletBySecret(sourceSecret);
    if (!sourceWallet) {
      throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
    }

    sourceWallet.inflationDestination = destinationPublicKey;

    const hash = `mock_${crypto.randomBytes(16).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;

    return { hash, ledger };
  }

  // Interface compliance methods
  isValidAddress(address) {
    // Simple validation for mock: check format
    return typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address);
  }

  stroopsToXlm(stroops) {
    return (parseInt(stroops) / 10000000).toFixed(7);
  }

  xlmToStroops(xlm) {
    return Math.floor(parseFloat(xlm) * 10000000).toString();
  }

  /**
   * Mock implementation of setOptions.
   * Tracks account flags and home domain in the wallet record.
   * Validates that AUTH_IMMUTABLE (flag 8) cannot be cleared.
   *
   * @param {string} secret  - Account secret key
   * @param {object} options - setOptions fields
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async setOptions(secret, options = {}) {
    const AUTH_IMMUTABLE = 8;

    if (options.clearFlags !== undefined) {
      // eslint-disable-next-line no-bitwise
      if ((Number(options.clearFlags) & AUTH_IMMUTABLE) !== 0) {
        throw new ValidationError('AUTH_IMMUTABLE flag cannot be cleared once set');
      }
    }

    const wallet = this._findWalletBySecret(secret);
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

    const hash = `mock_${require('crypto').randomBytes(16).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;
    return { hash, ledger };
  }
}

module.exports = MockStellarService;
