/**
 * Tools Routes - Utility and Developer Tools
 * 
 * RESPONSIBILITY: Provide helper endpoints for Stellar transaction inspection and debugging
 * OWNER: Backend Team
 * DEPENDENCIES: Stellar SDK, Error utilities
 * 
 * Provides endpoints for decoding and inspecting Stellar transaction envelopes (XDR).
 */

const express = require('express');
const router = express.Router();
const StellarSdk = require('stellar-sdk');
const { ValidationError } = require('../utils/errors');
const log = require('../utils/log');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

/**
 * POST /tools/decode-transaction
 * Decode a Base64-encoded Stellar XDR envelope and return a human-readable breakdown.
 * 
 * @param {string} xdr - Base64 encoded Stellar Transaction Envelope XDR
 * @param {string} networkPassphrase - Network passphrase (defaults to Testnet if not provided)
 * @returns {Object} Human-readable breakdown of operations, signers, and signatures
 */
router.post('/decode-transaction', payloadSizeLimiter(ENDPOINT_LIMITS.default), asyncHandler(async (req, res, next) => {
  try {
    const { xdr, networkPassphrase = StellarSdk.Networks.TESTNET } = req.body;

    if (!xdr) {
      throw new ValidationError('xdr (Base64 XDR) is required');
    }

    let tx;
    try {
      tx = StellarSdk.TransactionBuilder.fromEnvelope(xdr, networkPassphrase);
    } catch (err) {
      // Clear parse error as requested - never 500
      log.warn('TOOLS', 'Failed to parse XDR', { error: err.message });
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_XDR',
          message: `Failed to parse XDR envelope: ${err.message}`
        }
      });
    }

    // Breakdown transaction components
    const breakdown = {
      txHash: tx.hash().toString('hex'),
      sourceAccount: tx.source,
      fee: tx.fee,
      sequence: tx.sequence,
      memo: tx.memo.value ? { type: tx.memo.type, value: tx.memo.value.toString() } : null,
      timeBounds: tx.timeBounds ? { min: tx.timeBounds.minTime, max: tx.timeBounds.maxTime } : null,
      operations: tx.operations.map((op, idx) => ({
        index: idx,
        type: op.type,
        source: op.source || tx.source,
        details: { ...op }
      })),
      signatures: tx.signatures.map(sig => ({
        hint: sig.hint().toString('hex'),
        signature: sig.signature().toString('hex')
      }))
    };

    // Clean up internal detail objects to avoid cyclic / too deep structures
    breakdown.operations.forEach(op => {
      delete op.details.type;
      delete op.details.source;
    });

    return res.status(200).json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
