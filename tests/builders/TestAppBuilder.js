/**
 * Test App Builder - Test Data Builder
 * 
 * RESPONSIBILITY: Simplifies Express test app creation with middleware configuration
 * OWNER: QA/Testing Team
 * 
 * Provides fluent API for creating configured Express apps for integration tests.
 */

const express = require('express');

class TestAppBuilder {
  constructor() {
    this.middlewares = [];
    this.routes = [];
    this.errorHandler = null;
    this.includeDefaultMiddleware = true;
  }

  /**
   * Add custom middleware
   * @param {Function} middleware
   * @returns {TestAppBuilder}
   */
  withMiddleware(middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add route
   * @param {string} path
   * @param {Router} router
   * @returns {TestAppBuilder}
   */
  withRoute(path, router) {
    this.routes.push({ path, router });
    return this;
  }

  /**
   * Set custom error handler
   * @param {Function} handler
   * @returns {TestAppBuilder}
   */
  withErrorHandler(handler) {
    this.errorHandler = handler;
    return this;
  }

  /**
   * Skip default middleware (json, urlencoded)
   * @returns {TestAppBuilder}
   */
  withoutDefaultMiddleware() {
    this.includeDefaultMiddleware = false;
    return this;
  }

  /**
   * Build and return the Express app
   * @returns {Express}
   */
  build() {
    const app = express();

    // Add default middleware
    if (this.includeDefaultMiddleware) {
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));
    }

    // Add custom middleware
    this.middlewares.forEach(middleware => {
      app.use(middleware);
    });

    // Add routes
    this.routes.forEach(({ path, router }) => {
      app.use(path, router);
    });

    // Add error handler
    if (this.errorHandler) {
      app.use(this.errorHandler);
    } else {
      // Default error handler
      app.use((err, req, res, next) => {
        void next;
        res.status(err.status || 500).json({
          success: false,
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'Internal server error'
          }
        });
      });
    }

    return app;
  }

  /**
   * Create app with donation routes
   * @returns {Express}
   */
  static forDonationRoutes() {
    const donationRouter = require('../../src/routes/donation');
    const { attachUserRole } = require('../../src/middleware/rbac');

    return new TestAppBuilder()
      .withMiddleware(attachUserRole())
      .withRoute('/donations', donationRouter)
      .build();
  }

  /**
   * Create app with wallet routes
   * @returns {Express}
   */
  static forWalletRoutes() {
    const walletRouter = require('../../src/routes/wallet');
    const { attachUserRole } = require('../../src/middleware/rbac');

    return new TestAppBuilder()
      .withMiddleware(attachUserRole())
      .withRoute('/wallets', walletRouter)
      .build();
  }

  /**
   * Create app with stats routes
   * @returns {Express}
   */
  static forStatsRoutes() {
    const statsRouter = require('../../src/routes/stats');
    const { attachUserRole } = require('../../src/middleware/rbac');

    return new TestAppBuilder()
      .withMiddleware(attachUserRole())
      .withRoute('/stats', statsRouter)
      .build();
  }

  /**
   * Create app with all routes
   * @returns {Express}
   */
  static withAllRoutes() {
    const donationRouter = require('../../src/routes/donation');
    const walletRouter = require('../../src/routes/wallet');
    const statsRouter = require('../../src/routes/stats');
    const streamRouter = require('../../src/routes/stream');
    const transactionRouter = require('../../src/routes/transaction');
    const apiKeysRouter = require('../../src/routes/apiKeys');
    const { attachUserRole } = require('../../src/middleware/rbac');

    return new TestAppBuilder()
      .withMiddleware(attachUserRole())
      .withRoute('/donations', donationRouter)
      .withRoute('/wallets', walletRouter)
      .withRoute('/stats', statsRouter)
      .withRoute('/stream', streamRouter)
      .withRoute('/transactions', transactionRouter)
      .withRoute('/api-keys', apiKeysRouter)
      .build();
  }
}

module.exports = TestAppBuilder;
