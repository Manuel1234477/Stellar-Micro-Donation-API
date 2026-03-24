/**
 * Network Status Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for network status operations
 * OWNER: Backend Team
 * DEPENDENCIES: NetworkStatusService, middleware (auth, RBAC)
 *
 * Provides endpoints for monitoring Stellar network health and managing
 * transaction queues during network outages.
 */

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

/**
 * GET /network/status
 * Get current Stellar network status and metrics
 * 
 * @returns {Object} Network status with metrics
 */
router.get('/status', async (req, res, next) => {
  try {
    const networkStatusService = require('../config/serviceContainer').getNetworkStatusService();
    
    if (!networkStatusService) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'NETWORK_STATUS_UNAVAILABLE',
          message: 'Network status service not initialized',
        },
      });
    }

    const status = networkStatusService.getStatus();

    res.json({
      success: true,
      data: {
        status: status.status,
        isHealthy: status.isHealthy,
        isDegraded: status.isDegraded,
        isOutage: status.isOutage,
        metrics: status.metrics,
        lastCheckTime: status.lastCheckTime,
        consecutiveFailures: status.consecutiveFailures,
        feeMultiplier: networkStatusService.getFeeMultiplier(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('NETWORK_ROUTES', 'Failed to get network status', {
      error: err.message,
      requestId: req.id,
    });
    next(err);
  }
});

/**
 * GET /network/queue
 * Get queued transactions (admin only)
 * 
 * @query {string} [status] - Optional status filter (pending, submitted, failed)
 * @returns {Array} Queued transactions
 */
router.get('/queue', requireAdmin(), async (req, res, next) => {
  try {
    const { status } = req.query;

    // Validate status if provided
    if (status && !['pending', 'submitted', 'failed'].includes(status)) {
      throw new ValidationError('Invalid status filter', {
        code: ERROR_CODES.INVALID_REQUEST,
        field: 'status',
        value: status,
      });
    }

    const networkStatusService = require('../config/serviceContainer').getNetworkStatusService();
    
    if (!networkStatusService) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'NETWORK_STATUS_UNAVAILABLE',
          message: 'Network status service not initialized',
        },
      });
    }

    const queuedTransactions = await networkStatusService.getQueuedTransactions(status);

    res.json({
      success: true,
      data: {
        count: queuedTransactions.length,
        transactions: queuedTransactions,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('NETWORK_ROUTES', 'Failed to get queued transactions', {
      error: err.message,
      requestId: req.id,
    });
    next(err);
  }
});

/**
 * POST /network/queue/:queueId/retry
 * Retry a queued transaction (admin only)
 * 
 * @param {string} queueId - Queue ID
 * @returns {Object} Updated transaction
 */
router.post('/queue/:queueId/retry', requireAdmin(), async (req, res, next) => {
  try {
    const { queueId } = req.params;

    if (!queueId || typeof queueId !== 'string' || queueId.trim().length === 0) {
      throw new ValidationError('Invalid queue ID', {
        code: ERROR_CODES.INVALID_REQUEST,
        field: 'queueId',
      });
    }

    const networkStatusService = require('../config/serviceContainer').getNetworkStatusService();
    
    if (!networkStatusService) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'NETWORK_STATUS_UNAVAILABLE',
          message: 'Network status service not initialized',
        },
      });
    }

    // Get the queued transaction
    const queuedTransactions = await networkStatusService.getQueuedTransactions();
    const transaction = queuedTransactions.find(t => t.queue_id === queueId);

    if (!transaction) {
      throw new ValidationError('Queued transaction not found', {
        code: ERROR_CODES.NOT_FOUND,
        field: 'queueId',
        value: queueId,
      });
    }

    // Update status to submitted
    await networkStatusService.updateQueuedTransactionStatus(queueId, 'submitted');

    log.info('NETWORK_ROUTES', 'Queued transaction retry initiated', {
      queueId,
      requestId: req.id,
    });

    res.json({
      success: true,
      data: {
        queueId,
        status: 'submitted',
        message: 'Transaction retry initiated',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('NETWORK_ROUTES', 'Failed to retry queued transaction', {
      error: err.message,
      queueId: req.params.queueId,
      requestId: req.id,
    });
    next(err);
  }
});

module.exports = router;
