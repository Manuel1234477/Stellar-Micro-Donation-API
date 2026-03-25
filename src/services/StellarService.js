/**
 * Real Stellar Service
 * Handles actual blockchain interactions with Stellar network
 */

const axios = require('axios');

class StellarService {
  /**
   * @param {Object} config
   * @param {string} [config.network]
   * @param {string} [config.horizonUrl]
   * @param {string} [config.serviceSecretKey]
   * @param {string} [config.sorobanRpcUrl] - Soroban RPC endpoint URL
   */
  constructor(config = {}) {
    this.network = config.network || 'testnet';
    this.horizonUrl = config.horizonUrl || 'https://horizon-testnet.stellar.org';
    this.serviceSecretKey = config.serviceSecretKey;

    // Soroban RPC client initialisation
    if (config.sorobanRpcUrl === '') {
      throw new Error('sorobanRpcUrl must not be empty');
    }
    this.sorobanRpcUrl = config.sorobanRpcUrl || 'https://soroban-testnet.stellar.org';

    /** @type {Map<string, Array>} In-memory event store keyed by contractId */
    this._eventStore = new Map();
  }

  /**
   * Create a new Stellar wallet
   * @returns {Promise<{publicKey: string, secretKey: string}>}
   */
  async createWallet() {
    throw new Error('StellarService.createWallet() not yet implemented');
  }

  /**
   * Get wallet balance
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string, asset: string}>}
   */
  async getBalance(publicKey) {
    throw new Error('StellarService.getBalance() not yet implemented');
  }

  /**
   * Fund a testnet wallet via Friendbot
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string}>}
   */
  async fundTestnetWallet(publicKey) {
    throw new Error('StellarService.fundTestnetWallet() not yet implemented');
  }

  /**
   * Send a donation transaction
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.destinationPublic - Destination public key
   * @param {string} params.amount - Amount in XLM
   * @param {string} params.memo - Transaction memo
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async sendDonation({ sourceSecret, destinationPublic, amount, memo }) {
    throw new Error('StellarService.sendDonation() not yet implemented');
  }

  /**
   * Get transaction history for an account
   * @param {string} publicKey - Stellar public key
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Promise<Array>}
   */
  async getTransactionHistory(publicKey, limit = 10) {
    throw new Error('StellarService.getTransactionHistory() not yet implemented');
  }

  /**
   * Stream transactions for an account
   * @param {string} publicKey - Stellar public key
   * @param {Function} onTransaction - Callback for each transaction
   * @returns {Function} Unsubscribe function
   */
  streamTransactions(publicKey, onTransaction) {
    throw new Error('StellarService.streamTransactions() not yet implemented');
  }

  /**
   * Verify a donation transaction by hash
   * @param {string} transactionHash - Transaction hash to verify
   * @returns {Promise<{verified: boolean, transaction: Object}>}
   */
  async verifyTransaction(transactionHash) {
    throw new Error('StellarService.verifyTransaction() not yet implemented');
  }

  // ─── Soroban Contract Methods ────────────────────────────────────────────────

  /**
   * Invoke a Soroban smart contract method via JSON-RPC 2.0.
   * @param {string} contractId - The deployed contract address
   * @param {string} method - The contract method name
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

    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'sendTransaction',
      params: { contractId, method, args },
    };

    const response = await axios.post(this.sorobanRpcUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    const rpcResult = response.data;
    if (rpcResult.error) {
      throw new Error(rpcResult.error.message || 'RPC error');
    }

    const result = rpcResult.result || {};
    const invocationResult = {
      status: result.status || 'success',
      returnValue: result.returnValue !== undefined ? result.returnValue : null,
      events: Array.isArray(result.events) ? result.events : [],
    };

    this._storeEvents(contractId, invocationResult.events);
    return invocationResult;
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
    const events = this._eventStore.get(contractId) || [];
    const sorted = [...events].reverse();
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  /**
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
}

module.exports = StellarService;
