/**
 * Block Check Middleware
 * 
 * Early check for auto-blocked IPs before processing request
 */

const abuseDetectionService = require('../services/AbuseDetectionService');
const log = require('../utils/log');

function blockCheck(req, res, next) {
  const ip = req.ip || req.get('X-Forwarded-For')?.split(',')[0]?.trim() || req.connection.remoteAddress || 'unknown';

  if (abuseDetectionService.isBlocked(ip)) {
    log.warn('BLOCK_CHECK', 'Request blocked', { ip, path: req.path, method: req.method });

    return res.status(403).json({
      success: false,
      error: {
        code: 'BLOCKED_IP',
        message: 'IP temporarily blocked for abuse prevention',
        blockedUntil: 'Admin contact required',
        requestId: req.id
      }
    });
  }

  // Add IP to request for logging
  req.clientIp = ip;
  next();
}

module.exports = blockCheck;

