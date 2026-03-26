/**
 * Monitors Route
 * CRUD endpoints for Stellar account monitors.
 *
 * POST   /monitors          - Create a new monitor
 * GET    /monitors          - List all monitors
 * GET    /monitors/:id      - Get a single monitor
 * DELETE /monitors/:id      - Delete a monitor
 */

const express = require('express');
const AccountMonitorService = require('../services/AccountMonitorService');
const { getStellarService } = require('../config/stellar');

const router = express.Router();

// Singleton monitor service (shared across requests)
let _monitorService = null;
const getMonitorService = () => {
  if (!_monitorService) {
    _monitorService = new AccountMonitorService(getStellarService());
  }
  return _monitorService;
};

// Exposed for testing — allows injecting a pre-configured service
const setMonitorService = (svc) => { _monitorService = svc; };

/**
 * POST /monitors
 * Create a new account monitor.
 * Body: { accountId, conditions, balanceThreshold?, amountThreshold?, alertConfig }
 */
router.post('/', (req, res) => {
  try {
    const monitor = getMonitorService().createMonitor(req.body);
    return res.status(201).json({ success: true, data: monitor });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') || err.message.includes('must be') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /monitors
 * List all monitors.
 */
router.get('/', (_req, res) => {
  try {
    const monitors = getMonitorService().listMonitors();
    return res.json({ success: true, data: monitors, count: monitors.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /monitors/:id
 * Get a single monitor by ID.
 */
router.get('/:id', (req, res) => {
  try {
    const monitor = getMonitorService().getMonitor(req.params.id);
    return res.json({ success: true, data: monitor });
  } catch (err) {
    return res.status(404).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /monitors/:id
 * Delete a monitor and stop its stream.
 */
router.delete('/:id', (req, res) => {
  try {
    getMonitorService().deleteMonitor(req.params.id);
    return res.json({ success: true, message: `Monitor ${req.params.id} deleted` });
  } catch (err) {
    return res.status(404).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.setMonitorService = setMonitorService;
