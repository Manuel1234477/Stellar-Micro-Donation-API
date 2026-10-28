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
const StellarSdk = require('../services/stellar/sdk.js');
const { ValidationError } = require('../utils/errors');
const log = require('../utils/log');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { xdrDecodeRateLimiter } = require('../middleware/rateLimiter');
const { XdrInspector } = require('../utils/xdrInspector');

/**
 * POST /tools/decode-transaction
 * Decode a Base64-encoded Stellar XDR envelope and return a human-readable breakdown.
 *
 * @param {string} xdr - Base64 encoded Stellar Transaction Envelope XDR
 * @param {string} [networkPassphrase] - Network passphrase (defaults to server configuration if not provided)
 * @returns {Object} Human-readable breakdown of operations, signers, and signatures
 */
router.post(
  '/decode-transaction',
  xdrDecodeRateLimiter,
  payloadSizeLimiter(ENDPOINT_LIMITS.default),
  asyncHandler(async (req, res, next) => {
    try {
      const { xdr, networkPassphrase } = req.body;

      if (!xdr) {
        throw new ValidationError('xdr (Base64 XDR) is required', null, 'VALIDATION_ERROR');
      }

      let breakdown;
      try {
        breakdown = XdrInspector.decode(xdr, {
          networkPassphrase,
          maxOperations: 100,
        });
      } catch (err) {
        log.warn('TOOLS', 'Failed to parse XDR', { error: err.message });
        return res.status(400).json({
          success: false,
          error: {
            code: err.code || 'INVALID_XDR',
            message: `Failed to parse XDR envelope: ${err.message}`,
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: breakdown,
      });
    } catch (error) {
      next(error);
    }
  })
);

module.exports = router;
