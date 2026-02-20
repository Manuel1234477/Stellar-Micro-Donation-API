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
   * Check if an account is funded
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{funded: boolean, balance: string}>}
   */
  async isAccountFunded(publicKey) {
    const wallet = this.wallets.get(publicKey);
    
    if (!wallet) {
      return {
        funded: false,
        balance: '0',
        exists: false,
      };
    }

    const balance = parseFloat(wallet.balance);
    return {
      funded: balance > 0,
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
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  /**
     * Send a mock donation transaction
     * @param {Object} params
     * @param {string} params.sourceSecret - Source account secret key
     * @param {string} params.destinationPublic - Destination public key
     * @param {string} params.amount - Amount in XLM
     * @param {string} [params.memo] - Optional transaction memo (max 28 bytes)
     * @returns {Promise<{transactionId: string, ledger: number}>}
     */
    async sendDonation({ sourceSecret, destinationPublic, amount, memo = '' }) {
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

      // Check if destination account is funded (Stellar requirement)
      const destBalance = parseFloat(destWallet.balance);
      if (destBalance === 0) {
        throw new Error(
          'Destination account is not funded. On Stellar, accounts must be funded with at least 1 XLM before they can receive payments. ' +
          'Please fund the account first using the Friendbot (testnet) or send an initial funding transaction.'
        );
      }

      const amountNum = parseFloat(amount);
      const sourceBalance = parseFloat(sourceWallet.balance);

    // Update balances
    sourceWallet.balance = (sourceBalance - amountNum).toFixed(7);
    destWallet.balance = (destBalance + amountNum).toFixed(7);

    // Create transaction record
    const txRecord = {
      transactionId: 'mock_' + crypto.randomBytes(16).toString('hex'),
      source: sourceWallet.publicKey,
      destination: destinationPublic,
      amount,
      memo: memo || '',
      timestamp: new Date().toISOString(),
      ledger: Math.floor(Math.random() * 1000000) + 1000000,
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
    };

      // Store transaction for both accounts
      if (!this.transactions.has(sourceWallet.publicKey)) {
        this.transactions.set(sourceWallet.publicKey, []);
      }
      if (!this.transactions.has(destinationPublic)) {
        this.transactions.set(destinationPublic, []);
      }

      this.transactions.get(sourceWallet.publicKey).push(txRecord);
      this.transactions.get(destinationPublic).push(txRecord);

      // Notify stream listeners
      this._notifyStreamListeners(sourceWallet.publicKey, txRecord);
      this._notifyStreamListeners(destinationPublic, txRecord);

      return {
        transactionId: txRecord.transactionId,
        ledger: txRecord.ledger,
        status: txRecord.status,
        confirmedAt: txRecord.confirmedAt,
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
   * Verify a mock transaction by hash
   * @param {string} transactionHash - Transaction hash to verify
   * @returns {Promise<{verified: boolean, transaction: Object}>}
   */
  async verifyTransaction(transactionHash) {
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
          },
        };
      }
    }

    throw new Error(`Transaction not found: ${transactionHash}`);
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
   * Send a mock payment (simplified version for recurring donations)
   * @param {string} sourcePublicKey - Source public key
   * @param {string} destinationPublic - Destination public key
   * @param {number} amount - Amount in XLM
   * @param {string} memo - Transaction memo
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async sendPayment(sourcePublicKey, destinationPublic, amount, memo = '') {
    const sourceWallet = this.wallets.get(sourcePublicKey);
    
    if (!sourceWallet) {
      // For simulation purposes, create a mock wallet if it doesn't exist
      this.wallets.set(sourcePublicKey, {
        publicKey: sourcePublicKey,
        secretKey: 'S' + crypto.randomBytes(32).toString('hex').substring(0, 55).toUpperCase(),
        balance: '10000.0000000', // Give it a balance for testing
        createdAt: new Date().toISOString(),
      });
    }

    const destWallet = this.wallets.get(destinationPublic);
    if (!destWallet) {
      // Create destination wallet if it doesn't exist
      this.wallets.set(destinationPublic, {
        publicKey: destinationPublic,
        secretKey: 'S' + crypto.randomBytes(32).toString('hex').substring(0, 55).toUpperCase(),
        balance: '1.0000000', // Minimum funded balance
        createdAt: new Date().toISOString(),
      });
    }

    // Create transaction record
    const transaction = {
      hash: 'mock_' + crypto.randomBytes(16).toString('hex'),
      source: sourcePublicKey,
      destination: destinationPublic,
      amount: amount.toString(),
      memo,
      timestamp: new Date().toISOString(),
      ledger: Math.floor(Math.random() * 1000000) + 1000000,
      status: 'success',
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

    console.log(`[MockStellarService] Payment simulated: ${amount} XLM from ${sourcePublicKey.substring(0, 8)}... to ${destinationPublic.substring(0, 8)}...`);

    return {
      hash: transaction.hash,
      ledger: transaction.ledger,
    };
  }

  /**
   * Clear all mock data (useful for testing)
   * @private
   */
  _clearAllData() {
    this.wallets.clear();
    this.transactions.clear();
    this.streamListeners.clear();
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
