/**
 * Donation Routes — Main Index
 *
 * RESPONSIBILITY: Mount and compose donation sub-routers.
 * OWNER: Backend Team
 * DEPENDENCIES: donations/* sub-routers
 *
 * This file is intentionally thin. It mounts the four focused sub-routers in
 * priority order so that static paths (e.g. /export, /pending, /search) are
 * matched before the dynamic /:id param route.
 *
 * Sub-router responsibilities:
 *
 *   create.js — POST /send, POST /, POST /batch, POST /bulk,
 *               POST /cross-asset, POST /claimable, POST /claimable/:id/claim
 *
 *   export.js — POST /export, GET /export/:jobId,
 *               GET /export/:jobId/download, GET /export (deprecated)
 *
 *   query.js  — GET /, GET /pending, GET /recent, GET /by-campaign/:id,
 *               GET /search, GET /limits, GET /cost-breakdown,
 *               GET /verify-anonymous, POST /verify,
 *               GET /cross-asset/paths, GET /stats/by-campaign,
 *               GET /stats/by-tag, GET /:id, GET /:id/status,
 *               GET /:id/timeline
 *
 *   notes.js  — GET /:id/receipt, POST /:id/receipt/email,
 *               GET /:id/memo/decrypt, GET /:id/certificate,
 *               GET /:id/certificate/ipfs, GET /:id/impact,
 *               PATCH /:id/status, POST /:id/refund,
 *               GET /:id/tags, POST /:id/tags, DELETE /:id/tags/:tag
 *
 * @openapi
 * tags:
 *   - name: Donations
 *     description: Create and manage donations on the Stellar network
 */

'use strict';

const express = require('express');
const router = express.Router();

// Mount sub-routers. The order matters:
// 1. Export routes before the /:id param route in query.js
// 2. Create routes (POSTs) before query routes (GETs)
// 3. Notes routes (per-ID sub-paths) last, so /:id/… paths resolve correctly
router.use('/', require('./donations/create'));
router.use('/', require('./donations/export'));
router.use('/', require('./donations/query'));
router.use('/', require('./donations/notes'));

module.exports = router;
