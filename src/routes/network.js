/**
 * Network status routes
 * GET /network/status         - current Horizon health snapshot
 * GET /network/status/history - last 24 hours of snapshots
 * GET /network/fees           - current fee statistics
 * GET /network/ledger         - latest ledger info
 * GET /network/metrics        - Prometheus-style metrics
 */

const express = require('express');
const router = express.Router();

let _service = null;

const VALID_PATHS = ['/status', '/status/history', '/fees', '/ledger', '/metrics'];

/**
 * Inject the NetworkStatusService instance.
 * @param {import('../services/NetworkStatusService')} service
 */
function setService(service) {
  _service = service;
}

/**
 * GET /network/status
 * Returns current network health. Publicly accessible, cached 30 seconds.
 */
router.get('/status', (req, res) => {
  if (!_service) return res.status(503).json({ success: false, error: 'NetworkStatusService not initialised' });

  const raw = _service.getStatus();
  const status = !raw.connected ? 'down' : raw.degraded ? 'degraded' : 'healthy';

  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    success: true,
    data: {
      status,
      lastLedgerCloseTime: raw.ledgerCloseTimeS,
      baseFee: raw.feeStroops,
      capacityUsage: raw.feeSurgeMultiplier,
      timestamp: raw.timestamp,
    },
  });
});

/**
 * GET /network/status/history
 * Returns status snapshots from the last 24 hours.
 */
router.get('/status/history', (req, res) => {
  if (!_service) return res.status(503).json({ error: 'NetworkStatusService not initialised' });
  res.json({ history: _service.getHistory() });
});

/**
 * GET /network/fees
 * Returns current fee statistics from NetworkStatusService.
 */
router.get('/fees', (req, res) => {
  if (!_service) return res.status(503).json({ success: false, error: 'NetworkStatusService not initialised' });

  const raw = _service.getStatus();

  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    success: true,
    data: {
      baseFeeStroops: raw.feeStroops,
      feeLevel: raw.feeLevel,
      feeSurgeMultiplier: raw.feeSurgeMultiplier,
      timestamp: raw.timestamp,
    },
  });
});

/**
 * GET /network/ledger
 * Returns latest ledger info derived from NetworkStatusService.
 */
router.get('/ledger', (req, res) => {
  if (!_service) return res.status(503).json({ success: false, error: 'NetworkStatusService not initialised' });

  const raw = _service.getStatus();

  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    success: true,
    data: {
      connected: raw.connected,
      ledgerCloseTimeSeconds: raw.ledgerCloseTimeS,
      latencyMs: raw.latencyMs,
      timestamp: raw.timestamp,
    },
  });
});

/**
 * GET /network/metrics
 * Returns Prometheus-style metrics derived from NetworkStatusService.
 */
router.get('/metrics', (req, res) => {
  if (!_service) return res.status(503).json({ success: false, error: 'NetworkStatusService not initialised' });

  const raw = _service.getStatus();

  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      network_connected: raw.connected ? 1 : 0,
      network_degraded: raw.degraded ? 1 : 0,
      network_latency_ms: raw.latencyMs,
      network_fee_stroops: raw.feeStroops,
      network_fee_surge_multiplier: raw.feeSurgeMultiplier,
      network_error_rate_percent: raw.errorRatePercent,
      timestamp: raw.timestamp,
    },
  });
});

/**
 * Catch-all: unknown /network/* paths return 404 with a hint listing valid sub-paths.
 */
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No network route matches ${req.method} /network${req.path}`,
      hint: `Valid sub-paths: ${VALID_PATHS.join(', ')}`,
    },
  });
});

module.exports = { router, setService };
