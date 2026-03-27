/**
 * Software Signing Provider
 * 
 * RESPONSIBILITY: Sign transactions using in-memory private keys
 * OWNER: Security Team
 * 
 * Default signing provider that uses Stellar SDK keypairs.
 * Keys are stored in memory (from environment or parameters).
 */

const StellarSdk = require('stellar-sdk');
const SigningProvider = require('./SigningProvider');

/**
 * Software-based signing provider using Stellar SDK
 * This is the default provider and maintains current behavior
 */
class SoftwareSigningProvider extends SigningProvider {
  /**
   * Sign a transaction with a software keypair
   * @param {Transaction} transaction - Built Stellar transaction
   * @param {string} secretKey - Stellar secret key (S...)
   * @returns {Promise<Transaction>} Signed transaction
   */
  async sign(transaction, secretKey) {
    const keypair = StellarSdk.Keypair.fromSecret(secretKey);
    transaction.sign(keypair);
    return transaction;
  }

  /**
   * Get public key from secret key
   * @param {string} secretKey - Stellar secret key
   * @returns {Promise<string>} Stellar public key
   */
  async getPublicKey(secretKey) {
    const keypair = StellarSdk.Keypair.fromSecret(secretKey);
    return keypair.publicKey();
  }

  /**
   * Software provider is always ready
   * @returns {Promise<boolean>} Always true
   */
  async healthCheck() {
    return true;
  }
}

module.exports = SoftwareSigningProvider;
