const express = require('express');
const config = require('../config/stellar');
const { rateLimitConfig } = require('../config/rateLimit');
const donationRoutes = require('./donation');
const statsRoutes = require('./stats');
const walletRoutes = require('./wallet');

const app = express();

// Middleware
app.use(express.json());

// Rate limiting is applied per-route in donation.js
// Configuration loaded from environment variables:
// - RATE_LIMIT_MAX_REQUESTS (default: 100)
// - RATE_LIMIT_WINDOW_MS (default: 60000)
// - RATE_LIMIT_CLEANUP_INTERVAL_MS (default: 300000)
console.log(`Rate limiting configured: ${rateLimitConfig.limit} requests per ${rateLimitConfig.windowMs}ms`);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/donations', donationRoutes);
app.use('/stats', statsRoutes);
app.use('/wallets', walletRoutes);

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

// Error handler
app.use((err, req, res) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Stellar Micro-Donation API running on port ${PORT}`);
  console.log(`Network: ${config.network}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
