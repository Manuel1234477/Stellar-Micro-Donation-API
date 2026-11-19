'use strict';

/**
 * Admin XDR routes.
 *
 * Historically this module exposed `POST /admin/xdr/decode-xdr` with its own
 * inline Stellar SDK decoder. Per #1778 the admin XDR endpoints were merged
 * into `src/routes/admin/inspect.js`, and per #1986 all XDR decoding must go
 * through the single shared `XdrInspector` utility.
 *
 * This module is kept as a thin, backwards-compatible delegate so that any
 * existing route registration or client calling the legacy path keeps
 * working, without introducing a second decoder implementation.
 */

const express = require('express');

const { XdrInspector } = require('../../utils/xdrInspector');
const { requireAdmin } = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');
const { decodeXdrSchema } = require('../../schemas/xdr');

const router = express.Router();

/**
 * POST /admin/xdr/decode-xdr
 *
 * Legacy admin endpoint. Delegates to the shared XdrInspector so there is a
 * single decoding implementation backing every XDR endpoint.
 */
router.post(
  '/decode-xdr',
  requireAdmin,
  validate(decodeXdrSchema),
  async (req, res, next) => {
    try {
      const { xdr, networkPassphrase } = req.body;

      const result = await XdrInspector.inspect(xdr, {
        networkPassphrase,
        // Admin callers may request the full, unbounded decode.
        maxOperations: Infinity,
        maxDepth: Infinity,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;