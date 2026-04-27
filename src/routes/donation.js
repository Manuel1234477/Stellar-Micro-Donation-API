/**
 * Donation Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for donation operations
 * OWNER: Backend Team
 * DEPENDENCIES: DonationService, middleware (auth, validation, rate limiting)
 * 
 * Thin controllers that orchestrate service calls for donation creation, verification,
 * and status management. All business logic delegated to DonationService.
 */

/**
 * @openapi
 * tags:
 *   - name: Donations
 *     description: Create and manage donations on the Stellar network
 *
 * /donations:
 *   post:
 *     tags: [Donations]
 *     summary: Create a new donation
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [senderSecret, recipientPublicKey, amount]
 *             properties:
 *               senderSecret:
 *                 type: string
 *                 description: Stellar secret key of the sender
 *               recipientPublicKey:
 *                 type: string
 *                 description: Stellar public key of the recipient
 *               amount:
 *                 type: number
 *                 description: Amount in XLM
 *               memo:
 *                 type: string
 *                 description: Optional transaction memo
 *     responses:
 *       201:
 *         description: Donation created successfully
 *         headers:
 *           X-Request-ID:
 *             $ref: '#/components/headers/XRequestID'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *   get:
 *     tags: [Donations]
 *     summary: List all donations
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of results
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *     responses:
 *       200:
 *         description: List of donations
 *       401:
 *         description: Unauthorized
 *
 * /donations/{id}:
 *   get:
 *     tags: [Donations]
 *     summary: Get a specific donation
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Donation details
 *       404:
 *         description: Donation not found
 *
 * /donations/{id}/status:
 *   patch:
 *     tags: [Donations]
 *     summary: Update donation status
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, completed, failed]
 *     responses:
 *       200:
 *         description: Status updated
 *       404:
 *         description: Donation not found
 *
 * /donations/verify:
 *   post:
 *     tags: [Donations]
 *     summary: Verify a transaction on the blockchain
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionHash]
 *             properties:
 *               transactionHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification result
 *
 * /donations/limits:
 *   get:
 *     tags: [Donations]
 *     summary: Get donation amount limits
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Donation limits
 *
 * /donations/recent:
 *   get:
 *     tags: [Donations]
 *     summary: Get recent donations
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Recent donations
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { requireIdempotency, storeIdempotencyResponse } = require('../middleware/idempotency');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { donationRateLimiter, verificationRateLimiter, batchRateLimiter } = require('../middleware/rateLimiter');
const { validateRequiredFields, validateFloat, validateInteger } = require('../utils/validationHelpers');
const { validateSchema } = require('../middleware/schemaValidation');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { parseAssetInput } = require('../utils/stellarAsset');

const asyncHandler = require('../utils/asyncHandler');
const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const { calculateCostBreakdown } = require('../utils/costBreakdown');
const LimitService = require('../services/LimitService');

const Transaction = require('./models/transaction');
const donationValidator = require('../utils/donationValidator');
const { buildErrorResponse } = require('../utils/validationErrorFormatter');
const donationEvents = require('../events/donationEvents');

const donationService = new DonationService(getStellarService());

const donationIdParamSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

const updateDonationStatusSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  },
  body: {
    fields: {
      status: { type: 'string', required: true, enum: ['pending', 'submitted', 'confirmed', 'failed'] }
    }
  }
});

/**
 * GET /donations/cost-breakdown
 * Return an itemized cost breakdown for a proposed donation.
 *
 * Query parameters:
 *   @param {string}  amount              - Donation amount in XLM (required, > 0)
 *   @param {string}  [sender]            - Sender public key (optional, for future balance checks)
 *   @param {number}  [surgeFeeMultiplier=1]    - Surge fee multiplier (>= 1)
 *   @param {number}  [xlmUsdRate=0]      - Current XLM/USD rate for USD equivalents
 *
 * Platform fee is read from PLATFORM_FEE_PERCENT env variable (default 0).
 *
 * @access donations:read
 */
router.get('/cost-breakdown', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { amount, surgeFeeMultiplier, xlmUsdRate } = req.query;

    if (!amount) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_AMOUNT', receivedValue: amount }])
      );
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid amount: ${amountValidation.error}`,
      });
    }

    // Read platform fee from env (default 0, max 100)
    const platformFeePercent = Math.min(
      Math.max(parseFloat(process.env.PLATFORM_FEE_PERCENT || '0') || 0, 0),
      100
    );

    const surgeMultiplier = surgeFeeMultiplier
      ? Math.max(parseFloat(surgeFeeMultiplier) || 1, 1)
      : 1;

    const usdRate = xlmUsdRate ? parseFloat(xlmUsdRate) || 0 : 0;

    const breakdown = calculateCostBreakdown({
      amount: amountValidation.value,
      surgeFeeMultiplier: surgeMultiplier,
      platformFeePercent,
      xlmUsdRate: usdRate,
    });

    return res.json({ success: true, data: breakdown });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/:id/receipt
 * Generate and return a PDF receipt for a confirmed donation.
 */
router.get('/:id/receipt', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const ReceiptService = require('../services/ReceiptService');
    const transaction = donationService.getDonationById(req.params.id);

    const pdf = await ReceiptService.generatePDF(transaction);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${transaction.id}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /donations/:id/receipt/email
 * Send a PDF receipt to the provided email address.
 * Body: { email: string }
 */
router.post('/:id/receipt/email', requireApiKey, donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const ReceiptService = require('../services/ReceiptService');
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: { message: 'email is required' } });
    }

    const idempotencyKey = req.get('X-Idempotency-Key');
    if (!idempotencyKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_IDEMPOTENCY_KEY', receivedValue: undefined }])
      );
    }
    const transaction = Transaction.getById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: { message: 'Donation not found' } });
    }
    await ReceiptService.sendEmail(transaction, email);
    return res.json({ success: true, message: 'Receipt sent' });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id/memo/decrypt
 * Decrypt an encrypted memo for a specific donation.
 *
 * Only the recipient (holder of the Stellar private key) can decrypt the memo.
 * The caller must supply their Stellar secret key as a query parameter.
 *
 * Query params:
 *   - recipientSecret {string} Stellar S... secret key of the recipient
 *
 * Security note: In production, memo decryption should be performed client-side
 * so that private keys never leave the user's device. This endpoint is provided
 * for server-side integrations and testing only.
 */
router.get('/:id/memo/decrypt', requireApiKey, donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { recipientSecret } = req.query;

    const transaction = Transaction.getById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Donation ${id} not found` }
      });
    }

    if (!recipientSecret) {
      return res.status(400).json({ success: false, error: { message: 'recipientSecret is required' } });
    }

    const MemoEncryptionService = require('../services/MemoEncryptionService');
    const decrypted = await MemoEncryptionService.decrypt(transaction.memo, recipientSecret);
    return res.json({ success: true, data: { memo: decrypted } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id/certificate
 * Return the NFT donation certificate details for a specific donation.
 * Returns 404 if the donation is not found or has no minted certificate.
 */
router.get('/:id/certificate', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, (req, res, next) => {
  try {
    const transaction = Transaction.getById(req.params.id);

    if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'SAME_SENDER_RECIPIENT', receivedValue: recipient }])
      );
    }

    if (!transaction.nft_asset_code) {
      return res.status(404).json({
        success: false,
        error: { code: 'CERTIFICATE_NOT_FOUND', message: 'No NFT certificate has been minted for this donation' },
      });
    }

    if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

    res.json({
      success: true,
      data: {
        donationId: transaction.id,
        nftAssetCode: transaction.nft_asset_code,
        nftIssuer: transaction.nft_issuer,
        nftTxHash: transaction.nft_tx_hash,
        nftMintedAt: transaction.nft_minted_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /donations
 * Create a new donation.
 * Requires Idempotency-Key header (UUID v4) to prevent duplicate donations from network retries.
 */
router.post('/', donationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_CREATE), requireIdempotency, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { senderId, receiverId, amount, memo } = req.body;

    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: senderId, receiverId, amount'
      });
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({ success: false, error: `Invalid amount: ${amountValidation.error}` });
    }

    // Validate memo byte length per Stellar MEMO_TEXT spec (max 28 bytes)
    if (memo !== undefined && memo !== null && memo !== '') {
      const MemoValidator = require('../utils/memoValidator');
      const memoValidation = MemoValidator.validate(memo);
      if (!memoValidation.valid) {
        return res.status(400).json({ success: false, error: 'Memo text must be 28 bytes or less' });
      }
    }

    const result = await donationService.sendCustodialDonation({
      senderId,
      receiverId,
      amount: amountValidation.value,
      memo: memo || null,
      idempotencyKey: req.idempotency && req.idempotency.key,
      requestId: req.id,
    });

    const response = { success: true, data: result };
    await storeIdempotencyResponse(req, response);

    return res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations
 * List all donations with optional pagination.
 */
router.get('/', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const pagination = parseCursorPaginationQuery(req.query);
    const result = donationService.getPaginatedDonations(pagination);
    res.setHeader('X-Total-Count', String(result.totalCount));
    res.json({ success: true, data: result.data, count: result.data.length, meta: result.meta });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/recent
 * Get recent donations, ordered by creation date descending.
 * Must be registered before /:id to prevent Express matching "recent" as an id.
 *
 * Query params:
 *   - limit {integer} max results to return (default 10, max 100)
 */
router.get('/recent', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const Database = require('../utils/database');
    const rows = await Database.query(
      `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /donations/verify
 * Verify a transaction on the Stellar blockchain.
 * Non-admin callers must provide their walletAddress and be the sender or recipient.
 */
router.post('/verify', verificationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { transactionHash, walletAddress } = req.body;

    if (!transactionHash) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FIELD', message: 'transactionHash is required' } });
    }

    const result = await donationService.verifyTransaction(transactionHash);

    // Admins can verify any transaction; non-admins must own it
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      if (!walletAddress) {
        return res.status(400).json({ success: false, error: { code: 'MISSING_FIELD', message: 'walletAddress is required' } });
      }
      const tx = result.transaction;
      const isOwner = tx && (tx.source === walletAddress || tx.destination === walletAddress);
      if (!isOwner) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not authorized to verify this transaction' } });
      }
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id/status
 * Server-Sent Events (SSE) endpoint for real-time donation status updates.
 * Opens a long-lived HTTP connection and pushes status_update events as the
 * donation progresses through its lifecycle (pending → processing → completed/failed).
 *
 * Authentication: Requires API key
 * Authorization: Users may only stream their own donations; admins may stream any donation
 * Auto-close: Connection closes when donation reaches terminal state (completed/failed)
 * Timeout: Connection closes after 5 minutes regardless of state
 * Keepalive: Sends comment every 15 seconds to prevent proxy timeouts
 * Reconnection: Instructs clients to reconnect after 3 seconds if connection drops
 */
router.get('/:id/status', requireApiKey, donationIdParamSchema, asyncHandler(async (req, res, next) => {
  const donationId = req.params.id;

  try {
    // Fetch donation to verify it exists and check authorization
    const donation = donationService.getDonationById(donationId);

    // Authorization: users can only stream their own donations, admins can stream any
    const isAdmin = req.apiKey?.role === 'admin';
    const userOwns = donation.senderId === req.apiKey?.id || donation.receiverId === req.apiKey?.id;
    if (!isAdmin && !userOwns) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to stream this donation' },
      });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send retry directive (3 seconds)
    res.write('retry: 3000\n\n');

    // Send initial status_update event
    const sendStatusUpdate = (status, txHash, ledger) => {
      const event = {
        donationId: donation.id,
        status,
        timestamp: new Date().toISOString(),
      };
      if (txHash) event.txHash = txHash;
      if (ledger) event.ledger = ledger;
      res.write(`event: status_update\ndata: ${JSON.stringify(event)}\n\n`);
    };

    sendStatusUpdate(donation.status, donation.stellar_tx_id, donation.ledger);

    // If already in terminal state, close immediately
    if (donation.status === 'confirmed' || donation.status === 'failed') {
      res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'terminal_state', finalStatus: donation.status })}\n\n`);
      res.end();
      return;
    }

    // Keepalive interval (15 seconds)
    const keepaliveInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    // 5-minute timeout
    const timeoutMs = 5 * 60 * 1000;
    const timeoutTimer = setTimeout(() => {
      res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'timeout', finalStatus: donation.status })}\n\n`);
      res.end();
    }, timeoutMs);

    // Listen for donation status updates
    const statusUpdateHandler = (payload) => {
      if (payload.donationId === donation.id) {
        sendStatusUpdate(payload.status, payload.txHash, payload.ledger);

        // Close connection on terminal state (confirmed = completed in this system)
        if (payload.status === 'confirmed' || payload.status === 'failed') {
          res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'terminal_state', finalStatus: payload.status })}\n\n`);
          res.end();
        }
      }
    };

    donationEvents.on('donation.submitted', statusUpdateHandler);
    donationEvents.on('donation.confirmed', statusUpdateHandler);
    donationEvents.on('donation.failed', statusUpdateHandler);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(keepaliveInterval);
      clearTimeout(timeoutTimer);
      donationEvents.off('donation.submitted', statusUpdateHandler);
      donationEvents.off('donation.confirmed', statusUpdateHandler);
      donationEvents.off('donation.failed', statusUpdateHandler);
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, (req, res, next) => {
  try {
    const transaction = donationService.getDonationById(req.params.id);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    // ETag and conditional request support (#751)
    const lastModifiedDate = new Date(transaction.statusUpdatedAt || transaction.timestamp);
    const etag = `"${transaction.id}-${lastModifiedDate.getTime()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModifiedDate.toUTCString());
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    if (req.headers['if-modified-since']) {
      const ifModifiedSince = new Date(req.headers['if-modified-since']);
      if (!isNaN(ifModifiedSince.getTime()) && lastModifiedDate <= ifModifiedSince) {
        return res.status(304).end();
      }
    }

    // HTTP/2 server push + Link header for related resources
    const { pushDonationRelated } = require('../utils/pushHelper');
    pushDonationRelated(req, res, transaction);

    res.json({
      success: true,
      data: applyNotePrivacy(req, transaction)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', checkPermission(PERMISSIONS.DONATIONS_UPDATE), updateDonationStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger, notes, tags } = req.body;

    if (!status) {
      throw new ValidationError('Missing required field: status', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const stellarData = {};
    if (stellarTxId) stellarData.transactionId = stellarTxId;
    if (ledger) stellarData.ledger = ledger;
    if (notes !== undefined) stellarData.notes = notes;
    if (tags !== undefined) stellarData.tags = tags;

    const updatedTransaction = donationService.updateDonationStatus(id, status, stellarData);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: applyNotePrivacy(req, updatedTransaction)
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /donations/:id/refund
 * Initiate a refund for a confirmed donation
 * Requires admin or refund permission
 */
router.post('/:id/refund', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    log.debug('DONATION_ROUTE', 'Processing refund request', {
      requestId: req.id,
      donationId: id,
      reason
    });

    // Validate donation ID
    if (!id || isNaN(parseInt(id, 10))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid donation ID'
        }
      });
    }

    // Process refund
    const refundResult = await donationService.refundDonation(id, {
      reason: reason || null,
      requestId: req.id
    });

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.status(201).json({
      success: true,
      data: refundResult
    });
  } catch (error) {
    log.error('DONATION_ROUTE', 'Failed to process refund', {
      requestId: req.id,
      error: error.message,
      stack: error.stack
    });

    next(error);
  }
}));

// ─── Claimable Balance Endpoints ─────────────────────────────────────────────

const createClaimableSchema = validateSchema({
  body: {
    fields: {
      signedXDR: { type: 'string', required: true },
      amount: { type: 'numberString', required: true, min: 0.0000001 },
      claimants: { type: 'array', required: true },
      predicate: { type: 'object', required: false, nullable: true },
    },
  },
});

/**
 * POST /donations/claimable
 * Create a claimable balance (XLM held until claimed by an eligible account).
 * The transaction must be signed client-side and submitted as a pre-signed XDR envelope.
 */
router.post(
  '/claimable',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  createClaimableSchema,
  asyncHandler(async (req, res, next) => {
    try {
      const { signedXDR, amount, claimants, predicate } = req.body;

      if (!Array.isArray(claimants) || claimants.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'claimants must be a non-empty array' },
        });
      }

      const result = await stellarService.submitSignedTransaction(signedXDR);

      // Store claimable balance ID in transaction records
      Transaction.create({
        amount: parseFloat(amount),
        donor: claimants[0] && claimants[0].destination,
        recipient: claimants.map(c => c.destination).join(','),
        status: 'pending',
        stellarTxId: result.transactionId,
        stellarLedger: result.ledger,
        balanceId: result.balanceId,
        type: 'claimable',
      });

      if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  })
);

/**
 * POST /donations/claimable/:id/claim
 * Claim a claimable balance by its ID.
 * The claim transaction must be signed client-side and submitted as a pre-signed XDR envelope.
 */
router.post(
  '/claimable/:id/claim',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const { signedXDR } = req.body;

      if (!signedXDR) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'signedXDR is required' },
        });
      }

      const result = await stellarService.submitSignedTransaction(signedXDR);

      if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  })
);

/**
 * GET /donations/:id/impact
 * Calculate the real-world impact of a specific donation based on its campaign's impact metrics.
 *
 * Returns an array of impact breakdowns per metric (e.g. "5 meals delivered").
 * Returns an empty impact array if the donation has no campaign_id or no metrics are defined.
 */
router.get('/:id/impact', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const ImpactMetricService = require('../services/ImpactMetricService');
    const transaction = donationService.getDonationById(req.params.id);

    if (!transaction.campaign_id) {
      return res.json({
        success: true,
        data: {
          donation_id: transaction.id,
          amount: transaction.amount,
          campaign_id: null,
          impact: [],
          message: 'No campaign associated with this donation',
        },
      });
    }

    const impact = await ImpactMetricService.calculateDonationImpact(
      parseFloat(transaction.amount),
      transaction.campaign_id
    );

    res.json({
      success: true,
      data: {
        donation_id: transaction.id,
        amount: transaction.amount,
        campaign_id: transaction.campaign_id,
        impact,
      },
    });
  } catch (error) {
    next(error);
  }
}));

// ─── Cross-Asset Donations ────────────────────────────────────────────────────

const crossAssetSchema = validateSchema({
  body: {
    fields: {
      signedXDR: { type: 'string', required: true },
      sendAsset: { types: ['string', 'object'], required: true },
      destPublicKey: { type: 'string', required: true },
      destAsset: { types: ['string', 'object'], required: true },
      slippageTolerance: { type: 'number', required: false },
      memo: { type: 'string', required: false, maxLength: 255, nullable: true },
    },
    validate: (body) => {
      if (body.sendAmount === undefined && body.destAmount === undefined) {
        return 'Either sendAmount or destAmount is required';
      }
      if (body.sendAmount !== undefined && body.destAmount !== undefined) {
        return 'Provide either sendAmount (strict-send) or destAmount (strict-receive), not both';
      }
      const tol = body.slippageTolerance;
      if (tol !== undefined && (typeof tol !== 'number' || tol < 0 || tol > 1)) {
        return 'slippageTolerance must be a number between 0 and 1';
      }
      return null;
    },
  },
});

const crossAssetPathsSchema = validateSchema({
  query: {
    fields: {
      sourcePublicKey: { type: 'string', required: true },
      destPublicKey: { type: 'string', required: true },
      destAsset: { type: 'string', required: true },
      destAmount: { type: 'numberString', required: true },
    },
  },
});

/**
 * POST /donations/cross-asset
 * Execute a cross-asset donation via Stellar DEX path payment.
 *
 * The transaction must be built and signed client-side, then submitted as a
 * pre-signed XDR envelope. Use GET /donations/cross-asset/paths to discover
 * available conversion paths before building the transaction.
 *
 * Body:
 *   - signedXDR {string} required — pre-signed transaction XDR envelope
 *   - sendAsset {string|object} required — "native" or {code, issuer}
 *   - sendAmount {string} — for strict-send
 *   - destPublicKey {string} required
 *   - destAsset {string|object} required
 *   - destAmount {string} — for strict-receive
 *   - slippageTolerance {number} optional, 0–1, default 0.01 (1%)
 *   - memo {string} optional
 */
router.post('/cross-asset', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, requireApiKey, requireIdempotency, crossAssetSchema, asyncHandler(async (req, res, next) => {
  try {
    const {
      signedXDR,
      destPublicKey,
    } = req.body;

    if (!signedXDR || !destPublicKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_REQUIRED_FIELDS', receivedValue: null }])
      );
    }

    const stellarService = getStellarService();

    const result = await stellarService.submitSignedTransaction(signedXDR);

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/cross-asset/paths
 * Preview available DEX conversion paths before committing to a cross-asset donation.
 *
 * Query params:
 *   - sourcePublicKey {string} required
 *   - destPublicKey {string} required
 *   - destAsset {string} required — "native" or JSON {code, issuer}
 *   - destAmount {string} required
 */
router.get('/cross-asset/paths', requireApiKey, crossAssetPathsSchema, asyncHandler(async (req, res, next) => {
  try {
    const { sourcePublicKey, destPublicKey, destAsset: rawDestAsset, destAmount } = req.query;

    const destAsset = parseAssetInput(rawDestAsset, 'destAsset');
    const paths = await stellarService.findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount);

    if (paths.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_PATH_FOUND', message: 'No conversion paths found for the specified assets and amount' },
      });
    }

    return res.status(200).json({ success: true, data: { paths } });
  } catch (error) {
    next(error);
  }
}));

// ─── IPFS Certificate ─────────────────────────────────────────────────────────

const { pinCertificate, GATEWAY_URL } = require('../utils/ipfs');
const Database = require('../utils/database');

/**
 * GET /donations/:id/certificate/ipfs
 * Returns the IPFS gateway URL for a donation's impact certificate.
 * If no CID is stored yet, pins the certificate on demand.
 */
router.get('/:id/certificate/ipfs', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const donationId = parseInt(req.params.id, 10);
    const tx = await Database.get('SELECT * FROM transactions WHERE id = ?', [donationId]);
    if (!tx) {
      const { NotFoundError } = require('../utils/errors');
      throw new NotFoundError(`Donation ${donationId} not found`);
    }

    let cid = tx.ipfs_cid;
    let pinned = !!cid;

    if (!cid) {
      // Pin on demand
      const result = await pinCertificate({
        id: tx.id,
        senderPublicKey: tx.senderPublicKey || String(tx.senderId),
        receiverPublicKey: tx.receiverPublicKey || String(tx.receiverId),
        amount: tx.amount,
        memo: tx.memo,
        timestamp: tx.timestamp,
      });
      cid = result.cid;
      pinned = result.pinned;
      await Database.run('UPDATE transactions SET ipfs_cid = ? WHERE id = ?', [cid, donationId]);
    }

    return res.json({
      success: true,
      data: { donationId, cid, gateway: `${GATEWAY_URL}/${cid}`, pinned },
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
