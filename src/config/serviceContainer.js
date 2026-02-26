/**
 * Service Container - Dependency Injection Layer
 * 
 * RESPONSIBILITY: Centralized service initialization and dependency management
 * OWNER: Platform Team
 * DEPENDENCIES: All core services (Stellar, Scheduler, Reconciliation, etc.)
 * 
 * Implements dependency injection pattern for service lifecycle management.
 * Provides singleton instances of services with proper initialization order.
 */

const StellarService = require('../services/StellarService');
const MockStellarService = require('../services/MockStellarService');
const RecurringDonationScheduler = require('../services/RecurringDonationScheduler');
const TransactionReconciliationService = require('../services/TransactionReconciliationService');
const IdempotencyService = require('../services/IdempotencyService');
const TransactionSyncService = require('../services/TransactionSyncService');

class ServiceContainer {
  constructor(config = {}) {
    // Determine which stellar service to use based on environment
    const useMockStellar = config.useMockStellar || process.env.USE_MOCK_STELLAR === 'true';

    // Initialize Stellar Service (real or mock)
    this.stellarService = useMockStellar
      ? new MockStellarService(config.stellar)
      : new StellarService(config.stellar);

    // Initialize other services with their dependencies
    this.idempotencyService = new IdempotencyService();

    this.recurringDonationScheduler = new RecurringDonationScheduler(
      this.stellarService
    );

    this.transactionReconciliationService = new TransactionReconciliationService(
      this.stellarService
    );

    this.transactionSyncService = new TransactionSyncService(
      this.stellarService
    );
  }

  getStellarService() {
    return this.stellarService;
  }

  getIdempotencyService() {
    return this.idempotencyService;
  }

  getRecurringDonationScheduler() {
    return this.recurringDonationScheduler;
  }

  getTransactionReconciliationService() {
    return this.transactionReconciliationService;
  }

  getTransactionSyncService() {
    return this.transactionSyncService;
  }
}

module.exports = new ServiceContainer({
  useMockStellar: process.env.USE_MOCK_STELLAR === 'true',
  stellar: {
    network: process.env.STELLAR_NETWORK || 'testnet',
    horizonUrl: process.env.HORIZON_URL
  }
});
