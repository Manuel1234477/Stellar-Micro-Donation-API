const express = require('express');
const config = require('../config/stellar');
const { rateLimitConfig } = require('../config/rateLimit');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const transactionRoutes = require('./transaction');
const apiKeysRoutes = require('./apiKeys');
const recurringDonationScheduler = require('../services/RecurringDonationScheduler');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const logger = require('../middleware/logger');
const { attachUserRole } = require('../middleware/rbac');
const abuseDetectionMiddleware = require('../middleware/abuseDetection');
const Database = require('../utils/database');
const { initializeApiKeysTable } = require('../models/apiKeys');
const log = require('../utils/log');
const requestId = require('../middleware/requestId');

const app = express();

// Middleware
app.use(express.json());
app.use(requestId);

// Request/Response logging middleware
app.use(logger.middleware());

// Abuse detection (observability only - no blocking)
app.use(abuseDetectionMiddleware);

// Attach user role from authentication (must be before routes)
app.use(attachUserRole());

// Routes
app.use('/donations', donationRoutes);
app.use('/wallets', walletRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);
app.use('/transactions', transactionRoutes);
app.use('/api-keys', apiKeysRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await Database.get('SELECT 1 as ok');

    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: 'ok'
      }
    });
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: 'unavailable'
      }
    });
  }
});

// Abuse detection stats endpoint (admin only)
app.get('/abuse-signals', require('../middleware/rbac').requireAdmin(), (req, res) => {
  const abuseDetector = require('../utils/abuseDetector');
  
  res.json({
    success: true,
    data: abuseDetector.getStats(),
    timestamp: new Date().toISOString()
  });
});

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error('APP', 'Unhandled promise rejection', {
    reason,
    promise,
    timestamp: new Date().toISOString()
  });
});

const PORT = config.port;

// Initialize API keys table before starting server
async function startServer() {
  try {
    await initializeApiKeysTable();
    log.info('APP', 'API keys table initialized');
  } catch (error) {
    log.error('APP', 'Failed to initialize API keys table', { error: error.message });
  }

  app.listen(PORT, () => {
    log.info('APP', 'Stellar Micro-Donation API running', { port: PORT });
    log.info('APP', 'Active network configured', { network: config.network });
    log.info('APP', 'Health check endpoint ready', { url: `http://localhost:${PORT}/health` });
    
    if (log.isDebugMode) {
      log.debug('APP', 'Debug mode enabled - verbose logging active');
      log.debug('APP', 'Configuration loaded', {
        port: PORT,
        network: config.network,
        horizonUrl: config.horizonUrl,
        mockStellar: process.env.MOCK_STELLAR === 'true',
        nodeEnv: process.env.NODE_ENV
      });
    }

    // Start the recurring donation scheduler
    recurringDonationScheduler.start();
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
