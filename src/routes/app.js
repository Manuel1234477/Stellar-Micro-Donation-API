const express = require('express');
const config = require('../config/stellar');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const recurringDonationScheduler = require('../services/RecurringDonationScheduler');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const logger = require('../middleware/logger');
const { attachUserRole } = require('../middleware/rbacMiddleware');
const Database = require('../utils/database');

const app = express();

// Middleware
app.use(express.json());

// Request/Response logging middleware
app.use(logger.middleware());

// Attach user role from authentication (must be before routes)
app.use(attachUserRole());

// Routes
app.use('/donations', donationRoutes);
app.use('/wallets', walletRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);

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

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection]', {
    reason,
    promise,
    timestamp: new Date().toISOString()
  });
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Stellar Micro-Donation API running on port ${PORT}`);
  console.log(`Network: ${config.network}`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  // Start the recurring donation scheduler
  recurringDonationScheduler.start();
});

module.exports = app;
