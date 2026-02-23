/**
 * Validation middleware for API endpoints
 */

const {
  isValidStellarPublicKey,
  isValidAmount,
  walletExists,
  walletAddressExists,
  isValidDateRange,
  isValidTransactionHash,
  sanitizeString
} = require('../utils/validators');

/**
 * Validate donation creation request
 */
const validateDonationCreate = (req, res, next) => {
  const { amount, donor, recipient } = req.body;

  // Validate required fields
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

  // Validate amount
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

  // Sanitize strings
  const normalizedDonor = sanitizeString(donor);
  const normalizedRecipient = sanitizeString(recipient);

  // Validate donor and recipient are different
  if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_TRANSACTION',
        message: 'Donor and recipient must be different'
      }
    });
  }

  // If recipient is a Stellar address, validate format
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

  // If donor is a Stellar address, validate format
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
 * Validate transaction verification request
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
 * Validate date range query parameters
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
 * Validate wallet creation request
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

  // Validate Stellar address format
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

  // Check if wallet already exists
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
 * Validate wallet ID parameter
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
 * Validate Stellar public key in request body
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
