/**
 * Mock Stream Manager
 * Manages transaction streaming and listeners
 */

const { NotFoundError, ValidationError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

class MockStreamManager {
  constructor() {
    this.streamListeners = new Map(); // publicKey -> [callbacks]
  }

  /**
   * Subscribe to transaction stream
   * @param {string} publicKey - Account public key
   * @param {Function} onTransaction - Callback function
   * @param {Function} walletExists - Function to check if wallet exists
   * @returns {Function} Unsubscribe function
   */
  subscribe(publicKey, onTransaction, walletExists) {
    if (!walletExists(publicKey)) {
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
   * Notify all listeners of a new transaction
   * @param {string} publicKey - Account public key
   * @param {Object} transaction - Transaction data
   */
  notifyListeners(publicKey, transaction) {
    const listeners = this.streamListeners.get(publicKey) || [];
    listeners.forEach(callback => {
      try {
        callback(transaction);
      } catch (error) {
        log.error('MOCK_STREAM_MANAGER', 'Stream listener callback failed', { error: error.message });
      }
    });
  }

  /**
   * Get listener count for an account
   * @param {string} publicKey - Account public key
   * @returns {number}
   */
  getListenerCount(publicKey) {
    const listeners = this.streamListeners.get(publicKey);
    return listeners ? listeners.length : 0;
  }

  /**
   * Get total listener count
   * @returns {number}
   */
  getTotalListenerCount() {
    return this.streamListeners.size;
  }

  /**
   * Clear all listeners (for testing)
   */
  clearAll() {
    this.streamListeners.clear();
  }
}

module.exports = MockStreamManager;
