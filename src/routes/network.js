/**
 * Network status routes
 * GET /network/status         - current Horizon health snapshot
 * GET /network/status/history - last 24 hours of snapshots
 */

const express = require('express');
const router = express.Router();

let _service = null;

/**
 * Inject the NetworkStatusService instance.
 * Called once from app.js after the service is started.
 * @param {import('../services/NetworkStatusService')} service
 */
function setService(service) {
  _service = service;
}

/**
 * GET /network/status
 * Returns current network health.
 */
router.get('/status', (req, res) => {
  if (!_service) return res.status(503).json({ error: 'NetworkStatusService not initialised' });
  res.json(_service.getStatus());
});

/**
 * GET /network/status/history
 * Returns status snapshots from the last 24 hours.
 */
router.get('/status/history', (req, res) => {
  if (!_service) return res.status(503).json({ error: 'NetworkStatusService not initialised' });
  res.json({ history: _service.getHistory() });
});

module.exports = { router, setService };
