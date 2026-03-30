/**
 * Startup Diagnostics Module
 * Provides comprehensive startup information for observability and debugging
 * 
 * This module logs a concise summary of:
 * - Environment mode and configuration
 * - Enabled features and services
 * - Network configuration
 * - System health indicators
 * 
 * No sensitive data (API keys, secrets, tokens) is logged
 */

const config = require('../config');
const log = require('./log');
const Database = require('./database');

/**
 * Get safe environment information (no sensitive data)
 */
const getEnvironmentInfo = () => {
  return {
    mode: config.server.env,
    isProduction: config.server.isProduction,
    isDevelopment: config.server.isDevelopment,
    isTest: config.server.isTest,
    port: config.server.port,
    apiPrefix: config.server.apiPrefix,
    version: config.app.version
  };
};

/**
 * Get enabled features information
 */
const getFeaturesInfo = () => {
  return {
    mockStellar: config.stellar.mockEnabled,
    debugMode: config.logging.debugMode,
    verboseLogging: config.logging.verbose,
    fileLogging: config.logging.toFile,
    rateLimiting: {
      enabled: config.rateLimit.maxRequests > 0,
      maxRequests: config.rateLimit.maxRequests,
      windowMs: config.rateLimit.windowMs
    },
    encryption: {
      enabled: !!config.encryption.key,
      requiredInProduction: config.encryption.requireInProduction
    }
  };
};

/**
 * Get network configuration (safe, no secrets)
 */
const getNetworkInfo = () => {
  const stellarNetwork = config.stellar.network;
  const horizonUrl = config.stellar.horizonUrl;
  
  return {
    stellar: {
      network: stellarNetwork,
      horizonUrl: sanitizeUrl(horizonUrl),
      mode: config.stellar.mockEnabled ? 'mock' : 'live'
    },
    database: {
      type: config.database.type,
      path: config.database.type === 'sqlite' 
        ? sanitizePath(config.database.path) 
        : 'configured'
    }
  };
};

/**
 * Get service status information
 */
const getServicesInfo = () => {
  return {
    apiKeys: {
      configured: config.apiKeys.legacy.length > 0,
      count: config.apiKeys.legacy.length // Count is safe to log
    },
    donationLimits: {
      minAmount: config.donations.minAmount,
      maxAmount: config.donations.maxAmount,
      maxDailyPerDonor: config.donations.maxDailyPerDonor
    }
  };
};

/**
 * Get system health indicators
 */
const getSystemHealth = () => {
  const health = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      used: formatBytes(process.memoryUsage().heapUsed),
      total: formatBytes(process.memoryUsage().heapTotal)
    },
    uptime: formatUptime(process.uptime())
  };

  // Check database connectivity (async, but we'll report the attempt)
  health.database = {
    status: 'checking',
    type: config.database.type
  };

  return health;
};

/**
 * Sanitize URL to remove sensitive parts
 */
const sanitizeUrl = (url) => {
  if (!url) return 'not configured';
  
  try {
    const parsed = new URL(url);
    // Remove credentials and query parameters
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid url';
  }
};

/**
 * Sanitize file path to remove sensitive information
 */
const sanitizePath = (path) => {
  if (!path) return 'not configured';
  
  // Only show filename and directory structure, not full path
  const parts = path.split('/');
  if (parts.length > 3) {
    return `.../${parts.slice(-2).join('/')}`;
  }
  return path;
};

/**
 * Format bytes to human readable format
 */
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format uptime to human readable format
 */
const formatUptime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

/**
 * Log comprehensive startup diagnostics
 */
const logStartupDiagnostics = async () => {
  const timestamp = new Date().toISOString();
  
  const diagnostics = {
    timestamp,
    application: {
      name: config.app.name,
      version: config.app.version
    },
    environment: getEnvironmentInfo(),
    features: getFeaturesInfo(),
    network: getNetworkInfo(),
    services: getServicesInfo(),
    system: getSystemHealth()
  };

  // Log the main startup summary
  log.info('STARTUP', '🚀 Stellar Micro Donation API starting', {
    environment: diagnostics.environment.mode,
    version: diagnostics.application.version,
    port: diagnostics.environment.port,
    network: diagnostics.network.stellar.mode,
    features: {
      mockStellar: diagnostics.features.mockStellar,
      debugMode: diagnostics.features.debugMode,
      rateLimiting: diagnostics.features.rateLimiting.enabled
    }
  });

  // Log detailed configuration (only in development or debug mode)
  if (config.server.isDevelopment || config.logging.debugMode) {
    log.info('STARTUP', '📋 Configuration summary', diagnostics);
  } else {
    // Production: log minimal safe information
    log.info('STARTUP', '📋 Production configuration', {
      environment: diagnostics.environment.mode,
      port: diagnostics.environment.port,
      network: diagnostics.network.stellar.network,
      features: {
        rateLimiting: diagnostics.features.rateLimiting.enabled,
        encryption: diagnostics.features.encryption.enabled
      },
      services: {
        apiKeys: diagnostics.services.apiKeys.configured
      }
    });
  }

  // Check database connectivity
  try {
    await Database.get('SELECT 1 as ok');
    log.info('STARTUP', '✅ Database connection successful');
  } catch (error) {
    log.error('STARTUP', '❌ Database connection failed', {
      error: error.message,
      type: config.database.type
    });
  }

  // Log startup completion
  log.info('STARTUP', '🎉 Startup complete', {
    port: diagnostics.environment.port,
    healthCheck: `http://localhost:${diagnostics.environment.port}/health`,
    environment: diagnostics.environment.mode
  });

  return diagnostics;
};

/**
 * Log shutdown diagnostics
 */
const logShutdownDiagnostics = (reason = 'SIGINT') => {
  log.info('SHUTDOWN', '🛑 Stellar Micro Donation API shutting down', {
    reason,
    uptime: formatUptime(process.uptime()),
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  logStartupDiagnostics,
  logShutdownDiagnostics,
  getEnvironmentInfo,
  getFeaturesInfo,
  getNetworkInfo,
  getServicesInfo,
  getSystemHealth
};
