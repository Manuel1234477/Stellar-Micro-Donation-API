'use strict';

/**
 * Backwards-compatible entry point (issue #1779).
 *
 * Transaction routes live in transactions/ — add new endpoints there, not here.
 * This file only re-exports that router so existing imports keep working.
 */
router.post(
  '/simulate',
  payloadSizeLimiter(ENDPOINT_LIMITS.transaction),
  checkPermission(PERMISSIONS.TRANSACTIONS_SIMULATE),
  asyncHandler(async (req, res, next) => {
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
  })
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
  asyncHandler(async (req, res, next) => {
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
  })
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
  asyncHandler(async (req, res, next) => {
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
  })
);

/**
 * GET /transactions/stream
 * SSE endpoint for real-time confirmed transaction events.
 * Query params: ?walletAddress=  ?campaignId=  ?minAmount=  ?status=
 * Header: x-api-key (used as connection key; defaults to 'anonymous')
 */
router.get('/stream', (req, res) => {
  const apiKey = req.headers['x-api-key'] || 'anonymous';
  const filters = {
    walletAddress: req.query.walletAddress || null,
    campaignId: req.query.campaignId || null,
    status: req.query.status || null,
    minAmount: req.query.minAmount !== undefined ? parseFloat(req.query.minAmount) : null,
  };

  const { added, limitExceeded } = sseManager.addClient(apiKey, res, filters);

  if (limitExceeded) {
    return res.status(429).json({
      error: 'CONNECTION_LIMIT_EXCEEDED',
      code: 'CONNECTION_LIMIT_EXCEEDED',
      message: 'Max 5 concurrent SSE connections per API key',
    });
  }

  if (!added) {
    return res.status(500).json({
      error: 'SSE_ERROR',
      code: 'SSE_ERROR',
      message: 'Failed to add SSE client',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
});

// Wire donationEvents to sseManager so real-time donation events are streamed
try {
  const donationEvents = require('../events/donationEvents');
  const broadcastHandler = (tx) => {
    if (tx) {
      sseManager.broadcastTransaction(tx);
    }
  };
  donationEvents.on(donationEvents.EVENTS.CONFIRMED, broadcastHandler);
  donationEvents.on(donationEvents.EVENTS.CREATED, broadcastHandler);
  donationEvents.on(donationEvents.EVENTS.SUBMITTED, broadcastHandler);
} catch (_) { /* best-effort */ }

/**
 * GET /transactions/:id
 * Get a single transaction by ID, including stellarTxHash for blockchain verification (#776).
 * Must be declared after all specific named routes to avoid shadowing them.
 */
router.get(
  '/:id',
  checkPermission(PERMISSIONS.TRANSACTIONS_READ),
  asyncHandler(async (req, res, next) => {
    try {
      const tx = Transaction.getById(req.params.id);
      if (!tx) {
        return res.status(404).json({
          success: false,
          error: { code: 'TRANSACTION_NOT_FOUND', message: `Transaction ${req.params.id} not found` },
        });
      }
      return res.status(200).json({ success: true, data: withStellarTxHash(tx) });
    } catch (error) {
      next(error);
    }
  })
);

module.exports = router;
module.exports.sseManager = sseManager;
