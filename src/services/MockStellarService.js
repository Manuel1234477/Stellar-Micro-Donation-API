/**
 * Mock Stellar Service
 * Provides in-memory mock implementation for testing without network calls
 * Simulates Stellar blockchain behavior for development and testing
 */

const crypto = require('crypto');

class MockStellarService {
  constructor() {
    // In-memory storage for mock data
    this.wallets = new Map(); // publicKey -> { publicKey, secretKey, balance }
    this.transactions = new Map(); // publicKey -> [transactions]
    this.streamListeners = new Map(); // publicKey -> [callbacks]

    // Soroban contract simulation state
    this.contractInvocations = new Map(); // contractId -> { balance, goal, invocations[] }
    this.contractEvents = new Map(); // contractId -> ContractEvent[]

    console.log('[MockStellarService] Initialized');
  }

  /**
   * Generate a mock Stellar keypair
   * @private
   */
  _generateKeypair() {
    const publicKey = 'G' + crypto.randomBytes(32).toString('hex').substring(0, 55).toUpperCase();
    const secretKey = 'S' + crypto.randomBytes(32).toString('hex').substring(0, 55).toUpperCase();
    return { publicKey, secretKey };
  }

  /**
   * Create a new mock Stellar wallet
   * @returns {Promise<{publicKey: string, secretKey: string}>}
   */
  async createWallet() {
    const keypair = this._generateKeypair();
    
    this.wallets.set(keypair.publicKey, {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
      balance: '0',
      createdAt: new Date().toISOString(),
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
    const wallet = this.wallets.get(publicKey);
    
    if (!wallet) {
      throw new Error(`Wallet not found: ${publicKey}`);
    }

    return {
      balance: wallet.balance,
      asset: 'XLM',
    };
  }

  /**
   * Fund a mock testnet wallet (simulates Friendbot)
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string}>}
   */
  async fundTestnetWallet(publicKey) {
    const wallet = this.wallets.get(publicKey);
    
    if (!wallet) {
      throw new Error(`Wallet not found: ${publicKey}`);
    }

    // Simulate Friendbot funding with 10000 XLM
    wallet.balance = '10000.0000000';
    wallet.fundedAt = new Date().toISOString();

    return {
      balance: wallet.balance,
    };
  }

  /**
   * Send a mock donation transaction
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.destinationPublic - Destination public key
   * @param {string} params.amount - Amount in XLM
   * @param {string} params.memo - Transaction memo
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async sendDonation({ sourceSecret, destinationPublic, amount, memo }) {
    // Find source wallet by secret key
    let sourceWallet = null;
    for (const wallet of this.wallets.values()) {
      if (wallet.secretKey === sourceSecret) {
        sourceWallet = wallet;
        break;
      }
    }

    if (!sourceWallet) {
      throw new Error('Invalid source secret key');
    }

    if (sourceWallet.publicKey === destinationPublic) {
      throw new Error('Sender and recipient wallets must be different');
    }

    const destWallet = this.wallets.get(destinationPublic);
    if (!destWallet) {
      throw new Error(`Destination wallet not found: ${destinationPublic}`);
    }

    const amountNum = parseFloat(amount);
    const sourceBalance = parseFloat(sourceWallet.balance);

    if (sourceBalance < amountNum) {
      throw new Error('Insufficient balance');
    }

    // Update balances
    sourceWallet.balance = (sourceBalance - amountNum).toFixed(7);
    destWallet.balance = (parseFloat(destWallet.balance) + amountNum).toFixed(7);

    // Create transaction record
    const transaction = {
      transactionId: 'mock_' + crypto.randomBytes(16).toString('hex'),
      source: sourceWallet.publicKey,
      destination: destinationPublic,
      amount,
      memo,
      timestamp: new Date().toISOString(),
      ledger: Math.floor(Math.random() * 1000000) + 1000000,
      status: 'success',
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
    };
  }

  /**
   * Get mock transaction history
   * @param {string} publicKey - Stellar public key
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Promise<Array>}
   */
  async getTransactionHistory(publicKey, limit = 10) {
    const wallet = this.wallets.get(publicKey);
    
    if (!wallet) {
      throw new Error(`Wallet not found: ${publicKey}`);
    }

    const transactions = this.transactions.get(publicKey) || [];
    return transactions.slice(-limit).reverse();
  }

  /**
   * Stream mock transactions
   * @param {string} publicKey - Stellar public key
   * @param {Function} onTransaction - Callback for each transaction
   * @returns {Function} Unsubscribe function
   */
  streamTransactions(publicKey, onTransaction) {
    const wallet = this.wallets.get(publicKey);
    
    if (!wallet) {
      throw new Error(`Wallet not found: ${publicKey}`);
    }

    if (!this.streamListeners.has(publicKey)) {
      this.streamListeners.set(publicKey, []);
    }

    this.streamListeners.get(publicKey).push(onTransaction);

    // Return unsubscribe function
    return () => {
      const listeners = this.streamListeners.get(publicKey);
      const index = listeners.indexOf(onTransaction);
      if (index > -1) {
        listeners.splice(index, 1);
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
        console.error('[MockStellarService] Stream listener error:', error);
      }
    });
  }

  /**
   * Invoke a simulated Soroban smart contract method.
   * @param {string} contractId - The contract identifier
   * @param {string} method - The method name to invoke
   * @param {Array} args - Arguments to pass to the method
   * @returns {Promise<{status: string, returnValue: any, events: Array}>}
   */
  async invokeContract(contractId, method, args) {
    if (!contractId || typeof contractId !== 'string' || contractId.trim() === '') {
      throw new Error('contractId is required');
    }
    if (!method || typeof method !== 'string' || method.trim() === '') {
      throw new Error('method is required');
    }
    if (!Array.isArray(args)) {
      throw new Error('args must be an array');
    }

    // Initialise contract state if first invocation
    if (!this.contractInvocations.has(contractId)) {
      this.contractInvocations.set(contractId, { balance: 0, goal: args[2] || 100, invocations: [] });
    }
    const state = this.contractInvocations.get(contractId);
    state.invocations.push({ method, args, timestamp: new Date().toISOString() });

    const ledger = 1000000 + state.invocations.length;
    const timestamp = new Date().toISOString();

    if (method === 'deposit') {
      const amount = typeof args[1] === 'number' ? args[1] : Number(args[1]) || 0;
      state.balance += amount;

      const event = {
        contractId,
        type: 'deposit',
        topics: ['deposit', args[0] || 'donor'],
        data: { donorId: args[0], amount, newBalance: state.balance },
        timestamp,
        ledger,
      };
      this._storeContractEvent(contractId, event);
      return { status: 'success', returnValue: null, events: [event] };
    }

    if (method === 'release') {
      const goal = typeof args[1] === 'number' ? args[1] : (state.goal || 100);
      if (state.balance < goal) {
        return { status: 'error', returnValue: 'Goal not yet reached', events: [] };
      }
      const amount = state.balance;
      state.balance = 0;

      const event = {
        contractId,
        type: 'release',
        topics: ['release', args[0] || 'recipient'],
        data: { recipientId: args[0], amount },
        timestamp,
        ledger,
      };
      this._storeContractEvent(contractId, event);
      return { status: 'success', returnValue: null, events: [event] };
    }

    // Any other method — succeed with no events
    return { status: 'success', returnValue: null, events: [] };
  }

  /**
   * Retrieve stored contract events for a given contract ID.
   * @param {string} contractId - The contract identifier
   * @param {number} [limit] - Maximum number of events to return
   * @returns {Promise<Array>}
   */
  async getContractEvents(contractId, limit) {
    if (!contractId || typeof contractId !== 'string' || contractId.trim() === '') {
      throw new Error('contractId is required');
    }
    const events = this.contractEvents.get(contractId) || [];
    // Return in reverse-chronological order (most recent first)
    const sorted = [...events].reverse();
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Store a contract event in the internal event store.
   * @private
   */
  _storeContractEvent(contractId, event) {
    if (!this.contractEvents.has(contractId)) {
      this.contractEvents.set(contractId, []);
    }
    this.contractEvents.get(contractId).push(event);
  }

  /**
   * Clear all mock data (useful for testing)
   * @private
   */
  _clearAllData() {
    this.wallets.clear();
    this.transactions.clear();
    this.streamListeners.clear();
    this.contractInvocations.clear();
    this.contractEvents.clear();
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
}

module.exports = MockStellarService;
