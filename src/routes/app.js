const express = require('express');
const config = require('../config/stellar');
const donationRoutes = require('./donation');
const walletRoutes = require('./wallet');
const statsRoutes = require('./stats');
const streamRoutes = require('./stream');
const recurringDonationScheduler = require('../services/RecurringDonationScheduler');
const logger = require('../middleware/logger');

const app = express();

// Middleware
app.use(express.json());

// Request/Response logging middleware
app.use(logger.middleware());

// Routes
app.use('/donations', donationRoutes);
app.use('/wallets', walletRoutes);
app.use('/stats', statsRoutes);
app.use('/stream', streamRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    network: config.network
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

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
