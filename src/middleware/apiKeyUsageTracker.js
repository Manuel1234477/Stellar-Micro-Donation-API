/**
 * apiKeyUsageTracker middleware
 * Intercepts every response and records usage metrics against the API key
 * found in the request (X-API-Key header or ?apiKey query param).
 *
 * If no API key is present the request is still passed through — tracking
 * is skipped for unauthenticated requests.
 */

const { instance: usageService } = require('../services/ApiKeyUsageService');

/**
 * Express middleware that records per-key usage metrics.
 * Attaches itself to the 'finish' event so latency is measured end-to-end.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function apiKeyUsageTracker(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey) return next();

  const start = Date.now();

  res.on('finish', () => {
    try {
      usageService.record(apiKey, {
        latencyMs: Date.now() - start,
        statusCode: res.statusCode,
        path: req.path,
        method: req.method,
      });
    } catch (_) {
      // Never let tracking errors affect the response
    }
  });

  next();
}

module.exports = apiKeyUsageTracker;
