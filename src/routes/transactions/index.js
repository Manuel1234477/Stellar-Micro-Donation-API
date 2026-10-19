/**
 * Transaction Routes — Main Index
 *
 * RESPONSIBILITY: Mount and compose transaction sub-routers.
 * OWNER: Backend Team
 * DEPENDENCIES: Sub-routers in this directory
 *
 * Sub-router responsibilities:
 *
 *   core.js          — GET /, GET /stream, GET /:id, POST /sync,
 *                      POST /simulate, multisig (/multisig, /:id/sign,
 *                      /:id/signatures), /:id/decrypt-memo, /:id/envelope
 *   bump-sequence.js — POST /bump-sequence
 */

'use strict';

const express = require('express');
const router = express.Router();

// core.js is mounted first so its routes keep the same priority they had
// when it was mounted directly at /transactions.
router.use('/', require('./core'));
router.use('/bump-sequence', require('./bump-sequence'));

module.exports = router;
