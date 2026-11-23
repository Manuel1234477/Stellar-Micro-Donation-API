/**
 * XDR Inspection Routes - Admin Utilities (#1601, #1778)
 *
 * RESPONSIBILITY: The single admin module for inspecting Stellar XDR envelopes
 * OWNER: Backend Team
 * DEPENDENCIES: Stellar SDK, Transaction model, RBAC
 *
 * Canonical endpoints (mounted at /admin/inspect/xdr):
 *   POST /admin/inspect/xdr          - Inspect an arbitrary envelope
 *   POST /admin/inspect/xdr/decode   - Full decode (operations, signatures, fee-bump)
 *   GET  /admin/inspect/xdr/:id      - Inspect the stored envelope of a local transaction
 *
 * Deprecated (deprecatedRouter, mounted at /admin/transactions, sunset 1 Jan 2027):
 *   POST /admin/transactions/decode-xdr → POST /admin/inspect/xdr/decode
 *
 * Replaces the former src/routes/admin/xdr.js. Every endpoint uses requireAdmin().
 */

/**
 * @openapi
 * /admin/inspect/xdr/decode:
 *   post:
 *     tags: [Admin]
 *     summary: Decode a Stellar XDR transaction envelope
 *     description: Decode base64-encoded XDR into human-readable JSON format
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [xdr]
 *             properties:
 *               xdr:
 *                 type: string
 *                 description: Base64-encoded XDR transaction envelope
 *               network:
 *                 type: string
 *                 enum: [public, testnet]
 *                 default: testnet
 *                 description: Network passphrase for transaction hash calculation
 *     responses:
 *       200:
 *         description: XDR decoded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     hash: { type: string, description: Transaction hash }
 *                     source: { type: string, description: Source account }
 *                     sequence: { type: string, description: Sequence number }
 *                     fee: { type: string, description: Fee in stroops }
 *                     memo: { type: object, description: Memo object }
 *                     timeBounds: { type: object, description: Time bounds }
 *                     operations: { type: array, description: List of operations }
 *                     signatures: { type: array, description: List of signatures }
 *                     type: { type: string, enum: [transaction, feeBump] }
 *       400:
 *         description: Invalid XDR format
 *       401:
 *         description: Unauthorized
 *
 * /admin/transactions/decode-xdr:
 *   post:
 *     tags: [Admin]
 *     deprecated: true
 *     summary: Deprecated alias of POST /admin/inspect/xdr/decode
 *     description: Kept until the Sunset date (1 Jan 2027). Responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Same response as POST /admin/inspect/xdr/decode
 */

const express = require('express');
const StellarSdk = require('../../services/stellar/sdk.js');
const Transaction = require('../../models/transaction');
const { requireAdmin } = require('../../middleware/rbac');
const { ValidationError, NotFoundError} = require('../../utils/errors');
const { getNetworkPassphrase } = require('../../config/stellarEnvironments');
const log = require('../../utils/log');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { deprecated } = require('../../middleware/deprecation');
const XdrInspector = require('../../services/xdrInspector');

const router = express.Router();

/**
 * Resolve a network passphrase from a request-supplied network name.
 * @param {string} [network] - 'public' | 'mainnet' | 'testnet'
 * @returns {string} Stellar network passphrase
 */
function resolveNetworkPassphrase(network) {
  return getNetworkPassphrase(network);
}

/**
 * POST /admin/inspect/xdr/decode handler.
 * Decodes TransactionEnvelope and FeeBumpTransactionEnvelope XDR into JSON.
 */
const decodeXdrHandler = asyncHandler(async (req, res, next) => {
  try {
    const { xdr, network = 'testnet' } = req.body;

    if (!xdr || typeof xdr !== 'string') {
      throw new ValidationError('xdr (Base64-encoded string) is required');
    }

    // Determine network passphrase
    const networkPassphrase = resolveNetworkPassphrase(network);

    let decoded;
    try {
      decoded = XdrInspector.decode(xdr, networkPassphrase);
    } catch (decodeError) {
      throw new ValidationError(
        `Invalid XDR format: ${decodeError.message}`,
        { xdrError: decodeError.message },
        'INVALID_XDR'
      );
    }

    return res.json({
      success: true,
      data: {
        ...decoded.data,
        type: decoded.type,
        network: network,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/inspect/xdr
 * Inspect an arbitrary Stellar transaction envelope (XDR)
 */
router.post('/', requireAdmin(), (req, res, next) => {
  try {
    const { xdr, network = 'testnet' } = req.body;

    if (!xdr) {
      throw new ValidationError('XDR envelope is required');
    }

    const networkPassphrase = getNetworkPassphrase(network);

    let decoded;
    try {
      decoded = XdrInspector.decode(xdr, networkPassphrase);
    } catch (err) {
      throw new ValidationError('Invalid XDR envelope', { originalError: err.message });
    }

    const tx = decoded.envelope;
    const inspection = {
      hash: decoded.data.hash,
      network: network.toUpperCase(),
      source: tx.source,
      fee: tx.fee,
      memo: tx.memo ? {
        type: tx.memo.type,
        value: tx.memo.value ? tx.memo.value.toString() : null
      } : null,
      operationCount: tx.operations.length,
      operations: tx.operations.map(op => ({
        type: op.type,
        source: op.source || tx.source,
        ...op
      })),
      timeBounds: tx.timeBounds ? {
        minTime: tx.timeBounds.minTime,
        maxTime: tx.timeBounds.maxTime
      } : null,
      sequence: tx.sequence
    };

    log.info('ADMIN', 'XDR Inspection performed', { hash: inspection.hash });

    res.json({
      success: true,
      data: inspection,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/inspect/xdr/decode
 * Decode a base64-encoded XDR envelope into human-readable JSON.
 */
router.post('/decode', requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.default), decodeXdrHandler);

/**
 * GET /admin/inspect/xdr/:transactionId
 * Retrieve and inspect stored XDR for a local transaction
 */
router.get('/:id', requireAdmin(), (req, res, next) => {
  try {
    const { id } = req.params;
    const transaction = Transaction.getById(id);

    if (!transaction) {
      throw new NotFoundError(`Transaction not found: ${id}`);
    }

    if (!transaction.envelopeXdr) {
      throw new ValidationError('No XDR envelope stored for this transaction');
    }

    // Default to TESTNET for decoded if not specified (could be improved by checking config)
    const network = getNetworkPassphrase(process.env.STELLAR_NETWORK);

    let decoded;
    try {
      decoded = XdrInspector.decode(transaction.envelopeXdr, network);
    } catch (err) {
      // If parsing fails with default, maybe it was a different network or corrupted
      log.error('ADMIN', 'Failed to parse stored XDR', { id, error: err.message });
      throw new ValidationError('Stored XDR envelope is invalid or used different network', { originalError: err.message });
    }

    const tx = decoded.envelope;
    const inspection = {
      localTransaction: {
        id: transaction.id,
        status: transaction.status,
        stellarTxId: transaction.stellarTxId
      },
      decoded: {
        hash: decoded.data.hash,
        source: tx.source,
        fee: tx.fee,
        memo: tx.memo ? {
          type: tx.memo.type,
          value: tx.memo.value ? tx.memo.value.toString() : null
        } : null,
        operations: tx.operations,
        sequence: tx.sequence
      },
      raw: transaction.envelopeXdr
    };

    res.json({
      success: true,
      data: inspection,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Deprecated paths from the former admin/xdr.js module (sunset 1 Jan 2027).
 * Mounted at /admin/transactions; unmatched requests fall through.
 */
const deprecatedRouter = express.Router();
deprecatedRouter.post(
  '/decode-xdr',
  requireAdmin(),
  deprecated('/admin/inspect/xdr/decode'),
  payloadSizeLimiter(ENDPOINT_LIMITS.default),
  decodeXdrHandler
);

module.exports = router;
module.exports.deprecatedRouter = deprecatedRouter;

