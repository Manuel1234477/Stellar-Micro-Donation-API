/**
 * API Key Usage Analytics Route
 *
 * GET /api-keys/:id/usage          - Summary stats for a key
 * GET /api-keys/:id/usage/timeseries - Time-series data (granularity: hour|day|week)
 * GET /api-keys/:id/usage/anomalies  - Anomaly detection results
 */

const express = require('express');
const ApiKeyUsageService = require('../services/ApiKeyUsageService');

const router = express.Router();

// Allow tests to inject a custom service instance
let _service = ApiKeyUsageService.instance;
const setUsageService = (svc) => { _service = svc; };

/**
 * GET /api-keys/:id/usage
 * Returns overall summary for the given API key.
 */
router.get('/:id/usage', (req, res) => {
  try {
    const summary = _service.getSummary(req.params.id);
    return res.json({ success: true, data: summary });
  } catch (err) {
    const status = err.message.includes('required') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api-keys/:id/usage/timeseries
 * Query params:
 *   granularity  - 'hour' | 'day' | 'week'  (required)
 *   from         - ISO date string or ms timestamp (optional)
 *   to           - ISO date string or ms timestamp (optional)
 */
router.get('/:id/usage/timeseries', (req, res) => {
  const { granularity, from, to } = req.query;

  if (!granularity) {
    return res.status(400).json({ success: false, error: 'granularity query param is required (hour|day|week)' });
  }

  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();

  if (isNaN(fromMs) || isNaN(toMs)) {
    return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
  }

  try {
    const series = _service.getTimeSeries(req.params.id, granularity, { from: fromMs, to: toMs });
    return res.json({ success: true, data: series, count: series.length });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api-keys/:id/usage/anomalies
 * Query params:
 *   granularity  - 'hour' | 'day' | 'week'  (required)
 *   multiplier   - std-dev multiplier (optional, default 2)
 *   from / to    - date range (optional)
 */
router.get('/:id/usage/anomalies', (req, res) => {
  const { granularity, multiplier, from, to } = req.query;

  if (!granularity) {
    return res.status(400).json({ success: false, error: 'granularity query param is required (hour|day|week)' });
  }

  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();
  const mult   = multiplier ? parseFloat(multiplier) : 2;

  if (isNaN(fromMs) || isNaN(toMs)) {
    return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
  }

  try {
    const result = _service.detectAnomalies(req.params.id, granularity, { multiplier: mult, from: fromMs, to: toMs });
    return res.json({ success: true, data: result });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.setUsageService = setUsageService;
