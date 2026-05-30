/**
 * Docs routes
 * GET /docs/validation-errors — full error code reference
 */

const express = require('express');
const router = express.Router();
const { ERROR_REGISTRY, SENSITIVE_FIELDS } = require('../utils/validationErrorFormatter');

/**
 * GET /docs/validation-errors
 * Returns the full validation error code reference.
 */
router.get('/validation-errors', (req, res) => {
  const reference = Object.entries(ERROR_REGISTRY).map(([code, meta]) => ({
    code,
    field: meta.field,
    expectedFormat: meta.expectedFormat,
    description: meta.description,
    docLink: `/docs/validation-errors#${code.toLowerCase()}`,
  }));

  res.json({
    sensitiveFields: Array.from(SENSITIVE_FIELDS),
    totalCodes: reference.length,
    errors: reference,
  });
});

module.exports = router;
