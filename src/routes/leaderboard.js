/**
 * Leaderboard Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for real-time donation leaderboards
 * OWNER: Analytics Team
 * DEPENDENCIES: StatsService, middleware (auth, validation, RBAC)
 * 
 * Provides endpoints for:
 * - GET /leaderboard/donors - Top donors by total donations
 * - GET /leaderboard/recipients - Top recipients by total received
 * - GET /stream/leaderboard - SSE endpoint for real-time leaderboard updates
 */

const express = require('express');
const router = express.Router();
const StatsService = require('../routes/services/StatsService');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const AuditLogService = require('../services/AuditLogService');
const SseManager = require('../services/SseManager');
const { v4: uuidv4 } = require('uuid');

/** Valid time periods for leaderboard queries */
const VALID_PERIODS = ['all', 'monthly', 'weekly', 'daily'];

/** Maximum limit for leaderboard entries */
const MAX_LIMIT = 100;

/** Default limit for leaderboard entries */
const DEFAULT_LIMIT = 10;

/**
 * Validate and parse leaderboard query parameters
 * @param {Object} query - Query parameters
 * @returns {Object} Validated parameters or error
 */
function validateLeaderboardQuery(query) {
  const { period, limit } = query;
  
  // Validate period
  if (period && !VALID_PERIODS.includes(period)) {
    return { 
      error: `Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}` 
    };
  }
  
  // Validate limit
  let parsedLimit = DEFAULT_LIMIT;
  if (limit !== undefined) {
    parsedLimit = parseInt(limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return { 
        error: `Invalid limit. Must be a number between 1 and ${MAX_LIMIT}` 
      };
    }
  }
  
  return {
    period: period || 'all',
    limit: parsedLimit
  };
}

/** Fire-and-forget audit log for leaderboard data access */
function auditLeaderboardAccess(req, res, next) {
  AuditLogService.log({
    category: AuditLogService.CATEGORY.DATA_ACCESS,
    action: 'LEADERBOARD_ACCESSED',
    severity: AuditLogService.SEVERITY.LOW,
    result: 'SUCCESS',
    userId: req.user && req.user.id,
    requestId: req.id,
    ipAddress: req.ip,
    resource: req.path,
    details: { query: req.query, params: req.params }
  }).catch(() => {});
  next();
}

/**
 * GET /leaderboard/donors
 * Get top donors leaderboard
 * Query params:
 *   - period: 'all', 'monthly', 'weekly', 'daily' (default: 'all')
 *   - limit: Number of top donors to return (default: 10, max: 100)
 */
router.get('/donors', checkPermission(PERMISSIONS.STATS_READ), auditLeaderboardAccess, (req, res, next) => {
  try {
    const validation = validateLeaderboardQuery(req.query);
    
    if (validation.error) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: validation.error }
      });
    }

    const { period, limit } = validation;
    const leaderboard = StatsService.getDonorLeaderboard(period, limit);

    res.json({
      success: true,
      data: leaderboard,
      metadata: {
        period,
        limit,
        totalEntries: leaderboard.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leaderboard/recipients
 * Get top recipients leaderboard
 * Query params:
 *   - period: 'all', 'monthly', 'weekly', 'daily' (default: 'all')
 *   - limit: Number of top recipients to return (default: 10, max: 100)
 */
router.get('/recipients', checkPermission(PERMISSIONS.STATS_READ), auditLeaderboardAccess, (req, res, next) => {
  try {
    const validation = validateLeaderboardQuery(req.query);
    
    if (validation.error) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMETER', message: validation.error }
      });
    }

    const { period, limit } = validation;
    const leaderboard = StatsService.getRecipientLeaderboard(period, limit);

    res.json({
      success: true,
      data: leaderboard,
      metadata: {
        period,
        limit,
        totalEntries: leaderboard.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /leaderboard/stream
 * Server-Sent Events endpoint for real-time leaderboard updates
 * Clients can reconnect with Last-Event-ID to receive missed updates
 */
router.get('/stream', checkPermission(PERMISSIONS.STATS_READ), (req, res, next) => {
  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Generate unique client ID
    const clientId = uuidv4();
    const keyId = req.apiKey ? req.apiKey.id : 'anonymous';
    
    // Parse optional filters from query params
    const filter = {};
    if (req.query.period) {
      filter.period = req.query.period;
    }
    
    // Register SSE client
    const client = SseManager.addClient(clientId, keyId, filter, res);
    
    // Handle client disconnect
    req.on('close', () => {
      SseManager.removeClient(clientId);
      console.log(`[Leaderboard SSE] Client disconnected: ${clientId}`);
    });
    
    // Send initial connection message
    const initialData = {
      type: 'connection',
      clientId,
      message: 'Connected to leaderboard streaming',
      timestamp: new Date().toISOString()
    };
    
    SseManager.writeSseEvent(res, '1', 'leaderboard.connected', initialData);
    
    // Get missed events if client provides Last-Event-ID
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      const missedEvents = SseManager.getMissedEvents(lastEventId);
      missedEvents.forEach((event, index) => {
        SseManager.writeSseEvent(res, String(index + 2), event.event, event.data);
      });
    }
    
    // Send initial leaderboard data
    const periods = ['all', 'monthly', 'weekly', 'daily'];
    periods.forEach((period, index) => {
      const donors = StatsService.getDonorLeaderboard(period, 10);
      const recipients = StatsService.getRecipientLeaderboard(period, 10);
      
      SseManager.writeSseEvent(res, String(index + 100), 'leaderboard.update', {
        type: 'leaderboard',
        period,
        timestamp: new Date().toISOString(),
        donors,
        recipients
      });
    });
    
    console.log(`[Leaderboard SSE] Client connected: ${clientId}`);
  } catch (error) {
    console.error('[Leaderboard SSE] Error:', error.message);
    next(error);
  }
});

module.exports = router;