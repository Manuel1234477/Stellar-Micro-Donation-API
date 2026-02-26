/**
 * Validation middleware for API endpoints
 * Handles structural and logic-based checks for donation and wallet operations.
 */

const { sanitizeText } = require('../utils/sanitizer');
const {
  isValidStellarPublicKey,
  isValidAmount,
  walletExists,
  walletAddressExists,
  isValidDateRange,
  isValidTransactionHash,
} = require('../utils/validators');

/**
 * Validate donation creation request.
 * Checks for presence of amount/recipient, ensures donor and recipient are unique,
 * and validates Stellar address formats if provided.
 */
const validateDonationCreate = (req, res, next) => {
  const { amount, donor, recipient } = req.body;

  // Validate required fields: Ensures mandatory payload keys exist
  if (!amount) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'Amount is required',
        field: 'amount'
      }
    });
  }

  if (!recipient) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'Recipient is required',
        field: 'recipient'
      }
    });
  }

  // Validate amount: Checks for positive numeric values (non-zero)
  if (!isValidAmount(amount)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_AMOUNT',
        message: 'Amount must be a positive number greater than 0',
        field: 'amount'
      }
    });
  }

  // Sanitize strings: Removes malicious or extra characters from input
  const normalizedDonor = sanitizeText(donor);
  const normalizedRecipient = sanitizeText(recipient);

  // Logical check: Prevents a user from donating to themselves
  if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_TRANSACTION',
        message: 'Donor and recipient must be different'
      }
    });
  }

  // Recipient validation: Verifies G-address format if a Stellar key is used
  if (normalizedRecipient && normalizedRecipient.startsWith('G')) {
    if (!isValidStellarPublicKey(normalizedRecipient)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STELLAR_ADDRESS',
          message: 'Invalid Stellar public key format for recipient',
          field: 'recipient'
        }
      });
    }
  }

  // Donor validation: Verifies G-address format if a Stellar key is used
  if (normalizedDonor && normalizedDonor.startsWith('G')) {
    if (!isValidStellarPublicKey(normalizedDonor)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STELLAR_ADDRESS',
          message: 'Invalid Stellar public key format for donor',
          field: 'donor'
        }
      });
    }
  }

  next();
};

/**
 * Validate transaction verification request.
 * Ensures the transaction hash is present and follows the 64-char hex standard.
 */
const validateTransactionVerify = (req, res, next) => {
  const { transactionHash } = req.body;

  if (!transactionHash) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'Transaction hash is required',
        field: 'transactionHash'
      }
    });
  }

  // Regex-based hex check: Confirms the hash format before hitting external RPCs
  if (!isValidTransactionHash(transactionHash)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_TRANSACTION_HASH',
        message: 'Transaction hash must be a 64-character hexadecimal string',
        field: 'transactionHash'
      }
    });
  }

  next();
};

/**
 * Validate date range query parameters.
 * Confirms both start and end dates exist and that the range is chronologically valid.
 */
const validateDateRange = (req, res, next) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_PARAMETERS',
        message: 'Both startDate and endDate are required (ISO format)',
        fields: ['startDate', 'endDate']
      }
    });
  }

  // Internal validator check: Ensures start is before end
  const validation = isValidDateRange(startDate, endDate);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DATE_RANGE',
        message: validation.error
      }
    });
  }

  next();
};

/**
 * Validate wallet creation request.
 * Enforces name/address requirements and checks for existing registration in DB.
 */
const validateWalletCreate = (req, res, next) => {
  const { name, walletAddress } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'Name is required',
        field: 'name'
      }
    });
  }

  if (!walletAddress) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'Wallet address is required',
        field: 'walletAddress'
      }
    });
  }

  // Format check: Enforces 56-character 'G' address standard
  if (!isValidStellarPublicKey(walletAddress)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STELLAR_ADDRESS',
        message: 'Invalid Stellar public key format. Must start with G and be 56 characters',
        field: 'walletAddress'
      }
    });
  }

  // Uniqueness check: Queries existing storage to prevent duplicates
  if (walletAddressExists(walletAddress)) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'WALLET_EXISTS',
        message: 'Wallet address already registered',
        field: 'walletAddress'
      }
    });
  }

  next();
};

/**
 * Validate wallet ID parameter.
 * Checks URL parameters to ensure the referenced wallet exists.
 */
const validateWalletId = (req, res, next) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_PARAMETER',
        message: 'Wallet ID is required',
        field: 'id'
      }
    });
  }

  // Existence check: Prevents proceeding with operations on null/ghost objects
  if (!walletExists(id)) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'WALLET_NOT_FOUND',
        message: 'Wallet not found',
        field: 'id'
      }
    });
  }

  next();
};

/**
 * Factory function to validate Stellar public keys in request bodies.
 * @param {string} fieldName - The key in req.body to validate (defaults to 'publicKey')
 */
const validatePublicKey = (fieldName = 'publicKey') => {
  return (req, res, next) => {
    const publicKey = req.body[fieldName];

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELD',
          message: `${fieldName} is required`,
          field: fieldName
        }
      });
    }

    // Standard public key validation check
    if (!isValidStellarPublicKey(publicKey)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STELLAR_ADDRESS',
          message: 'Invalid Stellar public key format. Must start with G and be 56 characters',
          field: fieldName
        }
      });
    }

    next();
  };
};

module.exports = {
  validateDonationCreate,
  validateTransactionVerify,
  validateDateRange,
  validateWalletCreate,
  validateWalletId,
  validatePublicKey
};