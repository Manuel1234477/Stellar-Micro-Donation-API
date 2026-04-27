/**
 * SigningProvider Interface
 * 
 * RESPONSIBILITY: Define interface for transaction signing providers
 * OWNER: Security Team
 * 
 * Provides pluggable architecture for different signing backends
 * (software keys, HSMs, hardware wallets, etc.)
 */

/**
 * Base signing provider interface
 * All signing providers must implement these methods
 */
class SigningProvider {
  /**
   * Sign a Stellar transaction
   * @param {Transaction} transaction - Built Stellar transaction
   * @param {string} publicKey - Signer public key
   * @returns {Promise<Transaction>} Signed transaction
   */
  async sign(transaction, publicKey) {
    throw new Error('SigningProvider.sign() must be implemented by subclass');
  }

  /**
   * Get public key for a signing identity
   * @param {string} identity - Provider-specific identity (secret key, HSM slot, etc.)
   * @returns {Promise<string>} Stellar public key
   */
  async getPublicKey(identity) {
    throw new Error('SigningProvider.getPublicKey() must be implemented by subclass');
  }

  /**
   * Verify provider is properly configured and accessible
   * @returns {Promise<boolean>} True if provider is ready
   */
  async healthCheck() {
    throw new Error('SigningProvider.healthCheck() must be implemented by subclass');
  }
}

module.exports = SigningProvider;
