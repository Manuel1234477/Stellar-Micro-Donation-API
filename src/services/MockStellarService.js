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
 * - No network latency simulation (instant responses)
 * - No multi-signature support
 * - No asset issuance or trustlines
 * - No path payments or complex operations
 * - Simplified fee structure (no actual fees charged)
 * - No sequence number management
 * - Transaction finality is immediate (no pending states)
 *
 * REALISTIC BEHAVIORS SIMULATED:
 * - Account funding requirements (minimum balance)
 * - Insufficient balance errors
 * - Invalid keypair validation
 * - Transaction hash generation
 * - Ledger number simulation
 * - Network timeout errors (configurable)
 * - Rate limiting (configurable)
 * - Transaction failures (configurable failure rate)
 */

const crypto = require('crypto');
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');
const { NotFoundError, ValidationError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');
// eslint-disable-next-line no-unused-vars -- Imported for future error handling
const StellarErrorHandler = require('../utils/stellarErrorHandler');
const log = require('../utils/log');

class MockStellarService extends StellarServiceInterface {
  constructor(config = {}) {
    // In-memory storage for mock data
    super();
    this.wallets = new Map(); // publicKey -> { publicKey, secretKey, balance }
    this.transactions = new Map(); // publicKey -> [transactions]
    this.streamListeners = new Map(); // publicKey -> [callbacks]
    this.network = config.network || 'testnet';
    this.horizonUrl = config.horizonUrl || 'https://horizon-testnet.stellar.org';

    // Configuration for realistic behavior simulation
    this.config = {
      // Simulate network delays (ms)
      networkDelay: config.networkDelay || 0,
      // Simulate random transaction failures (0-1, where 0.1 = 10% failure rate)
      failureRate: config.failureRate || 0,
      // Simulate rate limiting (max requests per second)
      rateLimit: config.rateLimit || null,
      // Minimum account balance (XLM)
      minAccountBalance: config.minAccountBalance || '1.0000000',
      // Base reserve (XLM) - Stellar requires 1 XLM base + 0.5 XLM per entry
      baseReserve: config.baseReserve || '1.0000000',
      // Enable strict validation
      strictValidation: config.strictValidation !== false,
    };

    // Rate limiting state
    this.requestTimestamps = [];

    // Failure simulation state
    this.failureSimulation = {
      enabled: false,
      type: null, // 'timeout', 'network_error', 'service_unavailable', 'bad_sequence', 'tx_failed'
      probability: 0, // 0-1
      consecutiveFailures: 0,
      maxConsecutiveFailures: 0,
    };
  }

  /**
   * Enable failure simulation for testing
   * @param {string} type - Type of failure to simulate
   * @param {number} probability - Probability of failure (0-1)
   */
  enableFailureSimulation(type, probability = 1.0) {
    this.failureSimulation.enabled = true;
    this.failureSimulation.type = type;
    this.failureSimulation.probability = probability;
    this.failureSimulation.consecutiveFailures = 0;
    log.info('MOCK_STELLAR_SERVICE', 'Failure simulation enabled', { type, probability });
  }

  /**
   * Disable failure simulation
   */
  disableFailureSimulation() {
    this.failureSimulation.enabled = false;
    this.failureSimulation.type = null;
    this.failureSimulation.probability = 0;
    this.failureSimulation.consecutiveFailures = 0;
  }

  /**
   * Set maximum consecutive failures before auto-recovery
   * @param {number} max - Maximum consecutive failures
   */
  setMaxConsecutiveFailures(max) {
    this.failureSimulation.maxConsecutiveFailures = max;
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

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

  /**
   * Simulate various network and Stellar failures
   * @private
   */
  _simulateFailure() {
    if (!this.failureSimulation.enabled) return;

    // Check if we should fail based on probability
    if (Math.random() > this.failureSimulation.probability) {
      this.failureSimulation.consecutiveFailures = 0;
      return;
    }

    // Check if we've hit max consecutive failures (auto-recovery)
    if (this.failureSimulation.maxConsecutiveFailures > 0 &&
        this.failureSimulation.consecutiveFailures >= this.failureSimulation.maxConsecutiveFailures) {
      this.failureSimulation.consecutiveFailures = 0;
      this.failureSimulation.enabled = false;
      return;
    }

    this.failureSimulation.consecutiveFailures++;

    const failureType = this.failureSimulation.type;

    switch (failureType) {
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

      default:
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Unknown network error occurred',
          { retryable: true, retryAfter: 3000 }
        );
    }
  }

  /**
   * Simulate network delay
   * @private
   */
  async _simulateNetworkDelay() {
    if (this.config.networkDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.networkDelay));
    }
  }

  /**
   * Check rate limiting
   * @private
   */
  _checkRateLimit() {
    if (!this.config.rateLimit) return;

    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneSecondAgo);

    if (this.requestTimestamps.length >= this.config.rateLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Rate limit exceeded. Please try again later.',
        { retryAfter: 1000 }
      );
    }

    this.requestTimestamps.push(now);
  }

  /**
   * Simulate random transaction failure
   * @private
   */
  _simulateRandomFailure() {
    if (this.config.failureRate > 0 && Math.random() < this.config.failureRate) {
      const errors = [
        'tx_bad_seq: Transaction sequence number does not match source account',
        'tx_insufficient_balance: Insufficient balance for transaction',
        'tx_failed: Transaction failed due to network congestion',
        'timeout: Request timeout - network may be experiencing high load',
      ];
      const error = errors[Math.floor(Math.random() * errors.length)];
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, error);
    }
  }

  /**
   * Validate Stellar public key format
   * @private
   */
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

  /**
   * Validate Stellar secret key format
   * @private
   */
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

  /**
   * Validate amount format
   * @private
   */
  _validateAmount(amount) {
    if (!this.config.strictValidation) return;

    const amountNum = parseFloat(amount);

    if (isNaN(amountNum)) {
      throw new ValidationError('Amount must be a valid number');
    }

    if (amountNum <= 0) {
      throw new ValidationError('Amount must be greater than zero');
    }

    // eslint-disable-next-line no-loss-of-precision -- Stellar's maximum XLM amount
    if (amountNum > 922337203685.4775807) {
      throw new ValidationError('Amount exceeds maximum allowed value (922337203685.4775807 XLM)');
    }

    // Check for more than 7 decimal places (Stellar precision)
    const decimalPart = amount.toString().split('.')[1];
    if (decimalPart && decimalPart.length > 7) {
      throw new ValidationError('Amount cannot have more than 7 decimal places');
    }
  }

  /**
   * Generate a mock Stellar keypair
   * @private
   */
  _generateKeypair() {
    // Generate more realistic Stellar-like keys using base32 alphabet
    // eslint-disable-next-line no-secrets/no-secrets -- Base32 alphabet constant, not a secret
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const generateKey = (prefix) => {
      let key = prefix;
      for (let i = 0; i < 55; i++) {
        key += base32Chars[Math.floor(Math.random() * base32Chars.length)];
      }
      return key;
    };

    return {
      publicKey: generateKey('G'),
      secretKey: generateKey('S'),
    };
  }

  /**
   * Create a new mock Stellar wallet
   * @returns {Promise<{publicKey: string, secretKey: string}>}
   */
  async createWallet() {
    await this._simulateNetworkDelay();
    this._checkRateLimit();

    const keypair = this._generateKeypair();

    this.wallets.set(keypair.publicKey, {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
      balance: '0',
      createdAt: new Date().toISOString(),
      sequence: '0', // Stellar sequence number
    });

    this.transactions.set(keypair.publicKey, []);

    return {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
    };
  }

  /**
   * Get mock wallet balance
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string, asset: string}>}
   */
  async getBalance(publicKey) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validatePublicKey(publicKey);
      this._simulateFailure(); // New failure simulation

      const wallet = this.wallets.get(publicKey);

      if (!wallet) {
        throw new NotFoundError(
          `Account not found. The account ${publicKey} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      return {
        balance: wallet.balance,
        asset: 'XLM',
      };
    });
  }

  /**
   * Fund a mock testnet wallet (simulates Friendbot)
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string}>}
   */
  async fundTestnetWallet(publicKey) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validatePublicKey(publicKey);
      this._simulateFailure(); // New failure simulation
      this._simulateRandomFailure();

      const wallet = this.wallets.get(publicKey);

      if (!wallet) {
        throw new NotFoundError(
          `Account not found. The account ${publicKey} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      // Check if already funded
      if (parseFloat(wallet.balance) > 0) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Account is already funded. Friendbot can only fund accounts once.'
        );
      }

      // Simulate Friendbot funding with 10000 XLM
      wallet.balance = '10000.0000000';
      wallet.fundedAt = new Date().toISOString();
      wallet.sequence = '1'; // Increment sequence after funding

      return {
        balance: wallet.balance,
      };
    });
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
      return {
        funded: false,
        balance: '0',
        exists: false,
      };
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
   * Send a mock donation transaction
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.destinationPublic - Destination public key
   * @param {string} params.amount - Amount in XLM
   * @param {string} params.memo - Transaction memo
   * @returns {Promise<{transactionId: string, ledger: number, status: string, confirmedAt: string}>}
   */
  async sendDonation({ sourceSecret, destinationPublic, amount, memo }) {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validateSecretKey(sourceSecret);
      this._validatePublicKey(destinationPublic);
      this._validateAmount(amount);
      this._simulateFailure(); // New failure simulation
      this._simulateRandomFailure();

    // Find source wallet by secret key
    let sourceWallet = null;
    for (const wallet of this.wallets.values()) {
      if (wallet.secretKey === sourceSecret) {
        sourceWallet = wallet;
        break;
      }
    }

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

    // Check if destination account is funded (Stellar requirement)
    const destBalance = parseFloat(destWallet.balance);
    const minBalance = parseFloat(this.config.minAccountBalance);
    if (destBalance < minBalance) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Destination account is not funded. Stellar requires accounts to maintain a minimum balance of ${this.config.minAccountBalance} XLM. ` +
        'Please fund the account first using Friendbot (testnet) or send an initial funding transaction.'
      );
    }

    const amountNum = parseFloat(amount);
    const sourceBalance = parseFloat(sourceWallet.balance);

    // Check for sufficient balance (including base reserve)
    const baseReserve = parseFloat(this.config.baseReserve);
    if (sourceBalance - amountNum < baseReserve) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Insufficient balance. Account must maintain minimum balance of ${this.config.baseReserve} XLM. ` +
        `Available: ${sourceBalance} XLM, Required: ${amountNum + baseReserve} XLM (${amountNum} + ${baseReserve} reserve)`
      );
    }

    // Update balances
    sourceWallet.balance = (sourceBalance - amountNum).toFixed(7);
    destWallet.balance = (destBalance + amountNum).toFixed(7);

    // Increment sequence numbers
    sourceWallet.sequence = (parseInt(sourceWallet.sequence) + 1).toString();

    // Create transaction record
    const transaction = {
      transactionId: 'mock_' + crypto.randomBytes(16).toString('hex'),
      source: sourceWallet.publicKey,
      destination: destinationPublic,
      amount: amountNum.toFixed(7),
      memo: memo || '',
      timestamp: new Date().toISOString(),
      ledger: Math.floor(Math.random() * 1000000) + 1000000,
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      fee: '0.0000100', // Stellar base fee
      sequence: sourceWallet.sequence,
    };

    // Store transaction for both accounts
    if (!this.transactions.has(sourceWallet.publicKey)) {
      this.transactions.set(sourceWallet.publicKey, []);
    }
    if (!this.transactions.has(destinationPublic)) {
      this.transactions.set(destinationPublic, []);
    }

    this.transactions.get(sourceWallet.publicKey).push(transaction);
    this.transactions.get(destinationPublic).push(transaction);

    // Notify stream listeners
    this._notifyStreamListeners(sourceWallet.publicKey, transaction);
    this._notifyStreamListeners(destinationPublic, transaction);

      return {
        transactionId: transaction.transactionId,
        ledger: transaction.ledger,
        status: transaction.status,
        confirmedAt: transaction.confirmedAt,
      };
    });
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

    const transactions = this.transactions.get(publicKey) || [];
    return transactions.slice(-limit).reverse();
  }

  /**
   * Verify a mock transaction by hash
   * @param {string} transactionHash - Transaction hash to verify
   * @returns {Promise<{verified: boolean, transaction: Object}>}
   */
  async verifyTransaction(transactionHash) {
    await this._simulateNetworkDelay();
    this._checkRateLimit();

    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new ValidationError('Transaction hash must be a valid string');
    }

    // Search all transactions for the given hash
    for (const txList of this.transactions.values()) {
      const transaction = txList.find(tx => tx.transactionId === transactionHash);
      if (transaction) {
        return {
          verified: true,
          status: transaction.status,
          transaction: {
            id: transaction.transactionId,
            source: transaction.source,
            destination: transaction.destination,
            amount: transaction.amount,
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

  /**
   * Stream mock transactions
   * @param {string} publicKey - Stellar public key
   * @param {Function} onTransaction - Callback for each transaction
   * @returns {Function} Unsubscribe function
   */
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

    // Return unsubscribe function
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

  /**
   * Notify all stream listeners of a new transaction
   * @private
   */
  _notifyStreamListeners(publicKey, transaction) {
    const listeners = this.streamListeners.get(publicKey) || [];
    listeners.forEach(callback => {
      try {
        callback(transaction);
      } catch (error) {
        log.error('MOCK_STELLAR_SERVICE', 'Stream listener callback failed', { error: error.message });
      }
    });
  }

  /**
   * Send a mock payment (simplified version for recurring donations)
   * @param {string} sourcePublicKey - Source public key
   * @param {string} destinationPublic - Destination public key
   * @param {number} amount - Amount in XLM
   * @param {string} memo - Transaction memo
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async sendPayment(sourcePublicKey, destinationPublic, amount, memo = '') {
    return this._executeWithRetry(async () => {
      await this._simulateNetworkDelay();
      this._checkRateLimit();
      this._validatePublicKey(sourcePublicKey);
      this._validatePublicKey(destinationPublic);
      this._validateAmount(amount.toString());
      this._simulateFailure(); // New failure simulation
      this._simulateRandomFailure();

    let sourceWallet = this.wallets.get(sourcePublicKey);

    if (!sourceWallet) {
      // For simulation purposes, create a mock wallet if it doesn't exist
      sourceWallet = {
        publicKey: sourcePublicKey,
        secretKey: this._generateKeypair().secretKey,
        balance: '10000.0000000', // Give it a balance for testing
        createdAt: new Date().toISOString(),
        sequence: '0',
      };
      this.wallets.set(sourcePublicKey, sourceWallet);
    }

    let destWallet = this.wallets.get(destinationPublic);
    if (!destWallet) {
      // Create destination wallet if it doesn't exist
      destWallet = {
        publicKey: destinationPublic,
        secretKey: this._generateKeypair().secretKey,
        balance: '1.0000000', // Minimum funded balance
        createdAt: new Date().toISOString(),
        sequence: '0',
      };
      this.wallets.set(destinationPublic, destWallet);
    }

    const amountNum = parseFloat(amount);
    const sourceBalance = parseFloat(sourceWallet.balance);
    const baseReserve = parseFloat(this.config.baseReserve);

    // Check for sufficient balance
    if (sourceBalance - amountNum < baseReserve) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Insufficient balance. Account must maintain minimum balance of ${this.config.baseReserve} XLM.`
      );
    }

    // Update balances
    sourceWallet.balance = (sourceBalance - amountNum).toFixed(7);
    destWallet.balance = (parseFloat(destWallet.balance) + amountNum).toFixed(7);
    sourceWallet.sequence = (parseInt(sourceWallet.sequence) + 1).toString();

    // Create transaction record
    const transaction = {
      hash: 'mock_' + crypto.randomBytes(16).toString('hex'),
      source: sourcePublicKey,
      destination: destinationPublic,
      amount: amountNum.toFixed(7),
      memo,
      timestamp: new Date().toISOString(),
      ledger: Math.floor(Math.random() * 1000000) + 1000000,
      status: 'confirmed',
      fee: '0.0000100',
      sequence: sourceWallet.sequence,
    };

    // Store transaction
    if (!this.transactions.has(sourcePublicKey)) {
      this.transactions.set(sourcePublicKey, []);
    }
    if (!this.transactions.has(destinationPublic)) {
      this.transactions.set(destinationPublic, []);
    }

    this.transactions.get(sourcePublicKey).push(transaction);
    this.transactions.get(destinationPublic).push(transaction);

    log.info('MOCK_STELLAR_SERVICE', 'Payment simulated', {
      amount: amountNum.toFixed(7),
      source: `${sourcePublicKey.substring(0, 8)}...`,
      destination: `${destinationPublic.substring(0, 8)}...`,
    });

      return {
        hash: transaction.hash,
        ledger: transaction.ledger,
      };
    });
  }

  /**
   * Clear all mock data (useful for testing)
   * @private
   */
  _clearAllData() {
    this.wallets.clear();
    this.transactions.clear();
    this.streamListeners.clear();
    if (this.claimableBalances) this.claimableBalances.clear();
  }

  /**
   * Get mock service state (useful for testing)
   * @private
   */
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
}

module.exports = MockStellarService;
