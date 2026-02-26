/**
 * Stellar Validation Utilities
 * Validates Stellar-specific data formats (keys, amounts, etc.)
 */

const { ValidationError } = require('../../utils/errors');

class StellarValidator {
  /**
   * Validate Stellar public key format
   * @param {string} publicKey - Public key to validate
   * @param {boolean} strict - Enable strict validation
   * @throws {ValidationError} If validation fails
   */
  static validatePublicKey(publicKey, strict = true) {
    if (!strict) return;

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
   * @param {string} secretKey - Secret key to validate
   * @param {boolean} strict - Enable strict validation
   * @throws {ValidationError} If validation fails
   */
  static validateSecretKey(secretKey, strict = true) {
    if (!strict) return;

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
   * @param {string|number} amount - Amount to validate
   * @param {boolean} strict - Enable strict validation
   * @throws {ValidationError} If validation fails
   */
  static validateAmount(amount, strict = true) {
    if (!strict) return;

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
   * Validate transaction hash format
   * @param {string} transactionHash - Transaction hash to validate
   * @throws {ValidationError} If validation fails
   */
  static validateTransactionHash(transactionHash) {
    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new ValidationError('Transaction hash must be a valid string');
    }
  }

  /**
   * Generate a mock Stellar keypair
   * @returns {{publicKey: string, secretKey: string}}
   */
  static generateKeypair() {
    // Generate realistic Stellar-like keys using base32 alphabet
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
}

module.exports = StellarValidator;
