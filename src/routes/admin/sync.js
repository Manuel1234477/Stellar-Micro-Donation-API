/**
 * Admin Transaction Sync Routes
 *
 * RESPONSIBILITY: Admin endpoints for manual and scheduled transaction synchronization
 * OWNER: Backend Team
 * DEPENDENCIES: ScheduledSyncService, Transaction model
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const log = require('../../utils/log');

// Global sync service instance (initialized in app.js)
let syncService = null;

/**
 * Initialize sync service for these routes
 * @param {ScheduledSyncService} service - The sync service instance
 */
function initializeSyncService(service) {
  syncService = service;
}

/**
 * GET /admin/sync/status
 * Returns current sync status and statistics for all wallets
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "isRunning": boolean,
 *     "isScheduled": boolean,
 *     "lastSyncAt": timestamp,
 *     "nextSyncAt": timestamp,
 *     "totalSynced": number,
 *     "walletsProcessed": number,
 *     "syncDurationMs": number,
 *     "successCount": number,
 *     "failureCount": number,
 *     "syncIntervalMinutes": number,
 *     "statistics": {
 *       "totalWallets": number,
 *       "syncedWallets": number,
 *       "unsyncedWallets": number,
 *       "neededSyncWallets": number,
 *       "averageSyncAgeMinutes": number
 *     }
 *   }
 * }
 */
router.get('/status', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    if (!syncService) {
      return res.status(503).json({
        success: false,
        error: 'Sync service not initialized'
      });
    }

    const status = syncService.getStatus();
    const statistics = syncService.getSyncStatistics();

    res.json({
      success: true,
      data: {
        ...status,
        statistics
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/sync/trigger
 * Manually trigger immediate synchronization of all wallets
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "walletsSync": number,
 *     "totalTransactions": number,
 *     "duration": string
 *   }
 * }
 */
router.post('/trigger', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    if (!syncService) {
      return res.status(503).json({
        success: false,
        error: 'Sync service not initialized'
      });
    }

    log.info('ADMIN_SYNC', 'Manual sync triggered by admin', {
      userId: req.user?.id
    });

    const result = await syncService.triggerManualSync();
    
    res.json({
      success: true,
      data: {
        ...result,
        duration: `${result.duration}ms`
      }
    });
  } catch (err) {
    if (err.message === 'Sync already in progress') {
      return res.status(409).json({
        success: false,
        error: 'Sync already in progress'
      });
    }
    next(err);
  }
});

/**
 * GET /admin/sync/config
 * Returns current sync configuration
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "syncIntervalMinutes": number,
 *     "isScheduled": boolean,
 *     "maxTransactionsPerWallet": number
 *   }
 * }
 */
router.get('/config', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    if (!syncService) {
      return res.status(503).json({
        success: false,
        error: 'Sync service not initialized'
      });
    }

    const config = {
      syncIntervalMinutes: syncService.syncIntervalMinutes,
      isScheduled: syncService.isScheduled,
      maxTransactionsPerWallet: 500 // Default from TransactionSyncService
    };

    res.json({
      success: true,
      data: config
    });
  } catch (err) {
    next(err);
  }
});

module.exports = {
  router,
  initializeSyncService
};
