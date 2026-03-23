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
const LimitService = require('./LimitService');
const log = require('../utils/log');
const { buildOverpaymentRecord } = require('../utils/overpaymentDetector');
const memoCollisionDetector = require('../utils/memoCollisionDetector');

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

    // Check per-wallet donation limits
    await LimitService.checkLimits(senderId, amount);

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

    // Record in database — store stellar_tx_id for cross-referencing
    const dbResult = await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp, idempotencyKey, stellar_tx_id) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)',
      [senderId, receiverId, amount, memo, idempotencyKey, stellarResult.transactionId]
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

    // Only advance to CONFIRMED when the ledger confirmation threshold is met.
    // stellarResult.ledger is the ledger the tx was included in.
    // We use it as both transactionLedger and currentLedger here because Stellar
    // confirms transactions within the same ledger close — the threshold check
    // ensures at least CONFIRMATION_LEDGER_THRESHOLD subsequent ledgers have closed
    // before we mark the transaction final.
    const confirmationResult = checkConfirmations(
      stellarResult.ledger,
      stellarResult.currentLedger || stellarResult.ledger,
      CONFIRMATION_LEDGER_THRESHOLD
    );

    if (confirmationResult.confirmed) {
      Transaction.updateStatus(transaction.id, TRANSACTION_STATES.CONFIRMED, {
        transactionId: stellarResult.transactionId,
        ledger: stellarResult.ledger,
        confirmedAt: new Date().toISOString(),
        confirmations: confirmationResult.confirmations,
        confirmationThreshold: confirmationResult.required,
      });
      log.info('DONATION_SERVICE', 'Transaction confirmed', {
        requestId,
        transactionId: stellarResult.transactionId,
        confirmations: confirmationResult.confirmations,
        threshold: confirmationResult.required,
      });
    } else {
      log.info('DONATION_SERVICE', 'Transaction submitted — awaiting confirmation threshold', {
        requestId,
        transactionId: stellarResult.transactionId,
        confirmations: confirmationResult.confirmations,
        required: confirmationResult.required,
        status: TRANSACTION_STATES.SUBMITTED,
      });
    }

    // Get remaining limits for response headers
    const { dailyRemaining, monthlyRemaining } = await LimitService.getRemainingLimits(senderId);

    return {
      id: dbResult.id,
      stellarTxId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
      amount: amount,
      sender: sender.publicKey,
      receiver: receiver.publicKey,
      timestamp: new Date().toISOString(),
      status: confirmationResult.confirmed ? TRANSACTION_STATES.CONFIRMED : TRANSACTION_STATES.SUBMITTED,
      confirmations: confirmationResult.confirmations,
      confirmationThreshold: confirmationResult.required,
      confirmed: confirmationResult.confirmed,
      remainingLimits: { dailyRemaining, monthlyRemaining }
    };
  }

  /**
   * Attempt to confirm a previously submitted transaction.
   * Fetches the latest ledger from the network and checks whether the
   * confirmation threshold has been met. If so, advances the transaction
   * state to CONFIRMED.
   *
   * @param {string} transactionId - Internal transaction ID (JSON store)
   * @param {number} currentLedger - Latest ledger sequence from the network
   * @param {number} [threshold]   - Override threshold (defaults to configured value)
   * @returns {{
   *   confirmed: boolean,
   *   confirmations: number,
   *   required: number,
   *   transaction: Object
   * }}
   */
  confirmTransaction(transactionId, currentLedger, threshold) {
    const transaction = Transaction.getById(transactionId);
    if (!transaction) {
      throw new NotFoundError('Transaction not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    if (transaction.status === TRANSACTION_STATES.CONFIRMED) {
      return {
        confirmed: true,
        confirmations: transaction.confirmations || 0,
        required: threshold || CONFIRMATION_LEDGER_THRESHOLD,
        transaction,
      };
    }

    if (!transaction.stellarLedger) {
      throw new ValidationError('Transaction has no ledger information — cannot check confirmations', null, ERROR_CODES.INVALID_REQUEST);
    }

    const result = checkConfirmations(transaction.stellarLedger, currentLedger, threshold);

    if (result.confirmed) {
      Transaction.updateStatus(transactionId, TRANSACTION_STATES.CONFIRMED, {
        confirmedAt: new Date().toISOString(),
        confirmations: result.confirmations,
        confirmationThreshold: result.required,
      });

      log.info('DONATION_SERVICE', 'Transaction confirmed via confirmTransaction', {
        transactionId,
        confirmations: result.confirmations,
        threshold: result.required,
      });
    } else {
      log.info('DONATION_SERVICE', 'Transaction not yet confirmed', {
        transactionId,
        confirmations: result.confirmations,
        required: result.required,
      });
    }

    return {
      confirmed: result.confirmed,
      confirmations: result.confirmations,
      required: result.required,
      transaction: Transaction.getById(transactionId),
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
  async createDonationRecord({ amount, donor, recipient, memo, idempotencyKey, receivedAmount, sessionId }) {
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

    // Detect overpayment — compare received amount vs (donation + expected fee)
    // receivedAmount defaults to amount when not explicitly provided (no overpayment)
    const effectiveReceived = (typeof receivedAmount === 'number' && Number.isFinite(receivedAmount))
      ? receivedAmount
      : amount;

    const overpayment = buildOverpaymentRecord(effectiveReceived, amount, feeCalculation.fee);

    if (overpayment) {
      log.warn('DONATION_SERVICE', 'Overpayment detected', {
        donor: sanitizedDonor,
        donationAmount: amount,
        expectedFee: feeCalculation.fee,
        expectedTotal: overpayment.expectedTotal,
        receivedAmount: overpayment.receivedAmount,
        excessAmount: overpayment.excessAmount,
        overpaymentPercentage: overpayment.overpaymentPercentage,
      });
    }

    // Create transaction record
    const transaction = Transaction.create({
      amount: amount,
      donor: sanitizedDonor,
      recipient: sanitizedRecipient,
      memo: memoResult.sanitized,
      idempotencyKey: idempotencyKey,
      analyticsFee: feeCalculation.fee,
      analyticsFeePercentage: feeCalculation.feePercentage,
      // Overpayment fields (null when no overpayment)
      overpaymentFlagged: overpayment ? true : false,
      overpaymentDetails: overpayment || null,
    });

    // Detect memo collision after the record is created so we have a transactionId
    const collisionResult = memoCollisionDetector.check({
      memo: memoResult.sanitized,
      donor: sanitizedDonor,
      recipient: sanitizedRecipient,
      amount,
      sessionId: sessionId || null,
      transactionId: transaction.id,
    });

    if (collisionResult.collision) {
      transaction.memoCollision = true;
      transaction.memoSuspicious = collisionResult.suspicious;
      transaction.memoCollisionReason = collisionResult.reason;
      // Persist the updated flags
      const Transaction_ = require('../routes/models/transaction');
      const all = Transaction_.loadTransactions();
      const idx = all.findIndex(t => t.id === transaction.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...transaction };
        Transaction_.saveTransactions(all);
      }
    } else {
      transaction.memoCollision = false;
      transaction.memoSuspicious = false;
      transaction.memoCollisionReason = null;
    }

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
   * Get donations using cursor-based pagination.
   * @param {Object} pagination - Pagination options.
   * @param {{ timestamp: string, id: string }|null} pagination.cursor - Decoded cursor.
   * @param {number} pagination.limit - Page size.
   * @param {string} pagination.direction - Pagination direction.
   * @returns {{ data: Array, totalCount: number, meta: Object }} Paginated donations.
   */
  getPaginatedDonations(pagination) {
    return paginateCollection(Transaction.getAll(), {
      ...pagination,
      timestampField: 'timestamp',
      idField: 'id',
    });
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
