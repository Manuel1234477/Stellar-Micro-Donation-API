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
const Transaction = require('../models/transaction');
const encryption = require('../utils/encryption');
const { STROOPS_PER_XLM } = require('../constants');
const donationValidator = require('../utils/donationValidator');
const memoValidator = require('../utils/memoValidator');
const { calculateAnalyticsFee } = require('../utils/feeCalculator');
const { sanitizeIdentifier, sanitizeMemo } = require('../utils/sanitizer');
const { generatePseudonymousId } = require('../utils/anonymization');
const { withTimeout } = require('../utils/timeoutHandler');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');
const { PREDEFINED_TAGS } = require('../constants/tags');
const { paginateCollection } = require('../utils/pagination');
const { checkConfirmations } = require('../utils/confirmationChecker');
const { CONFIRMATION_LEDGER_THRESHOLD } = require('../config/confirmationThreshold');

const LimitService = require('./LimitService');
const DonationVelocityService = require('./DonationVelocityService');
const MatchingProgramService = require('./MatchingProgramService');
const CorporateMatchingService = require('./CorporateMatchingService');
const log = require('../utils/log');
const priceOracle = require('./PriceOracleService');
const { buildOverpaymentRecord } = require('../utils/overpaymentDetector');
const memoCollisionDetector = require('../utils/memoCollisionDetector');
const {
  parseAssetInput,
  isSameAsset,
  serializeAsset,
} = require('../utils/stellarAsset');
const donationEvents = require('../events/donationEvents');

const DEFAULT_DESTINATION_ASSET = {
  type: 'native',
  code: 'XLM',
  issuer: null,
};

const RECIPIENT_ACCOUNT_CACHE_TTL_MS = 60 * 1000;
const _recipientAccountCache = new Map();

class DonationService {
  constructor(stellarService) {
    this.stellarService = stellarService;
  }

  /**
   * Pre-flight check: verify the recipient Stellar account exists.
   * Result is cached for 60 s per public key.
   * Skipped when MOCK_STELLAR=true.
   *
   * @param {string} publicKey - Stellar public key (G…)
   * @throws {BusinessLogicError} When account does not exist on the network.
   */
  async checkRecipientAccountExists(publicKey) {
    if (process.env.MOCK_STELLAR === 'true') {
      return;
    }

    const now = Date.now();
    const cached = _recipientAccountCache.get(publicKey);
    if (cached && now < cached.expiresAt) {
      if (!cached.exists) {
        throw new BusinessLogicError(
          ERROR_CODES.RECIPIENT_ACCOUNT_NOT_FOUND,
          'Recipient account does not exist on the Stellar network. The recipient must fund their account with at least 1 XLM before receiving donations.'
        );
      }
      return;
    }

    const info = await this.stellarService.getAccountInfo(publicKey);
    const exists = !info.notFound && !info.error;

    _recipientAccountCache.set(publicKey, { exists, expiresAt: now + RECIPIENT_ACCOUNT_CACHE_TTL_MS });

    if (!exists) {
      throw new BusinessLogicError(
        ERROR_CODES.RECIPIENT_ACCOUNT_NOT_FOUND,
        'Recipient account does not exist on the Stellar network. The recipient must fund their account with at least 1 XLM before receiving donations.'
      );
    }
  }

  /**
   * Verify a donation transaction by hash
   * @param {string} transactionHash - Stellar transaction hash
   * @returns {Promise<Object>} Verification result
   */
  async verifyTransaction(transactionHash, donationId) {
    if (!transactionHash) {
      throw new ValidationError('Transaction hash is required', null, ERROR_CODES.INVALID_REQUEST);
    }

    // When a donationId is supplied, cross-check before hitting the network
    if (donationId) {
      const donation = this.getDonationById(donationId);

      // 1. Compare the submitted hash against the stored hash
      const storedHash = donation.stellarTxId || donation.transactionHash || null;
      if (storedHash && storedHash !== transactionHash) {
        throw new ValidationError(
          'Transaction hash does not match the donation record',
          { donationId, storedHash, submittedHash: transactionHash },
          'VERIFICATION_FAILED'
        );
      }

      // 2. Fetch on-chain data and compare amount / parties
      const result = await this.stellarService.verifyTransaction(transactionHash);
      const onChain = result.transaction;

      if (onChain) {
        // Compare amount (tolerant of string/number and rounding to 7 decimals)
        const onChainAmount = parseFloat(onChain.amount);
        const donationAmount = parseFloat(donation.amount);
        if (!isNaN(onChainAmount) && !isNaN(donationAmount)) {
          const diff = Math.abs(onChainAmount - donationAmount);
          if (diff > 0.0000001) {
            throw new ValidationError(
              `Transaction amount mismatch: on-chain ${onChainAmount}, donation record ${donationAmount}`,
              { donationId, onChainAmount, donationAmount },
              'VERIFICATION_FAILED'
            );
          }
        }

        // Compare sender (source)
        if (onChain.source && donation.donor && onChain.source !== donation.donor) {
          throw new ValidationError(
            `Transaction sender mismatch: on-chain ${onChain.source}, donation record ${donation.donor}`,
            { donationId, onChainSource: onChain.source, donationDonor: donation.donor },
            'VERIFICATION_FAILED'
          );
        }

        // Compare recipient (destination)
        if (onChain.destination && donation.recipient && onChain.destination !== donation.recipient) {
          throw new ValidationError(
            `Transaction recipient mismatch: on-chain ${onChain.destination}, donation record ${donation.recipient}`,
            { donationId, onChainDestination: onChain.destination, donationRecipient: donation.recipient },
            'VERIFICATION_FAILED'
          );
        }
      }

      return result;
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
  async sendCustodialDonation({ senderId, receiverId, amount, memo, notes, tags, apiKeyId, campaign_id, idempotencyKey, requestId }) {
    log.debug('DONATION_SERVICE', 'Processing custodial donation', {
      requestId,
      senderId,
      receiverId,
      amount,
      hasMemo: !!memo,
      hasNotes: !!notes,
      tagsCount: tags ? tags.length : 0
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

    // Check per-recipient velocity limits (before Stellar transaction)
    await DonationVelocityService.checkVelocityLimits(senderId, receiverId, amount);

    // #1157: Idempotency replay — if this key was already committed, return the original
    if (idempotencyKey) {
      const existing = await Database.get(
        'SELECT * FROM transactions WHERE idempotencyKey = ?',
        [idempotencyKey]
      );
      if (existing) {
        log.info('DONATION_SERVICE', 'Idempotency replay: returning existing transaction', {
          requestId,
          idempotencyKey,
          existingId: existing.id,
        });
        const { dailyRemaining, monthlyRemaining } = await LimitService.getRemainingLimits(senderId);
        return {
          id: existing.id,
          stellarTxId: existing.stellar_tx_id,
          ledger: existing.ledger,
          amount,
          sender: sender.publicKey,
          receiver: receiver.publicKey,
          timestamp: existing.timestamp,
          status: TRANSACTION_STATES.SUBMITTED,
          remainingLimits: { dailyRemaining, monthlyRemaining },
          replayed: true,
        };
      }
    }

    // Sanitize memo to prevent XSS and injection attacks
    const sanitizedMemo = memo ? sanitizeMemo(memo) : undefined;

    // Decrypt sender's secret key
    const secret = encryption.decrypt(sender.encryptedSecret);

    // Check sender balance before submitting (max 2s to avoid slowing donation flow)
    try {
      const { balance } = await withTimeout(
        this.stellarService.getBalance(sender.publicKey),
        2000,
        'balanceCheck'
      );
      const available = parseFloat(balance);
      const reserve = parseFloat(process.env.STELLAR_BASE_RESERVE || '1');
      const required = parseFloat(amount) + reserve;
      if (available < required) {
        throw new BusinessLogicError(
          ERROR_CODES.INSUFFICIENT_BALANCE,
          `Insufficient balance. Required: ${required.toFixed(7)} XLM, Available: ${available.toFixed(7)} XLM`
        );
      }
    } catch (err) {
      if (err instanceof BusinessLogicError) throw err;
      // Balance check timed out or failed — log and proceed optimistically
      log.warn('DONATION_SERVICE', 'Balance check skipped', { requestId, error: err.message });
    }

    log.debug('DONATION_SERVICE', 'Initiating Stellar transaction', {
      requestId
    });

    // Execute Stellar transaction with sanitized memo
    const stellarResult = await this.stellarService.sendDonation({
      sourceSecret: secret,
      destinationPublic: receiver.publicKey,
      amount: amount,
      memo: sanitizedMemo
    });

    log.debug('DONATION_SERVICE', 'Stellar transaction successful', {
      requestId,
      transactionId: stellarResult.hash,
      ledger: stellarResult.ledger
    });

    // Record in database with sanitized memo — amount stored as integer stroops.
    // The totals table update is atomic with the transactions INSERT so that a
    // rollback can never leave totals incremented without a corresponding row.
    const amountStroops = Math.round(parseFloat(amount) * STROOPS_PER_XLM);
    const DonationTotalsRepository = require('./DonationTotalsRepository');
    const totalsRepo = new DonationTotalsRepository();
    const dbResult = await Database.runTransaction(async (tx) => {
      const r = await tx.run(
        'INSERT INTO transactions (senderId, receiverId, amount, memo, notes, tags, timestamp, idempotencyKey, stellar_tx_id) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)',
        [senderId, receiverId, amountStroops, sanitizedMemo, notes || null, JSON.stringify(tags || []), idempotencyKey, stellarResult.transactionId]
      );
      await totalsRepo.incrementTotal(String(receiverId), amountStroops, tx);
      return r;
    });

    // Emit donation.created to trigger cache invalidation and other listeners (non-blocking)
    try {
      donationEvents.emit(donationEvents.constructor.EVENTS?.CREATED || 'donation.created', {
        id: dbResult.id,
        senderId,
        receiverId,
        amount,
      });
    } catch (err) {
      log.error('DONATION_SERVICE', 'Failed to emit donation.created event', { error: err.message });
    }

    if (campaign_id) {
      await this.processCampaignContribution(campaign_id, amount).catch(err => {
        log.error('DONATION_SERVICE', 'Failed to update campaign contribution', { error: err.message });
      });
    }

    // Record velocity usage (non-blocking)
    DonationVelocityService.recordDonation(senderId, receiverId, amount).catch(err => {
      log.error('DONATION_SERVICE', 'Failed to record velocity', { error: err.message });
    });

    // Process donation matching programs (non-blocking)
    let matchingDonations = [];
    try {
      matchingDonations = await MatchingProgramService.processMatchingDonation({
        id: dbResult.id,
        amount: parseFloat(amount),
        campaign_id: campaign_id || null
      });
    } catch (err) {
      log.error('DONATION_SERVICE', 'Failed to process donation matching', { error: err.message });
    }

    // Record in JSON with state transitions
    const transaction = Transaction.create({
      id: dbResult.id.toString(),
      amount: parseFloat(amount),
      donor: sender.publicKey,
      recipient: receiver.publicKey,
      status: TRANSACTION_STATES.PENDING,
      notes: notes || null,
      tags: tags || [],
      apiKeyId: apiKeyId || null
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
      remainingLimits: { dailyRemaining, monthlyRemaining },
      ...(matchingDonations.length > 0 && { matchingDonations })
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
   * Normalize and validate a donation amount used in either direct or path payments.
   * @param {number} amount - Parsed numeric amount.
   * @param {string} fieldName - Field name for validation context.
   * @throws {ValidationError} If amount is invalid.
   */
  validatePaymentAmount(amount, fieldName) {
    const validation = donationValidator.validateAmount(amount);
    if (!validation.valid) {
      throw new ValidationError(
        `${fieldName}: ${validation.error}`,
        null,
        validation.code || ERROR_CODES.INVALID_AMOUNT
      );
    }
  }

  /**
   * Resolve the secret key that should sign a donation payment.
   * Prefers a wallet owned by the donor in mock mode and falls back to a configured service key.
   *
   * @param {string|null} donor - Donor identifier.
   * @returns {string|null} Secret key or null when no payment signer is available.
   */
  resolvePaymentSourceSecret(donor) {
    if (
      donor &&
      this.stellarService &&
      typeof this.stellarService.getSecretForPublicKey === 'function'
    ) {
      const donorSecret = this.stellarService.getSecretForPublicKey(donor);
      if (donorSecret) {
        return donorSecret;
      }
    }

    return this.stellarService && this.stellarService.serviceSecretKey
      ? this.stellarService.serviceSecretKey
      : null;
  }

  /**
   * Estimate the best server-side path payment route for a donation quote.
   *
   * @param {Object} params - Estimate parameters.
   * @param {string|Object} params.sourceAsset - Source asset definition.
   * @param {number} params.sourceAmount - Source amount.
   * @param {string|Object} [params.destAsset] - Destination asset definition.
   * @param {number} [params.destAmount] - Destination amount.
   * @returns {Promise<Object>} Path estimate payload.
   */
  async estimateDonationPath({ sourceAsset, sourceAmount, destAsset, destAmount }) {
    const normalizedSourceAsset = parseAssetInput(sourceAsset, 'sourceAsset');
    const normalizedDestAsset = destAsset
      ? parseAssetInput(destAsset, 'destAsset')
      : DEFAULT_DESTINATION_ASSET;

    if (sourceAmount !== undefined && sourceAmount !== null) {
      this.validatePaymentAmount(sourceAmount, 'sourceAmount');
    }
    if (destAmount !== undefined && destAmount !== null) {
      this.validatePaymentAmount(destAmount, 'destAmount');
    }

    const estimate = await this.stellarService.discoverBestPath({
      sourceAsset: normalizedSourceAsset,
      sourceAmount: sourceAmount !== undefined && sourceAmount !== null ? sourceAmount.toString() : undefined,
      destAsset: normalizedDestAsset,
      destAmount: destAmount !== undefined && destAmount !== null ? destAmount.toString() : undefined,
    });

    if (!estimate) {
      throw new ValidationError('No conversion path found for the requested asset pair');
    }

    return {
      sourceAsset: serializeAsset(normalizedSourceAsset),
      sourceAmount: estimate.sourceAmount,
      destAsset: serializeAsset(normalizedDestAsset),
      destAmount: estimate.destAmount,
      conversionRate: estimate.conversionRate,
      path: estimate.path,
    };
  }

  /**
   * Create a non-custodial donation record
   * @param {Object} params - Donation parameters
   * @param {number} params.amount - Donation amount (in the specified currency)
   * @param {string} [params.currency='XLM'] - Currency of the amount (XLM, USD, EUR, GBP)
   * @param {string} params.donor - Donor identifier
   * @param {string} params.recipient - Recipient identifier
   * @param {string} params.memo - Optional memo
   * @param {string|Object} [params.sourceAsset] - Optional source asset for cross-asset payments
   * @param {number} [params.sourceAmount] - Optional source asset amount
   * @param {string} params.idempotencyKey - Idempotency key
   * @returns {Object} Created transaction
   */
  async createDonationRecord({
    amount,
    currency = 'XLM',
    donor,
    recipient,
    memo,
    notes,
    tags,
    memoType = 'text',
    apiKeyId,
    apiKeyRole = 'user',
    idempotencyKey,
    receivedAmount,
    sessionId,
    campaign_id = null,
    anonymous = false,
    sourceAsset,
    sourceAmount,
    validAfter = 0,
    validBefore = 0,
    memoEnvelope = null,
    encryptionMetadata = null,
    sdgCategories = [],
    correlationId = null,
  }) {
    // Sanitize identifiers
    const rawDonor = donor ? sanitizeIdentifier(donor) : 'Anonymous';
    const rawRecipient = recipient ? sanitizeIdentifier(recipient) : null;

    // Validate donor and recipient are different (check raw values before anonymization)
    if (rawDonor && rawRecipient && rawDonor !== 'Anonymous' && rawDonor === rawRecipient) {
      throw new ValidationError('Sender and recipient cannot be the same wallet', null, ERROR_CODES.INVALID_REQUEST);
    }

    // When anonymous=true, replace the real wallet address with a pseudonymous ID
    let sanitizedDonor;
    let pseudonymousId = null;
    if (anonymous && rawDonor && rawDonor !== 'Anonymous') {
      pseudonymousId = generatePseudonymousId(rawDonor);
      sanitizedDonor = pseudonymousId;
    } else {
      sanitizedDonor = rawDonor;
    }

    const sanitizedRecipient = rawRecipient;

    // Validate memo with type-aware validation
    const memoResult = memoType && memoType !== 'text'
      ? memoValidator.validateWithType(memo, memoType)
      : this.validateAndSanitizeMemo(memo);

    if (sourceAmount !== undefined && sourceAmount !== null) {
      this.validatePaymentAmount(sourceAmount, 'sourceAmount');
    }

    if (!memoResult.valid) {
      throw new ValidationError(memoResult.error, null, memoResult.code);
    }

    if (amount <= 0) {
      throw new ValidationError('Amount must be positive');
    }

    // Validate tags against taxonomy
    this._validateTags(tags, apiKeyRole);

    // Currency conversion
    const normalizedCurrency = currency.toUpperCase();
    let xlmAmount = amount;
    if (normalizedCurrency !== 'XLM') {
      try {
        xlmAmount = await priceOracle.convertToXLM(amount, normalizedCurrency);
        log.info('DONATION_SERVICE', 'Currency converted', {
          originalAmount: amount,
          originalCurrency: normalizedCurrency,
          xlmAmount
        });
      } catch (err) {
        throw new ValidationError(`Currency conversion failed: ${err.message}`);
      }
    }

    // Validate XLM amount and limits
    this.validateDonationAmount(xlmAmount, sanitizedDonor);

    // Calculate analytics fee
    const feeCalculation = calculateAnalyticsFee(xlmAmount);

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

    const sourceAssetProvided = sourceAsset !== undefined && sourceAsset !== null;
    const normalizedDestAsset = DEFAULT_DESTINATION_ASSET;
    const normalizedSourceAsset = sourceAssetProvided
      ? parseAssetInput(sourceAsset, 'sourceAsset')
      : normalizedDestAsset;
    const normalizedSourceAmount = sourceAmount ?? xlmAmount;
    const sourceSecret = this.resolvePaymentSourceSecret(sanitizedDonor);
    let stellarResult = null;
    let paymentMethod = 'record_only';
    let fallbackUsed = false;
    let selectedPath = [];
    let conversionRate = null;

    if (sourceSecret && sanitizedRecipient) {
      await this.checkRecipientAccountExists(sanitizedRecipient);
      if (!sourceAssetProvided) {
        // Set correlation ID on StellarService for this request
        if (correlationId) {
          this.stellarService.setCorrelationId(correlationId);
        }
        
        stellarResult = await this.stellarService.sendDonation({
          sourceSecret,
          destinationPublic: sanitizedRecipient,
          amount: normalizedSourceAmount.toString(),
          memo: memoResult.sanitized,
          asset: normalizedSourceAsset,
          validAfter,
          validBefore,
        });
        paymentMethod = 'direct';
      } else {
        // Set correlation ID on StellarService for this request
        if (correlationId) {
          this.stellarService.setCorrelationId(correlationId);
        }
        
        const estimate = await this.stellarService.discoverBestPath({
          sourceAsset: normalizedSourceAsset,
          sourceAmount: normalizedSourceAmount.toString(),
          destAsset: normalizedDestAsset,
          destAmount: xlmAmount.toString(),
        });

        if (!estimate) {
          throw new ValidationError('No conversion path found for the requested asset pair');
        }

        selectedPath = estimate.path || [];
        conversionRate = estimate.conversionRate;

        try {
          stellarResult = await this.stellarService.pathPayment(
            normalizedSourceAsset,
            normalizedSourceAmount.toString(),
            normalizedDestAsset,
            estimate.destAmount,
            selectedPath,
            {
              sourceSecret,
              destinationPublic: sanitizedRecipient,
              memo: memoResult.sanitized,
            }
          );
          paymentMethod = 'path';
        } catch (error) {
          if (isSameAsset(normalizedSourceAsset, normalizedDestAsset)) {
            if (typeof this.stellarService.disableFailureSimulation === 'function') {
              this.stellarService.disableFailureSimulation();
            }
            stellarResult = await this.stellarService.sendDonation({
              sourceSecret,
              destinationPublic: sanitizedRecipient,
              amount: normalizedSourceAmount.toString(),
              memo: memoResult.sanitized,
              asset: normalizedSourceAsset,
              validAfter,
              validBefore,
            });
            paymentMethod = 'direct';
            fallbackUsed = true;
          } else {
            throw error;
          }
        }
      }
    }

    // Create transaction record
    const transaction = Transaction.create({
      amount: xlmAmount,
      originalAmount: normalizedCurrency !== 'XLM' ? amount : undefined,
      originalCurrency: normalizedCurrency !== 'XLM' ? normalizedCurrency : undefined,
      donor: sanitizedDonor,
      recipient: sanitizedRecipient,
      memo: memoResult.sanitized,
      memoType: memoType || 'text',
      notes: notes || null,
      tags: tags || [],
      apiKeyId: apiKeyId || null,
      idempotencyKey: idempotencyKey,
      memoEnvelope: memoEnvelope || null,
      encryptionMetadata: encryptionMetadata || null,
      analyticsFee: feeCalculation.fee,
      analyticsFeePercentage: feeCalculation.feePercentage,
      status: stellarResult ? TRANSACTION_STATES.CONFIRMED : TRANSACTION_STATES.PENDING,
      stellarTxId: stellarResult ? stellarResult.transactionId : null,
      stellarLedger: stellarResult ? stellarResult.ledger : null,
      confirmedAt: stellarResult ? new Date().toISOString() : null,
      sourceAsset: serializeAsset(normalizedSourceAsset),
      sourceAmount: normalizedSourceAmount.toString(),
      destinationAsset: serializeAsset(normalizedDestAsset),
      destinationAmount: xlmAmount.toString(),
      paymentMethod,
      fallbackUsed,
      path: selectedPath,
      conversionRate,
      // Overpayment fields (null when no overpayment)
      overpaymentFlagged: overpayment ? true : false,
      overpaymentDetails: overpayment || null,
      campaign_id: campaign_id || null,
      // Anonymous donation fields
      anonymous: anonymous === true,
      pseudonymousId: pseudonymousId || null,
      // Time-bound transaction fields
      validAfter: validAfter || 0,
      validBefore: validBefore || 0,
      sdgCategories: sdgCategories || [],
    });

    if (campaign_id) {
      await this.processCampaignContribution(campaign_id, xlmAmount).catch(err => {
        log.error('DONATION_SERVICE', 'Failed to update campaign contribution', { error: err.message });
      });
    }

    // Process donation matching programs (non-blocking)
    try {
      const matchingResults = await MatchingProgramService.processMatchingDonation({
        id: transaction.id,
        amount: xlmAmount,
        campaign_id: campaign_id || null
      });
      if (matchingResults.length > 0) {
        transaction.matchingDonations = matchingResults;
      }
    } catch (err) {
      log.error('DONATION_SERVICE', 'Failed to process donation matching', { error: err.message });
    }

    // Process corporate matching programs (non-blocking)
    try {
      // Get sender user ID from public key
      const senderUser = await Database.get('SELECT id FROM users WHERE publicKey = ?', [sanitizedDonor]);
      if (senderUser) {
        const corporateMatchingResults = await CorporateMatchingService.processCorporateMatching({
          id: transaction.id,
          amount: xlmAmount,
          senderId: senderUser.id
        });
        if (corporateMatchingResults.length > 0) {
          transaction.corporateMatchingDonations = corporateMatchingResults;
        }
      }
    } catch (err) {
      log.error('DONATION_SERVICE', 'Failed to process corporate matching', { error: err.message });
    }

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
      const Transaction_ = require('../models/transaction');
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

    // Publish GraphQL subscription events
    const pubsub = require('../graphql/pubsub');
    const donationEvent = {
      id: transaction.id,
      donor: transaction.donor,
      recipient: transaction.recipient,
      amount: transaction.amount,
      status: transaction.status,
      stellarTxId: transaction.stellarTxId,
      campaign_id: transaction.campaign_id || null,
      timestamp: transaction.timestamp,
    };
    pubsub.publish(pubsub.TOPICS.DONATION_CREATED, donationEvent);
    if (transaction.status === TRANSACTION_STATES.CONFIRMED) {
      pubsub.publish(pubsub.TOPICS.DONATION_COMPLETED, donationEvent);
    }

    return transaction;
  }

  /**
   * Calculate milestone percentages for a campaign (0.25, 0.5, 0.75, 1.0)
   * @param {number} totalRaised - Total amount raised
   * @param {number} goalAmount - Campaign goal amount
   * @returns {number[]} Array of milestones that have been reached (as decimals)
   */
  checkMilestones(totalRaised, goalAmount) {
    const milestones = [0.25, 0.5, 0.75, 1.0];
    const currentProgress = totalRaised / goalAmount;
    
    return milestones.filter(m => currentProgress >= m);
  }

  /**
   * Get notified milestones for a campaign (stored as JSON)
   * @param {Object} campaign - Campaign record from database
   * @returns {number[]} Array of milestone decimals already notified
   */
  getNotifiedMilestones(campaign) {
    if (!campaign.notified_milestones) return [];
    
    try {
      const notified = JSON.parse(campaign.notified_milestones);
      return Array.isArray(notified) ? notified : [];
    } catch (err) {
      log.warn('CAMPAIGN', 'Failed to parse notified_milestones JSON', { error: err.message });
      return [];
    }
  }

  /**
   * Emit milestone reached event for SSE clients
   * @param {number} campaignId - Campaign ID
   * @param {Object} campaign - Campaign record
   * @param {number[]} newMilestones - Array of newly reached milestones
   */
  async emitMilestoneEvents(campaignId, campaign, newMilestones) {
    const SseManager = require('./SseManager');
    const { EventEmitter } = require('events');
    
    // Create a local event emitter for campaign milestone events
    const campaignEmitter = new EventEmitter();
    
    for (const milestone of newMilestones) {
      const progressPercentage = Math.round(milestone * 100);
      const data = {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        milestone_percentage: progressPercentage,
        current_amount: campaign.current_amount,
        goal_amount: campaign.goal_amount,
        progress_percentage: Math.round((campaign.current_amount / campaign.goal_amount) * 100),
        timestamp: new Date().toISOString()
      };

      // Emit for in-memory SSE streaming
      campaignEmitter.emit('milestone_reached', data);
      
      // Also broadcast via SseManager if it has campaign progress support
      if (SseManager.broadcastCampaignProgress) {
        SseManager.broadcastCampaignProgress(data);
      }

      log.info('CAMPAIGN', `Milestone ${progressPercentage}% reached for campaign ${campaignId}`, data);
    }

    return campaignEmitter;
  }

  /**
   * Update campaign progress with milestone detection and webhook dispatch
   * @param {number} campaignId - Campaign ID
   * @param {number} amount - Donation amount
   */
  async processCampaignContribution(campaignId, amount) {
    const WebhookService = require('./WebhookService');
    const donationEvents = require('../events/donationEvents');
    
    const updateResult = await Database.run(
      `UPDATE campaigns 
       SET current_amount = current_amount + ? 
       WHERE id = ? AND status = 'active'`,
      [amount, campaignId]
    );

    if (!updateResult || updateResult.changes === 0) {
      log.debug('CAMPAIGN', 'No active campaign found or update had no effect', { campaignId });
      return;
    }

    // Fetch updated campaign
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) {
      log.warn('CAMPAIGN', 'Campaign not found after update', { campaignId });
      return;
    }

    // Check for new milestones
    const reachedMilestones = this.checkMilestones(campaign.current_amount, campaign.goal_amount);
    const notifiedMilestones = this.getNotifiedMilestones(campaign);
    const newMilestones = reachedMilestones.filter(m => !notifiedMilestones.includes(m));

    // Update notified milestones in the database
    if (newMilestones.length > 0) {
      const updatedNotified = [...notifiedMilestones, ...newMilestones];
      
      try {
        await Database.run(
          `UPDATE campaigns 
           SET notified_milestones = ?, last_milestone_notification = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [JSON.stringify(updatedNotified), campaignId]
        );
        
        log.info('CAMPAIGN', `Updated notified milestones for campaign ${campaignId}`, { updatedNotified });
      } catch (err) {
        log.error('CAMPAIGN', 'Failed to update notified_milestones', { campaignId, error: err.message });
      }

      // Emit milestone events for SSE
      try {
        await this.emitMilestoneEvents(campaignId, campaign, newMilestones);
      } catch (err) {
        log.error('CAMPAIGN', 'Failed to emit milestone events', { campaignId, error: err.message });
      }

      // Dispatch webhooks for each new milestone
      for (const milestone of newMilestones) {
        const progressPercentage = Math.round(milestone * 100);
        
        try {
          await WebhookService.deliver('campaign.milestone', {
            campaign_id: campaignId,
            name: campaign.name,
            milestone_percentage: progressPercentage,
            current_amount: campaign.current_amount,
            goal_amount: campaign.goal_amount,
            progress_percentage: Math.round((campaign.current_amount / campaign.goal_amount) * 100),
            timestamp: new Date().toISOString()
          });
          
          log.info('CAMPAIGN', `Webhook dispatched for ${progressPercentage}% milestone`, { campaignId });
        } catch (err) {
          log.error('CAMPAIGN', 'Failed to dispatch milestone webhook', { campaignId, milestone, error: err.message });
        }
      }
    }

    // Check if goal is reached
    if (campaign.current_amount >= campaign.goal_amount && campaign.status === 'active') {
      try {
        // Update campaign status to closed and set closed_at timestamp
        await Database.run(
          `UPDATE campaigns 
           SET status = 'closed', closed_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [campaignId]
        );

        // Emit goal reached event
        try {
          const goalReachedData = {
            campaign_id: campaignId,
            campaign_name: campaign.name,
            goal_amount: campaign.goal_amount,
            final_amount: campaign.current_amount,
            reached_at: new Date().toISOString()
          };
          
          donationEvents.emitLifecycleEvent('campaign.goal_reached', goalReachedData);
        } catch (err) {
          log.error('CAMPAIGN', 'Failed to emit goal reached event', { campaignId, error: err.message });
        }

        // Dispatch goal reached webhook
        await WebhookService.deliver('campaign.goal_reached', {
          campaign_id: campaignId,
          name: campaign.name,
          goal_amount: campaign.goal_amount,
          final_amount: campaign.current_amount,
          reached_at: new Date().toISOString()
        });

        log.info('CAMPAIGN', `Campaign ${campaignId} reached its goal and is now closed`, {
          goalAmount: campaign.goal_amount,
          finalAmount: campaign.current_amount
        });
      } catch (err) {
        log.error('CAMPAIGN', 'Failed to process goal reached', { campaignId, error: err.message });
      }
    }
  }

  /**
   * Process a batch of donations (up to 100).
   * Donations sharing the same donor are grouped into a single multi-operation Stellar transaction.
   * @param {Array<{amount, currency, donor, recipient, memo, idempotencyKey}>} donations
   * @returns {Promise<Array<{index, success, data?, error?}>>}
   */
  async processBatch(donations) {
    // Group by donor (same sender → single multi-op tx)
    const groups = new Map();
    donations.forEach((d, index) => {
      const key = d.donor || 'Anonymous';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...d, index });
    });

    const results = new Array(donations.length);

    await Promise.all([...groups.values()].map(async (group) => {
      // Resolve & validate each donation in the group
      const prepared = [];
      for (const d of group) {
        try {
          const sanitizedDonor = d.donor ? sanitizeIdentifier(d.donor) : 'Anonymous';
          const sanitizedRecipient = sanitizeIdentifier(d.recipient);
          const normalizedCurrency = (d.currency || 'XLM').toUpperCase();
          let xlmAmount = parseFloat(d.amount);

          if (normalizedCurrency !== 'XLM') {
            xlmAmount = await priceOracle.convertToXLM(d.amount, normalizedCurrency);
          }

          this.validateDonationAmount(xlmAmount, sanitizedDonor);
          const memoResult = this.validateAndSanitizeMemo(d.memo);

          prepared.push({ d, sanitizedDonor, sanitizedRecipient, xlmAmount, memo: memoResult.sanitized });
        } catch (err) {
          results[d.index] = { index: d.index, success: false, error: { code: err.code || 'VALIDATION_ERROR', message: err.message } };
        }
      }

      if (prepared.length === 0) return;

      // Attempt multi-op Stellar transaction for the whole group
      try {
        const sender = await this.getUserById(prepared[0].sanitizedDonor, 'Donor').catch(() => null);
        let stellarResult = null;

        if (sender && sender.encryptedSecret) {
          const secret = encryption.decrypt(sender.encryptedSecret);
          const payments = prepared.map(p => ({
            destinationPublic: p.sanitizedRecipient,
            amount: p.xlmAmount.toString(),
            memo: p.memo,
          }));
          stellarResult = await this.stellarService.sendBatchDonations(secret, payments);
        }

        for (const p of prepared) {
          const feeCalc = calculateAnalyticsFee(p.xlmAmount);
          const transaction = Transaction.create({
            amount: p.xlmAmount,
            originalAmount: (p.d.currency || 'XLM').toUpperCase() !== 'XLM' ? p.d.amount : undefined,
            originalCurrency: (p.d.currency || 'XLM').toUpperCase() !== 'XLM' ? (p.d.currency).toUpperCase() : undefined,
            donor: p.sanitizedDonor,
            recipient: p.sanitizedRecipient,
            memo: p.memo,
            idempotencyKey: p.d.idempotencyKey,
            analyticsFee: feeCalc.fee,
            analyticsFeePercentage: feeCalc.feePercentage,
            ...(stellarResult ? { stellarTxId: stellarResult.transactionId, stellarLedger: stellarResult.ledger } : {}),
          });
          results[p.d.index] = { index: p.d.index, success: true, data: transaction };
        }
      } catch (err) {
        for (const p of prepared) {
          results[p.d.index] = { index: p.d.index, success: false, error: { code: err.code || 'TRANSACTION_FAILED', message: err.message } };
        }
      }
    }));

    return results;
  }

  /**
   * Get all donations
   * @returns {Array} Array of transactions
   */
  getAllDonations({ includeDeleted = false } = {}) {
    return Transaction.getAll({ includeDeleted });
  }

  /**
   * Apply search/filter criteria to a list of transactions.
   * All parameters are optional and combinable.
   *
   * @param {Object[]} transactions - Source transaction array.
   * @param {Object} filters - Filter options.
   * @param {string} [filters.startDate] - ISO date string; include transactions on or after this date.
   * @param {string} [filters.endDate] - ISO date string; include transactions on or before this date.
   * @param {number} [filters.minAmount] - Minimum donation amount (inclusive).
   * @param {number} [filters.maxAmount] - Maximum donation amount (inclusive).
   * @param {string} [filters.status] - Exact status match.
   * @param {string} [filters.donor] - Case-insensitive substring match on donor field.
   * @param {string} [filters.recipient] - Case-insensitive substring match on recipient field.
   * @param {string} [filters.memo] - Case-insensitive full-text search on memo field.
   * @param {string} [filters.sortBy='timestamp'] - Field to sort by: 'timestamp', 'amount', or 'status'.
   * @param {string} [filters.order='desc'] - Sort order: 'asc' or 'desc'.
   * @returns {Object[]} Filtered and sorted transactions.
   */
  applyFilters(transactions, filters = {}) {
    const {
      startDate, endDate,
      minAmount, maxAmount,
      status, donor, recipient, memo,
      sortBy = 'timestamp', order = 'desc',
    } = filters;

    const VALID_SORT_FIELDS = ['timestamp', 'amount', 'status'];
    const VALID_ORDERS = ['asc', 'desc'];

    if (sortBy && !VALID_SORT_FIELDS.includes(sortBy)) {
      throw new ValidationError(
        `Invalid sortBy value. Must be one of: ${VALID_SORT_FIELDS.join(', ')}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }
    if (order && !VALID_ORDERS.includes(order)) {
      throw new ValidationError(
        `Invalid order value. Must be one of: ${VALID_ORDERS.join(', ')}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    let start = startDate ? new Date(startDate) : null;
    let end = endDate ? new Date(endDate) : null;

    if (start && isNaN(start.getTime())) {
      throw new ValidationError('Invalid startDate', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (end && isNaN(end.getTime())) {
      throw new ValidationError('Invalid endDate', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (start && end && start > end) {
      throw new ValidationError('startDate must not be after endDate', null, ERROR_CODES.INVALID_REQUEST);
    }

    const minAmt = minAmount !== undefined ? parseFloat(minAmount) : null;
    const maxAmt = maxAmount !== undefined ? parseFloat(maxAmount) : null;

    if (minAmt !== null && isNaN(minAmt)) {
      throw new ValidationError('Invalid minAmount', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (maxAmt !== null && isNaN(maxAmt)) {
      throw new ValidationError('Invalid maxAmount', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (minAmt !== null && maxAmt !== null && minAmt > maxAmt) {
      throw new ValidationError('minAmount must not be greater than maxAmount', null, ERROR_CODES.INVALID_REQUEST);
    }

    const donorLower = donor ? donor.toLowerCase() : null;
    const recipientLower = recipient ? recipient.toLowerCase() : null;
    const memoLower = memo ? memo.toLowerCase() : null;

    let result = transactions.filter(tx => {
      if (start && new Date(tx.timestamp) < start) return false;
      if (end && new Date(tx.timestamp) > end) return false;
      if (minAmt !== null && tx.amount < minAmt) return false;
      if (maxAmt !== null && tx.amount > maxAmt) return false;
      if (status && Array.isArray(status) ? !status.includes(tx.status) : (status && tx.status !== status)) return false;
      if (donorLower && !(tx.donor || '').toLowerCase().includes(donorLower)) return false;
      if (recipientLower && !(tx.recipient || '').toLowerCase().includes(recipientLower)) return false;
      if (memoLower && !(tx.memo || '').toLowerCase().includes(memoLower)) return false;
      return true;
    });

    result.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      if (sortBy === 'timestamp') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      } else if (sortBy === 'amount') {
        aVal = Number(aVal);
        bVal = Number(bVal);
      } else {
        aVal = String(aVal || '');
        bVal = String(bVal || '');
      }
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }

  /**
   * Get donations using cursor-based pagination with optional filtering.
   * @param {Object} pagination - Pagination options.
   * @param {{ timestamp: string, id: string }|null} pagination.cursor - Decoded cursor.
   * @param {number} pagination.limit - Page size.
   * @param {string} pagination.direction - Pagination direction.
   * @param {Object} [filters={}] - Filter/search options (see applyFilters).
   * @returns {{ data: Array, totalCount: number, meta: Object, appliedFilters: Object }} Paginated donations.
   */
  getPaginatedDonations(pagination, filters = {}) {
    const sortBy = filters.sortBy || 'timestamp';
    const order = filters.order || 'desc';
    const useCustomSort = sortBy !== 'timestamp' || order !== 'desc';
    
    // Get all transactions and apply filters
    const filteredTransactions = this.applyFilters(Transaction.getAll(), filters);
    
    // Get total count before pagination
    const totalCount = filteredTransactions.length;

    // Use cursor-based pagination with proper database semantics
    let result = paginateCollection(filteredTransactions, {
      ...pagination,
      timestampField: 'timestamp',
      idField: 'id',
    });

    if (useCustomSort) {
      result = {
        ...result,
        data: this.applyFilters(result.data, { sortBy, order }),
      };
    }

    const appliedFilters = {};
    for (const [key, val] of Object.entries(filters)) {
      if (val !== undefined && val !== null && val !== '') {
        appliedFilters[key] = val;
      }
    }

    return {
      ...result,
      totalCount,
      appliedFilters,
      resultCount: result.totalCount,
    };
  }

  _validateTags(tags, apiKeyRole) {
    if (!tags || !Array.isArray(tags)) return;
    for (const tag of tags) {
      if (!PREDEFINED_TAGS.includes(tag)) {
        if (apiKeyRole !== 'premium' && apiKeyRole !== 'admin') {
          throw new ValidationError(`Custom tags are only allowed for premium or admin accounts. Invalid tag: ${tag}`);
        }
      }
    }
  }

  /**
   * Get recent donations with limit.
   * Anonymous donations are included but their donor field shows the pseudonymous ID,
   * so they are naturally excluded from any real-identity leaderboard.
   * @param {number} limit - Maximum number of donations to return
   * @param {Object} [options]
   * @param {boolean} [options.excludeAnonymous=false] - When true, omit anonymous donations entirely (e.g. for public leaderboards)
   * @returns {Array} Array of sanitized transactions
   */
  getRecentDonations(limit = 10, { excludeAnonymous = false } = {}) {
    let transactions = Transaction.getAll();

    // Exclude anonymous donations when building public leaderboards
    if (excludeAnonymous) {
      transactions = transactions.filter(tx => !tx.anonymous);
    }

    // Sort by timestamp descending (most recent first)
    const sortedTransactions = transactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Remove sensitive data; anonymous donations expose pseudonymousId instead of real donor
    return sortedTransactions.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      donor: tx.anonymous ? tx.pseudonymousId : tx.donor,
      recipient: tx.recipient,
      timestamp: tx.timestamp,
      status: tx.status,
      anonymous: tx.anonymous || false,
    }));
  }

  /**
   * Verify that a wallet address corresponds to an anonymous donation.
   *
   * Allows a donor to prove ownership of an anonymous donation without
   * revealing their wallet address publicly. The donor provides their wallet
   * address privately; this method checks it against the stored pseudonymous ID.
   *
   * @param {string} donationId    - The ID of the anonymous donation to verify.
   * @param {string} walletAddress - The donor's wallet address to verify against.
   * @returns {{ verified: boolean, donationId: string, pseudonymousId: string, amount: number, recipient: string, timestamp: string }}
   * @throws {NotFoundError}   If the donation does not exist.
   * @throws {ValidationError} If the donation is not anonymous or inputs are invalid.
   */
  verifyAnonymousDonation(donationId, walletAddress) {
    const { verifyPseudonymousId } = require('../utils/anonymization');

    if (!donationId || typeof donationId !== 'string') {
      throw new ValidationError('donationId is required', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new ValidationError('walletAddress is required', null, ERROR_CODES.INVALID_REQUEST);
    }

    const donation = this.getDonationById(donationId);

    if (!donation.anonymous) {
      throw new ValidationError(
        'This donation is not anonymous and does not require pseudonymous verification',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const verified = verifyPseudonymousId(walletAddress, donation.pseudonymousId);

    return {
      verified,
      donationId: donation.id,
      pseudonymousId: donation.pseudonymousId,
      amount: donation.amount,
      recipient: donation.recipient,
      timestamp: donation.timestamp,
    };
  }

  /**
   * Get the public leaderboard — top donors by total donated amount.
   * Anonymous donations are excluded so that pseudonymous IDs do not appear
   * in public rankings.
   *
   * @param {number} [limit=10] - Maximum number of donors to return.
   * @returns {Array<{ donor: string, totalDonated: number, donationCount: number }>}
   */
  getLeaderboard(limit = 10) {
    const transactions = Transaction.getAll();

    // Exclude anonymous donations from the public leaderboard
    const publicTransactions = transactions.filter(tx => !tx.anonymous);

    const donorMap = new Map();
    for (const tx of publicTransactions) {
      const key = tx.donor || 'Anonymous';
      if (!donorMap.has(key)) {
        donorMap.set(key, { donor: key, totalDonated: 0, donationCount: 0 });
      }
      const entry = donorMap.get(key);
      entry.totalDonated += parseFloat(tx.amount) || 0;
      entry.donationCount += 1;
    }

    return Array.from(donorMap.values())
      .sort((a, b) => b.totalDonated - a.totalDonated)
      .slice(0, limit)
      .map(d => ({ ...d, totalDonated: +d.totalDonated.toFixed(7) }));
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
    const { assertValidState, assertValidTransition, normalizeState } = require('../utils/transactionStateMachine');
    
    // Normalize and validate the new status
    const normalizedStatus = normalizeState(status);
    assertValidState(normalizedStatus, 'status');

    // Get current donation to check state transition
    const currentDonation = this.getDonationById(id);
    const currentStatus = normalizeState(currentDonation.status);

    // Validate state transition
    assertValidTransition(currentStatus, normalizedStatus);

    const updateData = { ...stellarData };
    if (normalizedStatus === 'confirmed') {
      updateData.confirmedAt = new Date().toISOString();
    }

    const updated = Transaction.updateStatus(id, normalizedStatus, updateData);

    // Emit donation lifecycle event for SSE subscribers and other listeners
    const eventMap = {
      submitted: donationEvents.constructor.EVENTS?.SUBMITTED || 'donation.submitted',
      confirmed: donationEvents.constructor.EVENTS?.CONFIRMED || 'donation.confirmed',
      failed: donationEvents.constructor.EVENTS?.FAILED || 'donation.failed',
    };
    const eventName = eventMap[normalizedStatus];
    if (eventName) {
      donationEvents.emitLifecycleEvent(eventName, {
        donationId: updated.id,
        status: normalizedStatus,
        txHash: updated.stellar_tx_id || stellarData.transactionId,
        ledger: updated.ledger || stellarData.ledger,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
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

  /**
   * Refund a confirmed donation by creating a reverse Stellar transaction
   * @param {string} donationId - ID of the donation to refund
   * @param {Object} params - Refund parameters
   * @param {string} params.reason - Reason for refund
   * @param {string} params.requestId - Request ID for logging
   * @returns {Promise<Object>} Refund result with reverse transaction details
   * @throws {NotFoundError} If donation not found
   * @throws {ValidationError} If donation is not eligible for refund
   * @throws {BusinessLogicError} If refund fails
   */
  async refundDonation(donationId, { reason, notes, idempotencyKey, recipientSecret, requestId }) {
    const StellarSdk = require('stellar-sdk');
    const { BusinessLogicError, DuplicateError, ValidationError } = require('../utils/errors');
    const AuditLogService = require('./AuditLogService');
    const WebhookService = require('./WebhookService');

    log.debug('DONATION_SERVICE', 'Processing refund request', {
      requestId,
      donationId,
      reason
    });

    // Get the original donation
    const donation = this.getDonationById(donationId);

    // Idempotency: if idempotencyKey provided, check for existing refund with same key
    if (idempotencyKey) {
      const existing = await Database.get(
        `SELECT * FROM refunds WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey]
      ).catch(() => null);
      if (existing) {
        return {
          refundId: existing.id,
          originalDonationId: donationId,
          reverseTxId: existing.reverse_transaction_id,
          amount: existing.amount,
          reason: existing.reason,
          refundedAt: existing.refunded_at,
          status: existing.status,
          alreadyProcessed: true,
        };
      }
    }

    // Double-refund prevention: check if donation is already refunded
    if (donation.status === 'refunded') {
      throw new DuplicateError(
        'Donation has already been refunded',
        ERROR_CODES.DUPLICATE_DONATION
      );
    }

    // Check if donation is in completed/confirmed status
    if (donation.status !== TRANSACTION_STATES.CONFIRMED && donation.status !== 'completed') {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Cannot refund donation with status "${donation.status}". Only completed donations can be refunded.`,
        { donationId, currentStatus: donation.status }
      );
    }

    // Recipient verification: derive public key from recipientSecret and compare to donation.recipient
    if (recipientSecret) {
      let derivedPublicKey;
      try {
        derivedPublicKey = StellarSdk.Keypair.fromSecret(recipientSecret).publicKey();
      } catch {
        throw new ValidationError('recipientSecret is not a valid Stellar secret key');
      }
      if (derivedPublicKey !== donation.recipient) {
        throw new ValidationError('recipientSecret does not match the original donation recipient');
      }
    }

    // Check refund eligibility window (hours-based, default 24)
    const refundWindowHours = parseInt(process.env.REFUND_WINDOW_HOURS || '24', 10);
    const donationTimestamp = new Date(donation.timestamp);
    const hoursSinceDonation = (Date.now() - donationTimestamp.getTime()) / (1000 * 60 * 60);

    if (hoursSinceDonation > refundWindowHours) {
      throw new BusinessLogicError(
        'REFUND_WINDOW_EXPIRED',
        `Refund window has expired. Donations can only be refunded within ${refundWindowHours} hours of creation.`,
        {
          donationId,
          donationDate: donation.timestamp,
          hoursSinceDonation: Math.floor(hoursSinceDonation),
          refundWindowHours
        }
      );
    }

    // Determine the secret key to use for signing the refund transaction.
    let secret;
    if (recipientSecret) {
      secret = recipientSecret;
    } else {
      const sender = await this.getUserById(donation.senderId || 1, 'Sender');
      this.validateSenderSecret(sender);
      secret = encryption.decrypt(sender.encryptedSecret);
    }

    log.debug('DONATION_SERVICE', 'Creating reverse Stellar transaction', {
      requestId,
      donationId,
      amount: donation.amount,
      originalTxId: donation.stellarTxId
    });

    // Record refund as pending before submitting to Stellar
    const pendingRecord = await Database.run(
      `INSERT INTO refunds (
        original_donation_id, reverse_transaction_id, amount, reason, notes,
        idempotency_key, refunded_at, stellar_ledger, status
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [
        donationId,
        `pending_${Date.now()}`,
        donation.amount,
        reason || null,
        notes || null,
        idempotencyKey || null,
        null,
        'pending'
      ]
    );

    // Update status to processing
    await Database.run(`UPDATE refunds SET status = 'processing' WHERE id = ?`, [pendingRecord.id]);

    let reverseResult;
    try {
      reverseResult = await this.stellarService.sendDonation({
        sourceSecret: secret,
        destinationPublic: donation.donor,
        amount: donation.amount,
        memo: `REFUND:${donationId}`
      });
    } catch (stellarErr) {
      await Database.run(`UPDATE refunds SET status = 'failed' WHERE id = ?`, [pendingRecord.id]);
      secret = null;
      throw stellarErr;
    }

    // Immediately discard the secret
    secret = null;

    log.debug('DONATION_SERVICE', 'Reverse transaction successful', {
      requestId,
      reverseTxId: reverseResult.transactionId,
      ledger: reverseResult.ledger
    });

    // Update refund record to completed
    await Database.run(
      `UPDATE refunds SET reverse_transaction_id = ?, stellar_ledger = ?, status = 'completed' WHERE id = ?`,
      [reverseResult.transactionId, reverseResult.ledger, pendingRecord.id]
    );

    // Update original donation status to refunded
    Transaction.updateStatus(donationId, 'refunded', {
      refundId: pendingRecord.id,
      reverseTxId: reverseResult.transactionId,
      reverseLedger: reverseResult.ledger,
      refundedAt: new Date().toISOString()
    });

    // Emit donation.refunded webhook event
    WebhookService.deliver('donation.refunded', {
      donationId,
      refundId: pendingRecord.id,
      amount: donation.amount,
      reverseTxId: reverseResult.transactionId,
      reason: reason || null,
      refundedAt: new Date().toISOString(),
    }).catch(() => {});

    // Log refund in audit trail
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: AuditLogService.ACTION.DONATION_CREATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      requestId,
      resource: `donation:${donationId}`,
      details: {
        operation: 'refund',
        originalDonationId: donationId,
        refundId: pendingRecord.id,
        amount: donation.amount,
        reason,
        reverseTxId: reverseResult.transactionId,
        originalTxId: donation.stellarTxId
      }
    });

    log.info('DONATION_SERVICE', 'Refund processed successfully', {
      requestId,
      donationId,
      refundId: pendingRecord.id,
      reverseTxId: reverseResult.transactionId
    });

    return {
      refundId: pendingRecord.id,
      originalDonationId: donationId,
      reverseTxId: reverseResult.transactionId,
      reverseLedger: reverseResult.ledger,
      amount: donation.amount,
      refundedAmount: donation.amount,
      networkFeeDeducted: 0,
      reason,
      notes: notes || null,
      refundedAt: new Date().toISOString(),
      status: 'completed',
    };
  }
}

module.exports = DonationService;
