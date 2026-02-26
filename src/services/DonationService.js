/**
 * Donation Service - Business Logic Layer
 * 
 * RESPONSIBILITY: Core donation processing, validation, and transaction management
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Database, validators, encryption
 * 
 * Orchestrates donation workflows including validation, fee calculation, transaction
 * creation, and state management. Separates business logic from HTTP controllers.
 */

const Database = require('../utils/database');
const Transaction = require('../routes/models/transaction');
const encryption = require('../utils/encryption');
const donationValidator = require('../utils/donationValidator');
const memoValidator = require('../utils/memoValidator');
const { calculateAnalyticsFee } = require('../utils/feeCalculator');
const { sanitizeIdentifier } = require('../utils/sanitizer');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

class DonationService {
  constructor(stellarService) {
    this.stellarService = stellarService;
  }

  /**
   * Verify a donation transaction by hash
   * @param {string} transactionHash - Stellar transaction hash
   * @returns {Promise<Object>} Verification result
   */
  async verifyTransaction(transactionHash) {
    if (!transactionHash) {
      throw new ValidationError('Transaction hash is required', null, ERROR_CODES.INVALID_REQUEST);
    }

    return await this.stellarService.verifyTransaction(transactionHash);
  }

  /**
   * Get user by ID with validation
   * @param {number} userId - User ID
   * @param {string} userType - Type of user (sender/receiver) for error messages
   * @returns {Promise<Object>} User object
   * @throws {NotFoundError} If user not found
   */
  async getUserById(userId, userType = 'user') {
    const user = await Database.get('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (!user) {
      throw new NotFoundError(`${userType} not found`, ERROR_CODES.USER_NOT_FOUND);
    }
    
    return user;
  }

  /**
   * Validate sender has encrypted secret key
   * @param {Object} sender - Sender user object
   * @throws {ValidationError} If sender has no secret key
   */
  validateSenderSecret(sender) {
    if (!sender.encryptedSecret) {
      throw new ValidationError(
        'Sender has no secret key configured',
        null,
        ERROR_CODES.MISSING_SECRET_KEY
      );
    }
  }

  /**
   * Send donation from one wallet to another (custodial)
   * @param {Object} params - Donation parameters
   * @param {number} params.senderId - Sender user ID
   * @param {number} params.receiverId - Receiver user ID
   * @param {number} params.amount - Donation amount
   * @param {string} params.memo - Optional memo
   * @param {string} params.idempotencyKey - Idempotency key
   * @param {string} params.requestId - Request ID for logging
   * @returns {Promise<Object>} Donation result with transaction details
   */
  async sendCustodialDonation({ senderId, receiverId, amount, memo, idempotencyKey, requestId }) {
    log.debug('DONATION_SERVICE', 'Processing custodial donation', {
      requestId,
      senderId,
      receiverId,
      amount,
      hasMemo: !!memo
    });

    // Get sender and receiver
    const sender = await this.getUserById(senderId, 'Sender');
    const receiver = await this.getUserById(receiverId, 'Receiver');

    log.debug('DONATION_SERVICE', 'Users retrieved', {
      requestId,
      senderFound: !!sender,
      receiverFound: !!receiver
    });

    // Validate sender has secret key
    this.validateSenderSecret(sender);

    // Decrypt sender's secret key
    const secret = encryption.decrypt(sender.encryptedSecret);

    log.debug('DONATION_SERVICE', 'Initiating Stellar transaction', {
      requestId
    });

    // Execute Stellar transaction
    const stellarResult = await this.stellarService.sendDonation({
      sourceSecret: secret,
      destinationPublic: receiver.publicKey,
      amount: amount,
      memo: memo
    });

    log.debug('DONATION_SERVICE', 'Stellar transaction successful', {
      requestId,
      transactionId: stellarResult.hash,
      ledger: stellarResult.ledger
    });

    // Record in database
    const dbResult = await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp, idempotencyKey) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
      [senderId, receiverId, amount, memo, idempotencyKey]
    );

    // Record in JSON with state transitions
    const transaction = Transaction.create({
      id: dbResult.id.toString(),
      amount: parseFloat(amount),
      donor: sender.publicKey,
      recipient: receiver.publicKey,
      status: TRANSACTION_STATES.PENDING
    });

    Transaction.updateStatus(transaction.id, TRANSACTION_STATES.SUBMITTED, {
      transactionId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
    });

    Transaction.updateStatus(transaction.id, TRANSACTION_STATES.CONFIRMED, {
      transactionId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
      confirmedAt: new Date().toISOString(),
    });

    return {
      id: dbResult.id,
      stellarTxId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
      amount: amount,
      sender: sender.publicKey,
      receiver: receiver.publicKey,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate donation amount and limits
   * @param {number} amount - Donation amount
   * @param {string} donor - Donor identifier (optional)
   * @returns {Object} Validation result
   * @throws {ValidationError} If validation fails
   */
  validateDonationAmount(amount, donor = null) {
    // Validate amount against configured limits
    const limitsValidation = donationValidator.validateAmount(amount);
    if (!limitsValidation.valid) {
      throw new ValidationError(
        limitsValidation.error,
        {
          code: limitsValidation.code,
          limits: {
            min: limitsValidation.minAmount,
            max: limitsValidation.maxAmount,
          },
        },
        limitsValidation.code
      );
    }

    // Validate daily limit if donor is specified
    if (donor && donor !== 'Anonymous') {
      const dailyTotal = Transaction.getDailyTotalByDonor(donor);
      const dailyValidation = donationValidator.validateDailyLimit(amount, dailyTotal);

      if (!dailyValidation.valid) {
        throw new ValidationError(
          dailyValidation.error,
          {
            code: dailyValidation.code,
            dailyLimit: dailyValidation.maxDailyAmount,
            currentDailyTotal: dailyValidation.currentDailyTotal,
            remainingDaily: dailyValidation.remainingDaily,
          },
          dailyValidation.code
        );
      }
    }

    return { valid: true };
  }

  /**
   * Validate and sanitize memo
   * @param {string} memo - Memo text
   * @returns {Object} Validation result with sanitized memo
   * @throws {ValidationError} If validation fails
   */
  validateAndSanitizeMemo(memo) {
    if (memo === undefined || memo === null) {
      return { valid: true, sanitized: '' };
    }

    const memoValidation = memoValidator.validate(memo);
    if (!memoValidation.valid) {
      throw new ValidationError(
        memoValidation.error,
        {
          code: memoValidation.code,
          maxLength: memoValidation.maxLength,
          currentLength: memoValidation.currentLength
        },
        memoValidation.code
      );
    }

    return {
      valid: true,
      sanitized: memoValidator.sanitize(memo)
    };
  }

  /**
   * Create a non-custodial donation record
   * @param {Object} params - Donation parameters
   * @param {number} params.amount - Donation amount
   * @param {string} params.donor - Donor identifier
   * @param {string} params.recipient - Recipient identifier
   * @param {string} params.memo - Optional memo
   * @param {string} params.idempotencyKey - Idempotency key
   * @returns {Object} Created transaction
   */
  async createDonationRecord({ amount, donor, recipient, memo, idempotencyKey }) {
    // Sanitize identifiers
    const sanitizedDonor = donor ? sanitizeIdentifier(donor) : 'Anonymous';
    const sanitizedRecipient = sanitizeIdentifier(recipient);

    // Validate donor and recipient are different
    if (sanitizedDonor && sanitizedRecipient && sanitizedDonor === sanitizedRecipient) {
      throw new ValidationError('Sender and recipient wallets must be different');
    }

    // Validate amount and limits
    this.validateDonationAmount(amount, sanitizedDonor);

    // Validate and sanitize memo
    const memoResult = this.validateAndSanitizeMemo(memo);

    // Calculate analytics fee
    const feeCalculation = calculateAnalyticsFee(amount);

    // Create transaction record
    const transaction = Transaction.create({
      amount: amount,
      donor: sanitizedDonor,
      recipient: sanitizedRecipient,
      memo: memoResult.sanitized,
      idempotencyKey: idempotencyKey,
      analyticsFee: feeCalculation.fee,
      analyticsFeePercentage: feeCalculation.feePercentage
    });

    return transaction;
  }

  /**
   * Get all donations
   * @returns {Array} Array of transactions
   */
  getAllDonations() {
    return Transaction.getAll();
  }

  /**
   * Get recent donations with limit
   * @param {number} limit - Maximum number of donations to return
   * @returns {Array} Array of sanitized transactions
   */
  getRecentDonations(limit = 10) {
    const transactions = Transaction.getAll();

    // Sort by timestamp descending (most recent first)
    const sortedTransactions = transactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Remove sensitive data
    return sortedTransactions.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      donor: tx.donor,
      recipient: tx.recipient,
      timestamp: tx.timestamp,
      status: tx.status
    }));
  }

  /**
   * Get donation by ID
   * @param {string} id - Transaction ID
   * @returns {Object} Transaction object
   * @throws {NotFoundError} If donation not found
   */
  getDonationById(id) {
    const transaction = Transaction.getById(id);

    if (!transaction) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    return transaction;
  }

  /**
   * Update donation status
   * @param {string} id - Transaction ID
   * @param {string} status - New status
   * @param {Object} stellarData - Optional Stellar transaction data
   * @returns {Object} Updated transaction
   */
  updateDonationStatus(id, status, stellarData = {}) {
    const validStatuses = Object.values(TRANSACTION_STATES);
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const updateData = { ...stellarData };
    if (status === 'confirmed') {
      updateData.confirmedAt = new Date().toISOString();
    }

    return Transaction.updateStatus(id, status, updateData);
  }

  /**
   * Get donation limits
   * @returns {Object} Donation limits configuration
   */
  getDonationLimits() {
    const limits = donationValidator.getLimits();
    return {
      minAmount: limits.minAmount,
      maxAmount: limits.maxAmount,
      maxDailyPerDonor: limits.maxDailyPerDonor,
      currency: 'XLM',
    };
  }
}

module.exports = DonationService;
