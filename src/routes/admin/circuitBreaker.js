/**
 * Admin Circuit Breaker Routes
 *
 * RESPONSIBILITY: Admin-only manual control of the Stellar circuit breaker
 * OWNER: Backend Team
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const serviceContainer = require('../../config/serviceContainer');

/**
 * GET /admin/circuit-breaker/status
 * Returns the current circuit breaker state.
 */
router.get('/status', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const stellarService = serviceContainer.getStellarService();
  const cb = stellarService.circuitBreaker;

  if (!cb) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Circuit breaker not available on this service' },
    });
  }

  res.json({ success: true, data: cb.getStatus() });
});

/**
 * POST /admin/circuit-breaker/reset
 * Manually resets the circuit breaker to CLOSED state.
 */
router.post('/reset', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const stellarService = serviceContainer.getStellarService();
  const cb = stellarService.circuitBreaker;

  if (!cb) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Circuit breaker not available on this service' },
    });
  }

  const previousState = cb.getStatus();
  cb.reset();

  res.json({
    success: true,
    message: 'Circuit breaker reset to closed state',
    data: {
      previousState: previousState.state,
      currentState: cb.getStatus(),
    },
  });
});

module.exports = router;
