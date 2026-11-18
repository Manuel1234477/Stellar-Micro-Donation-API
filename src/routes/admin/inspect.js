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
const log = require('../../utils/log');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { deprecated } = require('../../middleware/deprecation');

const router = express.Router();

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
    const networkPassphrase = network === 'public' || network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;

    let envelope;
    let txType = 'transaction';
    let decodedData = {};

    try {
      // Try decoding as standard transaction envelope
      envelope = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
      
      if (envelope.constructor.name === 'FeeBumpTransaction') {
        txType = 'feeBump';
        decodedData = decodeFeeBumpTransaction(envelope);
      } else {
        decodedData = decodeTransaction(envelope);
      }
    } catch (decodeError) {
      // Try decoding as fee-bump transaction if standard decode failed
      try {
        envelope = new StellarSdk.FeeBumpTransaction(xdr, networkPassphrase);
        txType = 'feeBump';
        decodedData = decodeFeeBumpTransaction(envelope);
      } catch (feeBumpError) {
        throw new ValidationError(
          `Invalid XDR format: ${decodeError.message}`,
          { xdrError: decodeError.message, feeBumpError: feeBumpError.message },
          'INVALID_XDR'
        );
      }
    }

    return res.json({
      success: true,
      data: {
        ...decodedData,
        type: txType,
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

    let tx;
    try {
      tx = StellarSdk.TransactionBuilder.fromXDR(xdr, StellarSdk.Networks[network.toUpperCase()] || StellarSdk.Networks.TESTNET);
    } catch (err) {
      throw new ValidationError('Invalid XDR envelope', { originalError: err.message });
    }

    const inspection = {
      hash: tx.hash().toString('hex'),
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
    const network = process.env.STELLAR_NETWORK === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
    
    let tx;
    try {
      tx = StellarSdk.TransactionBuilder.fromXDR(transaction.envelopeXdr, network);
    } catch (err) {
      // If parsing fails with default, maybe it was a different network or corrupted
      log.error('ADMIN', 'Failed to parse stored XDR', { id, error: err.message });
      throw new ValidationError('Stored XDR envelope is invalid or used different network', { originalError: err.message });
    }

    const inspection = {
      localTransaction: {
        id: transaction.id,
        status: transaction.status,
        stellarTxId: transaction.stellarTxId
      },
      decoded: {
        hash: tx.hash().toString('hex'),
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
 * Decode a standard Stellar transaction into structured JSON.
 * @param {Transaction} transaction - Stellar SDK Transaction object
 * @returns {Object} Decoded transaction data
 */
function decodeTransaction(transaction) {
  const operations = transaction.operations.map((op, index) => ({
    index,
    type: op.type,
    source: op.source || transaction.source,
    ...extractOperationFields(op),
  }));

  const memo = decodeMemo(transaction.memo);
  const timeBounds = transaction.timeBounds ? {
    minTime: transaction.timeBounds.minTime,
    maxTime: transaction.timeBounds.maxTime,
  } : null;

  const signatures = transaction.signatures.map(sig => ({
    hint: sig.hint().toString('hex'),
    signature: sig.signature().toString('base64'),
  }));

  return {
    hash: transaction.hash().toString('hex'),
    source: transaction.source,
    sequence: transaction.sequence,
    fee: transaction.fee,
    memo,
    timeBounds,
    operations,
    signatures,
  };
}

/**
 * Decode a fee-bump transaction into structured JSON.
 * @param {FeeBumpTransaction} feeBumpTx - Stellar SDK FeeBumpTransaction object
 * @returns {Object} Decoded fee-bump transaction data
 */
function decodeFeeBumpTransaction(feeBumpTx) {
  const innerTx = feeBumpTx.innerTransaction;
  const innerDecoded = decodeTransaction(innerTx);

  const signatures = feeBumpTx.signatures.map(sig => ({
    hint: sig.hint().toString('hex'),
    signature: sig.signature().toString('base64'),
  }));

  return {
    hash: feeBumpTx.hash().toString('hex'),
    feeSource: feeBumpTx.feeSource,
    fee: feeBumpTx.fee,
    innerTransaction: innerDecoded,
    signatures,
  };
}

/**
 * Extract operation-specific fields based on operation type.
 * @param {Object} operation - Stellar SDK operation object
 * @returns {Object} Operation-specific fields
 */
function extractOperationFields(operation) {
  const fields = {};

  switch (operation.type) {
    case 'payment':
      fields.destination = operation.destination;
      fields.asset = formatAsset(operation.asset);
      fields.amount = operation.amount;
      break;

    case 'createAccount':
      fields.destination = operation.destination;
      fields.startingBalance = operation.startingBalance;
      break;

    case 'pathPaymentStrictReceive':
    case 'pathPaymentStrictSend':
      fields.sendAsset = formatAsset(operation.sendAsset);
      fields.sendMax = operation.sendMax;
      fields.destination = operation.destination;
      fields.destAsset = formatAsset(operation.destAsset);
      fields.destAmount = operation.destAmount;
      fields.path = operation.path ? operation.path.map(formatAsset) : [];
      break;

    case 'changeTrust':
      fields.line = formatAsset(operation.line);
      fields.limit = operation.limit;
      break;

    case 'allowTrust':
      fields.trustor = operation.trustor;
      fields.assetCode = operation.assetCode;
      fields.authorize = operation.authorize;
      break;

    case 'setOptions':
      if (operation.inflationDest) fields.inflationDest = operation.inflationDest;
      if (operation.clearFlags) fields.clearFlags = operation.clearFlags;
      if (operation.setFlags) fields.setFlags = operation.setFlags;
      if (operation.masterWeight !== undefined) fields.masterWeight = operation.masterWeight;
      if (operation.lowThreshold !== undefined) fields.lowThreshold = operation.lowThreshold;
      if (operation.medThreshold !== undefined) fields.medThreshold = operation.medThreshold;
      if (operation.highThreshold !== undefined) fields.highThreshold = operation.highThreshold;
      if (operation.homeDomain) fields.homeDomain = operation.homeDomain;
      if (operation.signer) fields.signer = operation.signer;
      break;

    case 'manageData':
      fields.name = operation.name;
      fields.value = operation.value ? operation.value.toString('base64') : null;
      break;

    case 'bumpSequence':
      fields.bumpTo = operation.bumpTo;
      break;

    case 'manageBuyOffer':
    case 'manageSellOffer':
      fields.selling = formatAsset(operation.selling);
      fields.buying = formatAsset(operation.buying);
      fields.amount = operation.amount;
      fields.price = operation.price;
      fields.offerId = operation.offerId || '0';
      break;

    case 'createPassiveSellOffer':
      fields.selling = formatAsset(operation.selling);
      fields.buying = formatAsset(operation.buying);
      fields.amount = operation.amount;
      fields.price = operation.price;
      break;

    case 'accountMerge':
      fields.destination = operation.destination;
      break;

    case 'liquidityPoolDeposit':
      fields.liquidityPoolId = operation.liquidityPoolId;
      fields.maxAmountA = operation.maxAmountA;
      fields.maxAmountB = operation.maxAmountB;
      fields.minPrice = operation.minPrice;
      fields.maxPrice = operation.maxPrice;
      break;

    case 'liquidityPoolWithdraw':
      fields.liquidityPoolId = operation.liquidityPoolId;
      fields.amount = operation.amount;
      fields.minAmountA = operation.minAmountA;
      fields.minAmountB = operation.minAmountB;
      break;

    default:
      // Generic field extraction for unknown operation types
      Object.keys(operation).forEach(key => {
        if (key !== 'type' && key !== 'source') {
          fields[key] = operation[key];
        }
      });
  }

  return fields;
}

/**
 * Format a Stellar asset into a standardized object.
 * @param {Asset} asset - Stellar SDK Asset object
 * @returns {Object} Formatted asset
 */
function formatAsset(asset) {
  if (!asset) return null;
  
  if (asset.isNative()) {
    return { type: 'native', code: 'XLM' };
  }

  return {
    type: asset.getAssetType(),
    code: asset.getCode(),
    issuer: asset.getIssuer(),
  };
}

/**
 * Decode a Stellar memo into a structured object.
 * @param {Memo} memo - Stellar SDK Memo object
 * @returns {Object} Decoded memo
 */
function decodeMemo(memo) {
  if (!memo || memo.type === StellarSdk.MemoNone) {
    return { type: 'none', value: null };
  }

  switch (memo.type) {
    case StellarSdk.MemoText:
      return { type: 'text', value: memo.value };
    
    case StellarSdk.MemoID:
      return { type: 'id', value: memo.value };
    
    case StellarSdk.MemoHash:
      return { type: 'hash', value: memo.value.toString('hex') };
    
    case StellarSdk.MemoReturn:
      return { type: 'return', value: memo.value.toString('hex') };
    
    default:
      return { type: 'unknown', value: null };
  }
}

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

