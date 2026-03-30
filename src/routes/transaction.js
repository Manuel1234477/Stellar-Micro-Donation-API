/**
 * Transaction Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for transaction queries and synchronization
 * OWNER: Backend Team
 * DEPENDENCIES: Transaction model, TransactionSyncService, middleware (auth, RBAC)
 * 
 * Handles transaction listing with pagination and blockchain synchronization operations.
 * Provides endpoints for querying transaction history and syncing with Stellar network.
 */

/**
 * @openapi
 * tags:
 *   - name: Transactions
 *     description: Transaction history and synchronization
 *
 * /transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: Get paginated transactions
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated transaction list
 *
 * /transactions/sync:
 *   post:
 *     tags: [Transactions]
 *     summary: Sync wallet transactions from Stellar network
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicKey]
 *             properties:
 *               publicKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Sync completed
 *
 * /transactions/multisig:
 *   post:
 *     tags: [Transactions]
 *     summary: Create a pending multi-sig transaction
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction_xdr, network_passphrase, required_signers, signer_keys]
 *             properties:
 *               transaction_xdr:
 *                 type: string
 *               network_passphrase:
 *                 type: string
 *               required_signers:
 *                 type: integer
 *                 minimum: 2
 *               signer_keys:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Multi-sig transaction created
 *
 * /transactions/multisig/collect:
 *   post:
 *     tags: [Transactions]
 *     summary: Collect a signature for a pending multi-sig transaction
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, signer, signed_xdr]
 *             properties:
 *               id:
 *                 type: integer
 *               signer:
 *                 type: string
 *               signed_xdr:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signature collected; submitted if threshold met
 *       400:
 *         description: Insufficient signatures
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       example: INSUFFICIENT_SIGNATURES
 *                     required:
 *                       type: integer
 *                     collected:
 *                       type: integer
 *                     remaining:
 *                       type: integer
 */

const express = require('express');
const router = express.Router();
const Transaction = require('../models/transaction');
const TransactionSyncService = require('../services/TransactionSyncService');
const MultiSigService = require('../services/MultiSigService');
const { buildErrorResponse } = require('../utils/validationErrorFormatter');
const sseManager = require('../services/SseManager');
const serviceContainer = require('../config/serviceContainer');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { payloadSizeLimiter } = require('../middleware/payloadSizeLimiter');
const { ENDPOINT_LIMITS } = require('../constants');
const { validateSchema } = require('../middleware/schemaValidation');

const multiSigService = new MultiSigService(serviceContainer.getStellarService());

const transactionListQuerySchema = validateSchema({
  query: {
    fields: {
      limit: {
        type: 'integerString',
        required: false,
        validate: (value) => {
          const parsed = Number(value);
          return parsed >= 1 && parsed <= 100
            ? true
            : 'limit must be an integer between 1 and 100';
        },
      },
      offset: {
        type: 'integerString',
        required: false,
        validate: (value) => {
          const parsed = Number(value);
          return parsed >= 0 ? true : 'offset must be a non-negative integer';
        },
      },
    },
  },
});

const transactionSyncBodySchema = validateSchema({
  body: {
    fields: {
      publicKey: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
      },
    },
  },
});

router.get('/', checkPermission(PERMISSIONS.TRANSACTIONS_READ), transactionListQuerySchema, async (req, res, next) => {
  try {
    const { limit = 10, offset = 0 } = req.query;

    
    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'INVALID_LIMIT', receivedValue: req.query.limit }])
      );
    }

    if (isNaN(offset) || offset < 0) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'INVALID_OFFSET', receivedValue: req.query.offset }])
      );
    }

    const result = Transaction.getPaginated({
      limit: paginationValidation.limit,
      offset: paginationValidation.offset
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    next(error);
  }
});

router.post(
  "/sync",
  payloadSizeLimiter(ENDPOINT_LIMITS.transaction),
  checkPermission(PERMISSIONS.TRANSACTIONS_SYNC),
  transactionSyncBodySchema,
  async (req, res, next) => {
    try {
      const { publicKey } = req.body;

      if (!publicKey) {
        return res.status(400).json(
          buildErrorResponse([{ code: 'MISSING_PUBLIC_KEY', receivedValue: publicKey }])
        );
      }

      const syncService = new TransactionSyncService(serviceContainer.getStellarService());
      const result = await syncService.syncWalletTransactions(publicKey);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);


// ─── Multi-Signature Transaction Endpoints ───────────────────────────────────

/**
 * POST /transactions/multisig
 * Create a new pending multi-sig transaction.
 */
router.post(
  '/multisig',
  checkPermission(PERMISSIONS.TRANSACTIONS_SYNC),
  async (req, res, next) => {
    try {
      const { transaction_xdr, network_passphrase, required_signers, signer_keys, metadata } = req.body;
      const tx = await multiSigService.createMultiSigTransaction({
        transaction_xdr,
        network_passphrase,
        required_signers,
        signer_keys,
        metadata,
      });
      return res.status(201).json({ success: true, data: tx });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /transactions/multisig/collect
 * Collect a signature for a pending multi-sig transaction.
 * Automatically submits to the network when the required threshold is met.
 * Returns 400 with required vs collected counts when threshold is not yet met.
 */
router.post(
  '/multisig/collect',
  checkPermission(PERMISSIONS.TRANSACTIONS_SYNC),
  async (req, res, next) => {
    try {
      const { id, signer, signed_xdr } = req.body;

      if (!id || !Number.isInteger(Number(id))) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'id is required and must be an integer' } });
      }
      if (!signer) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'signer is required' } });
      }
      if (!signed_xdr) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'signed_xdr is required' } });
      }

      const tx = await multiSigService.addSignature(Number(id), signer, signed_xdr);

      const collected = tx.collected_signatures ? tx.collected_signatures.length : 0;
      const required = tx.required_signers;
      const thresholdMet = collected >= required;

      if (!thresholdMet && tx.status === 'pending') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_SIGNATURES',
            message: 'Threshold not yet met',
            required,
            collected,
            remaining: required - collected,
          },
          data: tx,
        });
      }

      return res.status(200).json({ success: true, data: tx });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /transactions/:id/sign
 * Add a signature to a pending multi-sig transaction.
 * Auto-submits when the required threshold is met.
 */
router.post(
  '/:id/sign',
  checkPermission(PERMISSIONS.TRANSACTIONS_SYNC),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'id must be an integer' } });
      }
      const { signer, signed_xdr } = req.body;
      const tx = await multiSigService.addSignature(id, signer, signed_xdr);
      return res.status(200).json({ success: true, data: tx });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /transactions/:id/signatures
 * Get signature collection status for a multi-sig transaction.
 */
router.get(
  '/:id/signatures',
  checkPermission(PERMISSIONS.TRANSACTIONS_READ),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'id must be an integer' } });
      }
      const data = await multiSigService.getSignatures(id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Transaction Simulation Endpoint ─────────────────────────────────────────

/**
 * POST /transactions/simulate
 * Dry-run simulate a Stellar transaction without submitting it.
 *
 * Accepts a Base64-encoded XDR transaction envelope and returns fee estimates,
 * sequence validity, balance status, and operation validity.
 * No secret key is required. submitTransaction is never called.
 */
router.post(
  '/simulate',
  payloadSizeLimiter(ENDPOINT_LIMITS.transaction),
  checkPermission(PERMISSIONS.TRANSACTIONS_SIMULATE),
  async (req, res, next) => {
    try {
      const { tx_envelope } = req.body;

      if (!tx_envelope || typeof tx_envelope !== 'string') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_TX_ENVELOPE',
            message: 'tx_envelope (Base64 XDR) is required',
          },
        });
      }

      const stellarService = serviceContainer.getStellarService();
      const result = await stellarService.simulateTransaction(tx_envelope);

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.code === 'SIMULATION_DISABLED') {
        return res.status(403).json({
          success: false,
          error: { code: 'SIMULATION_DISABLED', message: err.message },
        });
      }
      if (err.code === 'INVALID_XDR') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_XDR', message: err.message },
        });
      }
      if (err.code === 'ACCOUNT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'ACCOUNT_NOT_FOUND', message: err.message },
        });
      }
      next(err);
    }
  }
);

// ─── Memo Decryption Endpoint ────────────────────────────────────────────────

/**
 * POST /transactions/:id/decrypt-memo
 * Decrypt an encrypted transaction memo for authorized recipients.
 *
 * Requires:
 * - The transaction ID
 * - The recipient's Stellar secret key (S...)
 * - The 'transactions:read' permission on the recipient wallet
 *
 * Returns the plaintext memo if decryption succeeds.
 * Only the transaction recipient can decrypt their own memos.
 */
router.post(
  '/:id/decrypt-memo',
  payloadSizeLimiter(ENDPOINT_LIMITS.transaction),
  checkPermission(PERMISSIONS.TRANSACTIONS_READ),
  validateSchema({
    body: {
      fields: {
        recipientSecret: {
          type: 'string',
          required: true,
          trim: true,
          minLength: 56,
          maxLength: 56,
          validate: (value) => {
            return value.startsWith('S') ? true : 'Secret key must start with S';
          },
        },
      },
    },
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { recipientSecret } = req.body;

      // Load transaction
      const tx = Transaction.getById(id);
      if (!tx) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TRANSACTION_NOT_FOUND',
            message: `Transaction ${id} not found`,
          },
        });
      }

      // Verify memo is encrypted
      if (!tx.memoEnvelope) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MEMO_NOT_ENCRYPTED',
            message: 'Transaction memo is not encrypted',
          },
        });
      }

      // Decrypt the memo
      try {
        const MemoEncryptionService = require('../services/MemoEncryptionService');
        const plaintext = MemoEncryptionService.decryptMemoForRecipient(
          tx.memoEnvelope,
          recipientSecret
        );

        return res.status(200).json({
          success: true,
          data: {
            transactionId: tx.id,
            memo: plaintext,
            encryptedAt: tx.encryptionMetadata?.createdAt || null,
          },
        });
      } catch (decryptError) {
        // Decryption failed - likely wrong key
        return res.status(403).json({
          success: false,
          error: {
            code: 'DECRYPTION_FAILED',
            message: 'Failed to decrypt memo: invalid recipient secret key or tampered data',
          },
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /transactions/:id/envelope
 * Retrieve the stored Stellar Transaction Envelope (XDR) for a transaction.
 *
 * Returns the Base64-encoded XDR string used to submit the transaction.
 */
router.get(
  '/:id/envelope',
  checkPermission(PERMISSIONS.TRANSACTIONS_READ),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const tx = Transaction.getById(id);

      if (!tx) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TRANSACTION_NOT_FOUND',
            message: `Transaction ${id} not found`
          }
        });
      }

      if (!tx.envelopeXdr) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'ENVELOPE_NOT_FOUND',
            message: `XDR envelope for transaction ${id} is not available`
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          id: tx.id,
          stellarTxId: tx.stellarTxId,
          envelopeXdr: tx.envelopeXdr
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /transactions/stream
 * SSE endpoint for real-time confirmed transaction events.
 * Query params: ?walletAddress=  ?campaignId=
 * Header: x-api-key (used as connection key; defaults to 'anonymous')
 */
router.get('/stream', (req, res) => {
  const apiKey = req.headers['x-api-key'] || 'anonymous';
  const filters = {
    walletAddress: req.query.walletAddress || null,
    campaignId: req.query.campaignId || null,
  };

  const { added, limitExceeded } = sseManager.addClient(apiKey, res, filters);

  if (limitExceeded) {
    return res.status(429).json({
      success: false,
      error: { code: 'CONNECTION_LIMIT_EXCEEDED', message: 'Max 5 concurrent SSE connections per API key' },
    });
  }

  if (!added) {
    return res.status(500).json({ success: false, error: { code: 'SSE_ERROR', message: 'Failed to add SSE client' } });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
});

module.exports = router;
module.exports.sseManager = sseManager;
