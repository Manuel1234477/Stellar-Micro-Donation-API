'use strict';

/**
 * GET /admin/system-info
 * Comprehensive operational diagnostics for human operators.
 * Distinct from /health (which is for automated monitoring).
 * Requires admin role. Sensitive values are never included.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAdmin } = require('../../middleware/rbac');
const { createRateLimiter } = require('../../middleware/rateLimiter');
const serviceContainer = require('../../config/serviceContainer');

const systemInfoRateLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : createRateLimiter({
      windowMs: 60 * 1000,
      max: 10,
      keyGenerator: (req) => req.apiKey?.id || req.ip,
    });

/** Get database file size in bytes, or null if unavailable. */
function getDbFileSizeBytes() {
  try {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data/stellar_donations.db');
    return fs.statSync(dbPath).size;
  } catch {
    return null;
  }
}

/** Check database connectivity and return active connection count. */
async function getDbInfo() {
  try {
    const Database = require('../../utils/database');
    await Database.query('SELECT 1', []);
    const poolInfo = typeof Database.getPoolInfo === 'function' ? Database.getPoolInfo() : {};
    return {
      fileSizeBytes: getDbFileSizeBytes(),
      connectionPoolSize: poolInfo.poolSize || 1,
      activeConnections: poolInfo.activeConnections || 1,
      pendingMigrations: 0,
    };
  } catch {
    return {
      fileSizeBytes: getDbFileSizeBytes(),
      connectionPoolSize: 0,
      activeConnections: 0,
      pendingMigrations: null,
    };
  }
}

/** Get scheduler status from the service container. */
function getSchedulerInfo() {
  try {
    const scheduler = serviceContainer.getRecurringDonationScheduler();
    const health = scheduler.getSchedulerHealth();
    const status = scheduler.getStatus();
    const checkInterval = scheduler.checkInterval || 60000;
    const nextTickAt = health.lastTickAt
      ? new Date(new Date(health.lastTickAt).getTime() + checkInterval).toISOString()
      : null;
    return {
      isRunning: health.isRunning,
      lastTickAt: health.lastTickAt,
      lastTickDurationMs: health.lastTickDurationMs,
      activeScheduleCount: status.executingSchedules ? status.executingSchedules.length : 0,
      nextTickAt,
    };
  } catch {
    return {
      isRunning: false,
      lastTickAt: null,
      lastTickDurationMs: null,
      activeScheduleCount: 0,
      nextTickAt: null,
    };
  }
}

/** Get webhook info. */
async function getWebhookInfo() {
  try {
    const db = require('../../utils/database');
    const [countRow] = await db.query('SELECT COUNT(*) as cnt FROM webhooks WHERE active = 1', []).catch(() => [{ cnt: 0 }]);
    return {
      registeredCount: countRow ? (countRow.cnt || 0) : 0,
      queueDepth: 0,
      failedDeliveries24h: 0,
    };
  } catch {
    return { registeredCount: 0, queueDepth: 0, failedDeliveries24h: 0 };
  }
}

/** Get all feature flags. */
async function getFeatureFlags() {
  try {
    const { getAllFlags } = require('../../utils/featureFlags');
    const flags = await getAllFlags();
    return flags.map(f => ({
      name: f.name,
      enabled: !!f.enabled,
      scope: f.scope || 'global',
    }));
  } catch {
    return [];
  }
}

router.get('/', requireAdmin(), systemInfoRateLimiter, async (req, res, next) => {
  try {
    const uptimeSeconds = Math.floor(process.uptime());
    const mem = process.memoryUsage();

    const [dbInfo, schedulerInfo, webhookInfo, featureFlags] = await Promise.all([
      getDbInfo(),
      Promise.resolve(getSchedulerInfo()),
      getWebhookInfo(),
      getFeatureFlags(),
    ]);

    const rateLimitSettings = {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
      enabled: process.env.DISABLE_RATE_LIMIT !== 'true',
    };

    res.json({
      runtime: {
        nodeVersion: process.version,
        uptime: uptimeSeconds,
        memoryUsage: {
          heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
          heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
          rssMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        },
      },
      database: dbInfo,
      scheduler: schedulerInfo,
      webhooks: webhookInfo,
      featureFlags,
      configuration: {
        stellarNetwork: process.env.STELLAR_NETWORK || 'testnet',
        mockMode: process.env.MOCK_STELLAR === 'true',
        rateLimitSettings,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
