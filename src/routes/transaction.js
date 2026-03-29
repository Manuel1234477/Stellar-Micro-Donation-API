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

const express = require('express');
const router = express.Router();
const Transaction = require('./models/transaction');
const TransactionSyncService = require('../services/TransactionSyncService');
const MultiSigService = require('../services/MultiSigService');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { validatePagination } = require('../utils/validationHelpers');
const { validateSchema } = require('../middleware/schemaValidation');
const serviceContainer = require('../config/serviceContainer');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

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

    const paginationValidation = validatePagination(limit, offset);

    if (!paginationValidation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: paginationValidation.error
        }
      });
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
        return res.status(400).json({
          success: false,
          error: {
            code: "MISSING_PUBLIC_KEY",
            message: "publicKey is required",
          },
        });
      }

      const syncService = new TransactionSyncService();
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

module.exports = router;

