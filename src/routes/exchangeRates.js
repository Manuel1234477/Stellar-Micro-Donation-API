'use strict';

/**
 * Exchange Rates Routes
 *
 * GET /exchange-rates — public endpoint returning XLM rates from the price oracle.
 *
 * Moved out of src/bootstrap/routes.js (#1780).
 */

const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');

router.get('/', asyncHandler(async (req, res) => {
  try {
    const priceOracle = require('../services/PriceOracleService');
    const rates = await priceOracle.getRates();
    const priceSource = typeof priceOracle.getPriceSourceStatus === 'function'
      ? priceOracle.getPriceSourceStatus().source
      : undefined;
    res.json({
      success: true,
      data: {
        base: 'XLM',
        rates,
        source: priceSource,
        supportedCurrencies: ['XLM', ...priceOracle.SUPPORTED_CURRENCIES.map(c => c.toUpperCase())],
        cachedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error('APP', 'Failed to fetch exchange rates', { error: err.message });
    res.status(503).json({
      success: false,
      error: { code: 'EXCHANGE_RATE_UNAVAILABLE', message: err.message },
    });
  }
}));

module.exports = router;
