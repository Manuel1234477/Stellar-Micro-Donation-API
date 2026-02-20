/**
 * Mock Stellar Service
 * Provides in-memory mock implementation for testing without network calls
 * Simulates Stellar blockchain behavior for development and testing
 */

const crypto = require('crypto');
const { validateStellarAddress, validateStellarSecretKey } = require('../utils/stellarValidation');
const { Keypair } = require('stellar-sdk');

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
    const keypair = Keypair.random();
    return {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret()
    };
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
    // Validate address format
    const validation = validateStellarAddress(publicKey);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

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
    // Validate address format
    const validation = validateStellarAddress(publicKey);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

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
    // Validate address format
    const validation = validateStellarAddress(publicKey);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

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
     * @param {string} params.memo - Transaction memo
     * @returns {Promise<{transactionId: string, ledger: number}>}
     */
    async sendDonation({ sourceSecret, destinationPublic, amount, memo }) {
        // Validate destination address format early
        const destValidation = validateStellarAddress(destinationPublic);
        if (!destValidation.valid) {
          throw new Error(`Invalid destination address: ${destValidation.error}`);
        }

        // Validate source secret key format
        const secretValidation = validateStellarSecretKey(sourceSecret);
        if (!secretValidation.valid) {
          throw new Error(`Invalid source secret key: ${secretValidation.error}`);
        }

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

        if (sourceBalance < amountNum) {
          throw new Error('Insufficient balance');
        }

        // Update balances
        sourceWallet.balance = (sourceBalance - amountNum).toFixed(7);
        destWallet.balance = (destBalance + amountNum).toFixed(7);

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
    // Validate address format
    const validation = validateStellarAddress(publicKey);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

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
    // Validate address format
    const validation = validateStellarAddress(publicKey);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

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
