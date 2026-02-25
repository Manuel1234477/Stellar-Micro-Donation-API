/**
 * Mock Wallet Manager
 * Manages wallet operations (create, balance, funding)
 */

const { NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const StellarValidator = require('./StellarValidator');

class MockWalletManager {
  constructor(config = {}) {
    this.wallets = new Map();
    this.config = {
      minAccountBalance: config.minAccountBalance || '1.0000000',
      baseReserve: config.baseReserve || '1.0000000',
    };
  }

  /**
   * Create a new wallet
   * @returns {{publicKey: string, secretKey: string}}
   */
  createWallet() {
    const keypair = StellarValidator.generateKeypair();
    
    this.wallets.set(keypair.publicKey, {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
      balance: '0',
      createdAt: new Date().toISOString(),
      sequence: '0',
    });

    return {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
    };
  }

  /**
   * Get wallet balance
   * @param {string} publicKey - Wallet public key
   * @returns {{balance: string, asset: string}}
   */
  getBalance(publicKey) {
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
  }

  /**
   * Fund a testnet wallet (simulates Friendbot)
   * @param {string} publicKey - Wallet public key
   * @returns {{balance: string}}
   */
  fundTestnetWallet(publicKey) {
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
    wallet.sequence = '1';

    return {
      balance: wallet.balance,
    };
  }

  /**
   * Check if account is funded
   * @param {string} publicKey - Wallet public key
   * @returns {{funded: boolean, balance: string, exists: boolean}}
   */
  isAccountFunded(publicKey) {
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
   * Get wallet by public key
   * @param {string} publicKey - Wallet public key
   * @returns {Object|null}
   */
  getWallet(publicKey) {
    return this.wallets.get(publicKey) || null;
  }

  /**
   * Find wallet by secret key
   * @param {string} secretKey - Wallet secret key
   * @returns {Object|null}
   */
  findWalletBySecret(secretKey) {
    for (const wallet of this.wallets.values()) {
      if (wallet.secretKey === secretKey) {
        return wallet;
      }
    }
    return null;
  }

  /**
   * Update wallet balance
   * @param {string} publicKey - Wallet public key
   * @param {number} newBalance - New balance
   */
  updateBalance(publicKey, newBalance) {
    const wallet = this.wallets.get(publicKey);
    if (wallet) {
      wallet.balance = newBalance.toFixed(7);
    }
  }

  /**
   * Increment wallet sequence number
   * @param {string} publicKey - Wallet public key
   */
  incrementSequence(publicKey) {
    const wallet = this.wallets.get(publicKey);
    if (wallet) {
      wallet.sequence = (parseInt(wallet.sequence) + 1).toString();
    }
  }

  /**
   * Get all wallets (for testing)
   * @returns {Array}
   */
  getAllWallets() {
    return Array.from(this.wallets.values());
  }

  /**
   * Clear all wallets (for testing)
   */
  clearAll() {
    this.wallets.clear();
  }
}

module.exports = MockWalletManager;
