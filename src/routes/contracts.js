/**
 * Contracts Route
 * Exposes endpoints for Soroban smart contract event monitoring.
 */

const express = require('express');
const { getStellarService } = require('../config/stellar');

const router = express.Router();

/**
 * GET /contracts/:id/events
 * Retrieve stored contract events for a given contract ID.
 *
 * Query params:
 *   limit (optional) — positive integer, maximum number of events to return
 *
 * Responses:
 *   200 { success: true, data: ContractEvent[], count: number }
 *   400 { success: false, error: { code: "INVALID_REQUEST", message: string } }
 *   500 { success: false, error: { code: "FETCH_EVENTS_FAILED", message: string } }
 */
router.get('/:id/events', async (req, res) => {
  let limit;

  if (req.query.limit !== undefined) {
    const parsed = parseInt(req.query.limit, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== String(req.query.limit)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'limit must be a positive integer',
        },
      });
    }
    limit = parsed;
  }

  try {
    const stellarService = getStellarService();
    const data = await stellarService.getContractEvents(req.params.id, limit);
    return res.status(200).json({ success: true, data, count: data.length });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EVENTS_FAILED',
        message: err.message,
      },
    });
  }
});

module.exports = router;
