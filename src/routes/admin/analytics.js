const express = require('express');
const { requireAdmin } = require('../../middleware/rbac');
const ApiKeyUsageService = require('../../services/ApiKeyUsageService');

const router = express.Router();

/**
 * GET /admin/analytics/top-endpoints
 * Returns the most-called endpoints across all API keys.
 */
router.get('/top-endpoints', requireAdmin(), (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from).getTime() : undefined;
    const to = req.query.to ? new Date(req.query.to).getTime() : undefined;
    if ((req.query.from && isNaN(from)) || (req.query.to && isNaN(to))) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
    }

    const topEndpoints = ApiKeyUsageService.instance.getTopEndpoints({ from, to, limit: 10 });
    return res.json({ success: true, data: { topEndpoints } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
