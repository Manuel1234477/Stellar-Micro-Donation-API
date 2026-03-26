/**
 * Payment Channels Routes
 *
 * RESPONSIBILITY: HTTP request handling for payment channel lifecycle
 * OWNER: Backend Team
 * DEPENDENCIES: PaymentChannelService, middleware (auth, rbac)
 *
 * Endpoints:
 *   POST   /channels              — Open a new channel
 *   GET    /channels              — List channels (optional ?status= filter)
 *   GET    /channels/:id          — Get a single channel
 *   POST   /channels/:id/update   — Apply an off-chain state update
 *   POST   /channels/:id/settle   — Settle channel on-chain
 *   POST   /channels/:id/dispute  — Raise a dispute
 *   DELETE /channels/:id          — Force-close a timed-out channel
 */

'use strict';

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { getStellarService } = require('../config/stellar');
const { PaymentChannelService } = require('../services/PaymentChannelService');
const log = require('../utils/log');

const channelService = new PaymentChannelService(getStellarService());

// Initialise DB table on first load (non-blocking)
channelService.initTable().catch((err) =>
  log.error('CHANNELS', 'Failed to init payment_channels table', { error: err.message })
);

// ─── POST /channels ───────────────────────────────────────────────────────────

/**
 * Open a new payment channel.
 * Body: { senderKey, receiverKey, capacity, fundingTxId?, metadata? }
 */
router.post('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const { senderKey, receiverKey, capacity, fundingTxId, metadata } = req.body;
    const channel = await channelService.openChannel({ senderKey, receiverKey, capacity: Number(capacity), fundingTxId, metadata });
    return res.status(201).json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
});

// ─── GET /channels ────────────────────────────────────────────────────────────

/**
 * List all channels, optionally filtered by ?status=open|settled|disputed|closed
 */
router.get('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const channels = await channelService.listChannels(req.query.status || null);
    return res.json({ success: true, data: channels, count: channels.length });
  } catch (err) {
    next(err);
  }
});

// ─── GET /channels/:id ────────────────────────────────────────────────────────

/**
 * Get a single channel by ID.
 */
router.get('/:id', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const channel = await channelService.getChannel(req.params.id);
    return res.json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
});

// ─── POST /channels/:id/update ────────────────────────────────────────────────

/**
 * Apply a signed off-chain state update.
 * Body: { amount, senderSecret, receiverSecret, senderSig, receiverSig }
 */
router.post('/:id/update', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const { amount, senderSecret, receiverSecret, senderSig, receiverSig } = req.body;
    const channel = await channelService.updateChannel({
      channelId: req.params.id,
      amount: Number(amount),
      senderSecret,
      receiverSecret,
      senderSig,
      receiverSig,
    });
    return res.json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
});

// ─── POST /channels/:id/settle ────────────────────────────────────────────────

/**
 * Settle the channel on-chain.
 * Body: { senderSecret }
 */
router.post('/:id/settle', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const channel = await channelService.settleChannel({
      channelId: req.params.id,
      senderSecret: req.body.senderSecret,
    });
    return res.json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
});

// ─── POST /channels/:id/dispute ───────────────────────────────────────────────

/**
 * Raise a dispute with a higher-sequence signed state.
 * Body: { sequence, balance, senderSig, receiverSig, senderSecret, receiverSecret }
 */
router.post('/:id/dispute', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const { sequence, balance, senderSig, receiverSig, senderSecret, receiverSecret } = req.body;
    const channel = await channelService.disputeChannel({
      channelId: req.params.id,
      sequence: Number(sequence),
      balance: Number(balance),
      senderSig,
      receiverSig,
      senderSecret,
      receiverSecret,
    });
    return res.json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /channels/:id ─────────────────────────────────────────────────────

/**
 * Force-close a timed-out channel.
 * Body: { senderSecret }
 */
router.delete('/:id', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const channel = await channelService.closeChannel({
      channelId: req.params.id,
      senderSecret: req.body.senderSecret,
    });
    return res.json({ success: true, data: channel });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
