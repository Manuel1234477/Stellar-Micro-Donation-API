'use strict';

/**
 * Fees Routes
 *
 * GET /fees  — public endpoint returning application fees + Stellar network base fee.
 *              Reads from NetworkStatusService cache; no live Horizon call.
 *
 * Closes #794.
 */

const express = require('express');
const router = express.Router();
const serviceContainer = require('../config/serviceContainer');
const asyncHandler = require('../utils/asyncHandler');

const STROOPS_PER_XLM = 10_000_000;

/** Map NetworkStatusService feeLevel → congestion label required by #794 */
function mapCongestion(status) {
  if (!status || !status.connected) return 'unknown';
  const { feeSurgeMultiplier } = status;
  if (feeSurgeMultiplier <= 1) return 'low';
  if (feeSurgeMultiplier <= 3) return 'medium';
  return 'high';
}

/**
 * GET /fees
 * Public — no authentication required.
 * Returns application fee config + Stellar network base fee from cache.
 */
router.get('/', asyncHandler(async (req, res) => {
  const platformFeePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || '1.5');
  const minimumFeeXLM     = parseFloat(process.env.MINIMUM_FEE_XLM     || '0.01');
  const maximumFeeXLM     = parseFloat(process.env.MAXIMUM_FEE_XLM     || '10.00');

  const networkStatus = serviceContainer.getNetworkStatusService().getStatus();

  // Prefer the cached fee; fall back to Stellar baseline (100 stroops)
  const baseFeeStroops = (networkStatus && networkStatus.feeStroops) || 100;
  const baseFeeXLM     = parseFloat((baseFeeStroops / STROOPS_PER_XLM).toFixed(7));

  const feeSource    = (networkStatus && networkStatus.connected) ? 'network_status_cache' : 'fallback_baseline';
  const lastUpdatedAt = (networkStatus && networkStatus.timestamp) || new Date().toISOString();
  const congestion   = mapCongestion(networkStatus);

  // Example calculation for a 100 XLM donation
  const exampleAmount   = 100.00;
  const platformFee     = parseFloat(Math.max(exampleAmount * platformFeePercent / 100, minimumFeeXLM).toFixed(7));
  const totalCost       = parseFloat((exampleAmount + platformFee + baseFeeXLM).toFixed(7));

  const minimumTotalFeeXLM = parseFloat((minimumFeeXLM + baseFeeXLM).toFixed(7));

  res.json({
    application: {
      platformFeePercent,
      minimumFeeXLM,
      maximumFeeXLM,
      feeCalculationExample: {
        donationAmount: exampleAmount,
        platformFee,
        stellarFee: baseFeeXLM,
        totalCost,
      },
    },
    stellar: {
      baseFeeStroops,
      baseFeeXLM,
      feeSource,
      lastUpdatedAt,
      networkCongestion: congestion,
    },
    total: {
      minimumTotalFeeXLM,
      note: 'Total fee = max(platformFee, minimumFeeXLM) + stellarBaseFee',
    },
  });
}));

module.exports = router;
