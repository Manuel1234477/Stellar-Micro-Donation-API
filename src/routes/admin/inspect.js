const express = require('express');
const StellarSdk = require('stellar-sdk');
const Transaction = require('../models/transaction');
const { requireAdmin } = require('../../middleware/rbac');
const { ERROR_CODES, ValidationError, NotFoundError } = require('../../utils/errors');
const log = require('../../utils/log');

const router = express.Router();

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

module.exports = router;
