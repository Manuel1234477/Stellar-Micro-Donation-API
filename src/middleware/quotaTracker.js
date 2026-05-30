/**
 * Quota Tracker Middleware
 * 
 * RESPONSIBILITY: Track API usage against monthly quotas
 * OWNER: Platform Team
 * 
 * Increments quota usage after successful request processing.
 * Must be placed after apiKey middleware and before route handlers.
 */

const { incrementQuota } = require('../models/apiKeys');
const log = require('../utils/log');

/**
 * Track quota usage for authenticated requests
 * Increments quota counter after response is sent
 */
const trackQuotaUsage = (req, res, next) => {
  // Only track if API key is present and has a quota
  if (req.apiKey && req.apiKey.id && req.apiKey.monthlyQuota) {
    // Increment quota after response is sent
    res.on('finish', async () => {
      // Only count successful requests (2xx and 3xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 400) {
        try {
          await incrementQuota(req.apiKey.id);
        } catch (error) {
          // Log but don't fail the request
          log.error('QUOTA_TRACKER', 'Failed to increment quota', {
            keyId: req.apiKey.id,
            error: error.message,
          });
        }
      }
    });
  }
  
  next();
};

module.exports = trackQuotaUsage;
