/**
 * Startup Diagnostics Module
 * Provides comprehensive startup information for observability and debugging
 *
 * Emits a single structured JSON log entry at INFO level on every startup containing:
 * - Node.js version, application version (from package.json)
 * - Active feature flags, configured Stellar network, MOCK_STELLAR state
 * - Rate limit configuration, CORS allowed origins count
 * - Database file path and size, uptime since process start
 *
 * Also exposes buildStartupReport() for on-demand use by GET /admin/startup-report.
 * Sensitive values (keys, passwords) are masked via dataMasker.
 *
 * No sensitive data (API keys, secrets, tokens) is logged.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('./log');
const Database = require('./database');
const { maskSensitiveData } = require('./dataMasker');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read application version from package.json (one directory above /src).
 * Falls back to 'unknown' if package.json is missing or unreadable.
 */
function getAppVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Get the database file size in bytes.
 * Returns null if the path is unavailable or non-SQLite.
 * @param {string} dbPath
 * @returns {number|null}
 */
function getDbFileSize(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') return null;
  try {
    const stat = fs.statSync(dbPath);
    return stat.size;
  } catch {
    return null;
  }
}

/**
 * Collect currently active feature flags from the database (best-effort).
 * Returns an empty object on any error so we never block startup.
 * @returns {Promise<Object>}
 */
async function getActiveFeatureFlags() {
  try {
    const rows = await Database.all(
      `SELECT name, value FROM feature_flags WHERE enabled = 1 ORDER BY name`
    );
    const flags = {};
    for (const row of rows) {
      flags[row.name] = row.value !== undefined ? row.value : true;
    }
    return flags;
  } catch {
    return {};
  }
}

/**
 * Count configured CORS allowed origins from the env var.
 * @returns {number}
 */
function getCorsOriginCount() {
  const raw = process.env.CORS_ALLOWED_ORIGINS || '';
  if (!raw.trim()) return 0;
  return raw.split(',').map(s => s.trim()).filter(Boolean).length;
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format uptime seconds to human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/**
 * Sanitize a URL to remove credentials / query strings.
 * @param {string} url
 * @returns {string}
 */
function sanitizeUrl(url) {
  if (!url) return 'not configured';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid url';
  }
}

// ── Core report builder ───────────────────────────────────────────────────────

/**
 * Build a complete, structured startup diagnostics report.
 *
 * This is the canonical report shape consumed by both:
 *   - logStartupDiagnostics()   (emitted to the log at startup)
 *   - GET /admin/startup-report (returned on demand)
 *
 * Sensitive fields are masked before the object leaves this function.
 *
 * @returns {Promise<Object>} The masked diagnostics report.
 */
async function buildStartupReport() {
  const uptimeSeconds = process.uptime();
  const dbPath = config.database && config.database.path
    ? config.database.path
    : (process.env.DB_PATH || './donations.db');
  const dbSize = getDbFileSize(dbPath);
  const activeFlags = await getActiveFeatureFlags();

  const report = {
    generatedAt: new Date().toISOString(),
    uptimeSinceStart: formatUptime(uptimeSeconds),
    uptimeSeconds: Math.floor(uptimeSeconds),

    application: {
      name: (config.app && config.app.name) || 'stellar-micro-donation-api',
      version: getAppVersion(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },

    environment: {
      mode: config.server.env,
      isProduction: config.server.isProduction,
      isDevelopment: config.server.isDevelopment,
      isTest: config.server.isTest,
      port: config.server.port,
      apiPrefix: config.server.apiPrefix,
    },

    stellar: {
      network: config.stellar.network,
      mockEnabled: config.stellar.mockEnabled,
      horizonUrl: sanitizeUrl(config.stellar.horizonUrl),
      mode: config.stellar.mockEnabled ? 'mock' : 'live',
    },

    featureFlags: {
      active: activeFlags,
      count: Object.keys(activeFlags).length,
    },

    rateLimiting: {
      enabled: config.rateLimit && config.rateLimit.maxRequests > 0,
      maxRequests: config.rateLimit ? config.rateLimit.maxRequests : null,
      windowMs: config.rateLimit ? config.rateLimit.windowMs : null,
    },

    cors: {
      allowedOriginsCount: getCorsOriginCount(),
    },

    database: {
      type: (config.database && config.database.type) || 'sqlite',
      path: dbPath,
      sizeBytes: dbSize,
      sizeHuman: dbSize !== null ? formatBytes(dbSize) : 'unavailable',
    },

    services: {
      apiKeys: {
        legacyKeysConfigured: config.apiKeys && config.apiKeys.legacy
          ? config.apiKeys.legacy.length > 0
          : false,
        legacyKeyCount: config.apiKeys && config.apiKeys.legacy
          ? config.apiKeys.legacy.length
          : 0,
      },
      encryption: {
        enabled: !!(config.encryption && config.encryption.key),
        kmsConfigured: !!(process.env.KMS_PROVIDER || process.env.KMS_KEY_ID),
        hsmConfigured: !!(process.env.HSM_SLOT_ID),
      },
      donationLimits: {
        minAmount: config.donations ? config.donations.minAmount : null,
        maxAmount: config.donations ? config.donations.maxAmount : null,
        maxDailyPerDonor: config.donations ? config.donations.maxDailyPerDonor : null,
      },
    },

    memory: {
      heapUsed: formatBytes(process.memoryUsage().heapUsed),
      heapTotal: formatBytes(process.memoryUsage().heapTotal),
      rss: formatBytes(process.memoryUsage().rss),
    },

    logging: {
      debugMode: config.logging ? config.logging.debugMode : false,
      verbose: config.logging ? config.logging.verbose : false,
      toFile: config.logging ? config.logging.toFile : false,
    },
  };

  // Mask any sensitive fields that may have leaked into nested structures
  return maskSensitiveData(report);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Emit a single structured JSON startup diagnostics entry at INFO level.
 * Always emits — regardless of DEBUG_MODE or log level — so operators always
 * have a startup snapshot in production logs.
 *
 * @returns {Promise<Object>} The diagnostics report that was logged.
 */
async function logStartupDiagnostics() {
  const report = await buildStartupReport();

  // Always log at info level so it appears regardless of log-level config
  log.info('STARTUP_DIAGNOSTICS', 'Structured startup diagnostics report', report);

  // Also log the brief human-readable summary for quick scanning
  log.info('STARTUP', '🚀 Stellar Micro Donation API starting', {
    environment: report.environment.mode,
    version: report.application.version,
    nodeVersion: report.application.nodeVersion,
    port: report.environment.port,
    network: report.stellar.mode,
    featureFlagsActive: report.featureFlags.count,
    dbSize: report.database.sizeHuman,
    uptime: report.uptimeSinceStart,
  });

  // Check database connectivity
  try {
    await Database.get('SELECT 1 as ok');
    log.info('STARTUP', '✅ Database connection successful');
  } catch (error) {
    log.error('STARTUP', '❌ Database connection failed', {
      error: error.message,
      type: report.database.type,
    });
  }

  log.info('STARTUP', '🎉 Startup complete', {
    port: report.environment.port,
    healthCheck: `http://localhost:${report.environment.port}/health`,
    environment: report.environment.mode,
  });

  return report;
}

/**
 * Log shutdown diagnostics entry.
 * @param {string} [reason='SIGINT']
 */
function logShutdownDiagnostics(reason = 'SIGINT') {
  log.info('SHUTDOWN', '🛑 Stellar Micro Donation API shutting down', {
    reason,
    uptime: formatUptime(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}

// ── Legacy helpers kept for backward-compatibility ────────────────────────────

const getEnvironmentInfo = () => ({
  mode: config.server.env,
  isProduction: config.server.isProduction,
  isDevelopment: config.server.isDevelopment,
  isTest: config.server.isTest,
  port: config.server.port,
  apiPrefix: config.server.apiPrefix,
  version: config.app ? config.app.version : getAppVersion(),
});

const getFeaturesInfo = () => ({
  mockStellar: config.stellar.mockEnabled,
  debugMode: config.logging ? config.logging.debugMode : false,
  verboseLogging: config.logging ? config.logging.verbose : false,
  fileLogging: config.logging ? config.logging.toFile : false,
  rateLimiting: {
    enabled: config.rateLimit && config.rateLimit.maxRequests > 0,
    maxRequests: config.rateLimit ? config.rateLimit.maxRequests : null,
    windowMs: config.rateLimit ? config.rateLimit.windowMs : null,
  },
  encryption: {
    enabled: !!(config.encryption && config.encryption.key),
    requiredInProduction: config.encryption ? config.encryption.requireInProduction : false,
  },
  kms: {
    providerConfigured: !!process.env.KMS_PROVIDER,
    keyConfigured: !!process.env.KMS_KEY_ID,
  },
  hsm: {
    slotConfigured: !!process.env.HSM_SLOT_ID,
    pinConfigured: !!process.env.HSM_PIN,
  },
});

const getNetworkInfo = () => ({
  stellar: {
    network: config.stellar.network,
    horizonUrl: sanitizeUrl(config.stellar.horizonUrl),
    mode: config.stellar.mockEnabled ? 'mock' : 'live',
  },
  database: {
    type: (config.database && config.database.type) || 'sqlite',
    path: (config.database && config.database.path) || 'configured',
  },
});

const getServicesInfo = () => ({
  apiKeys: {
    configured: config.apiKeys && config.apiKeys.legacy
      ? config.apiKeys.legacy.length > 0
      : false,
    count: config.apiKeys && config.apiKeys.legacy
      ? config.apiKeys.legacy.length
      : 0,
  },
  donationLimits: {
    minAmount: config.donations ? config.donations.minAmount : null,
    maxAmount: config.donations ? config.donations.maxAmount : null,
    maxDailyPerDonor: config.donations ? config.donations.maxDailyPerDonor : null,
  },
});

const getSystemHealth = () => ({
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  memory: {
    used: formatBytes(process.memoryUsage().heapUsed),
    total: formatBytes(process.memoryUsage().heapTotal),
  },
  uptime: formatUptime(process.uptime()),
  database: {
    status: 'checking',
    type: (config.database && config.database.type) || 'sqlite',
  },
});

module.exports = {
  buildStartupReport,
  logStartupDiagnostics,
  logShutdownDiagnostics,
  // Legacy exports (backward-compat)
  getEnvironmentInfo,
  getFeaturesInfo,
  getNetworkInfo,
  getServicesInfo,
  getSystemHealth,
};
