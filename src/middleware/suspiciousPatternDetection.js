/**
 * Suspicious Pattern Detection Middleware
 * 
 * RESPONSIBILITY: Integrate pattern detection into request pipeline
 * OWNER: Security Team
 * DEPENDENCIES: SuspiciousPatternDetector
 * 
 * Observability-only middleware that detects suspicious patterns without blocking.
 */

const suspiciousPatternDetector = require('../utils/suspiciousPatternDetector');
const log = require('../utils/log');

/**
 * Middleware to detect suspicious patterns in donation requests
 */
function suspiciousPatternMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;

  // Track off-hours activity for all requests
  suspiciousPatternDetector.detectOffHoursActivity(ip);

  // Hook into response to analyze donation patterns
  const originalJson = res.json;
  res.json = function(data) {
    try {
      // Only analyze successful donation operations
      if (data.success && req.method === 'POST') {
        
        // Detect high velocity
        if (req.path.includes('/donations') || req.path.includes('/send')) {
          const donationData = {
            amount: req.body.amount,
            recipient: req.body.receiverId || req.body.recipient
          };
          
          suspiciousPatternDetector.detectHighVelocity(ip, donationData);
          
          // Detect identical amounts
          if (req.body.amount) {
            suspiciousPatternDetector.detectIdenticalAmounts(ip, req.body.amount);
          }
          
          // Detect recipient diversity
          if (req.body.senderId && req.body.receiverId) {
            suspiciousPatternDetector.detectRecipientDiversity(
              req.body.senderId,
              req.body.receiverId
            );
          }
        }

        // Reset failure counter on success
        suspiciousPatternDetector.resetFailures(ip);
      }

      // Track failures
      if (!data.success || res.statusCode >= 400) {
        const errorType = data.error?.code || 'unknown';
        suspiciousPatternDetector.detectSequentialFailures(ip, errorType);
      }
    } catch (error) {
      // Never let pattern detection break the response
      log.error('SUSPICIOUS_PATTERN', 'Pattern detection error', { error: error.message });
    }

    return originalJson.call(this, data);
  };

  next();
}

module.exports = suspiciousPatternMiddleware;
