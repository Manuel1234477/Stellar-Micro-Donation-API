/**
 * Stellar Address Validation Utility
 * Validates Stellar public keys according to Stellar protocol specifications
 */

const { StrKey } = require('stellar-sdk');

/**
 * Validate a Stellar public key (address)
 * @param {string} address - The Stellar address to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateStellarAddress(address) {
  // Check if address is provided
  if (!address) {
    return {
      valid: false,
      error: 'Address is required'
    };
  }

  // Check if address is a string
  if (typeof address !== 'string') {
    return {
      valid: false,
      error: 'Address must be a string'
    };
  }

  // Trim whitespace
  const trimmedAddress = address.trim();

  // Check if address is empty after trimming
  if (trimmedAddress.length === 0) {
    return {
      valid: false,
      error: 'Address cannot be empty'
    };
  }

  // Check if address starts with 'G' (Stellar public keys start with G)
  if (!trimmedAddress.startsWith('G')) {
    return {
      valid: false,
      error: 'Invalid Stellar address format. Public keys must start with "G"'
    };
  }

  // Check address length (Stellar addresses are 56 characters)
  if (trimmedAddress.length !== 56) {
    return {
      valid: false,
      error: `Invalid Stellar address length. Expected 56 characters, got ${trimmedAddress.length}`
    };
  }

  // Validate using Stellar SDK
  try {
    const isValid = StrKey.isValidEd25519PublicKey(trimmedAddress);
    
    if (!isValid) {
      return {
        valid: false,
        error: 'Invalid Stellar address. Checksum validation failed'
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid Stellar address: ${error.message}`
    };
  }
}

/**
 * Validate a Stellar secret key
 * @param {string} secretKey - The Stellar secret key to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateStellarSecretKey(secretKey) {
  if (!secretKey || typeof secretKey !== 'string') {
    return {
      valid: false,
      error: 'Secret key is required and must be a string'
    };
  }

  const trimmedKey = secretKey.trim();

  if (!trimmedKey.startsWith('S')) {
    return {
      valid: false,
      error: 'Invalid Stellar secret key format. Secret keys must start with "S"'
    };
  }

  if (trimmedKey.length !== 56) {
    return {
      valid: false,
      error: `Invalid Stellar secret key length. Expected 56 characters, got ${trimmedKey.length}`
    };
  }

  try {
    const isValid = StrKey.isValidEd25519SecretSeed(trimmedKey);
    
    if (!isValid) {
      return {
        valid: false,
        error: 'Invalid Stellar secret key. Checksum validation failed'
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid Stellar secret key: ${error.message}`
    };
  }
}

module.exports = {
  validateStellarAddress,
  validateStellarSecretKey
};
