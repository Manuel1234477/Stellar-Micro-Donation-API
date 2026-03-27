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
const TransactionSyncScheduler = require('../services/TransactionSyncScheduler');
const NetworkStatusService = require('../services/NetworkStatusService');
const FeeBumpService = require('../services/FeeBumpService');
const AuditLogService = require('../services/AuditLogService');
const RecipientPoolRepository = require('../services/RecipientPoolRepository');
const RoundRobinStateRepository = require('../services/RoundRobinStateRepository');
const RoutingDecisionRepository = require('../services/RoutingDecisionRepository');
const DonationTotalsRepository = require('../services/DonationTotalsRepository');
const DonationRouter = require('../services/DonationRouter');

class ServiceContainer {
  constructor(config = {}) {
    // Determine which stellar service to use based on environment
    const useMockStellar = config.useMockStellar || process.env.USE_MOCK_STELLAR === 'true' || process.env.MOCK_STELLAR === 'true';

    // Initialize Stellar Service (real or mock)
    this.stellarService = useMockStellar
      ? new MockStellarService(config.stellar)
      : new StellarService(config.stellar);

    // Initialize other services with their dependencies
    this.idempotencyService = IdempotencyService;

    this.recurringDonationScheduler = new RecurringDonationScheduler.Class(
      this.stellarService
    );

    this.transactionReconciliationService = new TransactionReconciliationService(
      this.stellarService
    );

    this.feeBumpService = new FeeBumpService(
      this.stellarService,
      AuditLogService,
      { feeSourceSecret: config.stellar?.serviceSecretKey }
    );

    this.transactionReconciliationService.setFeeBumpService(this.feeBumpService);

    this.transactionSyncService = new TransactionSyncService(
      this.stellarService
    );

    this.transactionSyncScheduler = new TransactionSyncScheduler(
      this.stellarService
    );

    // Initialize Network Status Service
    this.networkStatusService = new NetworkStatusService(this.stellarService);

    // Initialize routing repositories and DonationRouter
    this.recipientPoolRepo = new RecipientPoolRepository();
    this.roundRobinStateRepo = new RoundRobinStateRepository();
    this.routingDecisionRepo = new RoutingDecisionRepository();
    this.donationTotalsRepo = new DonationTotalsRepository();
    this.donationRouter = new DonationRouter({
      recipientPoolRepo: this.recipientPoolRepo,
      routingDecisionRepo: this.routingDecisionRepo,
      roundRobinStateRepo: this.roundRobinStateRepo,
      donationTotalsRepo: this.donationTotalsRepo,
    });
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

  getTransactionSyncScheduler() {
    return this.transactionSyncScheduler;
  }

  getNetworkStatusService() {
    return this.networkStatusService;
  }

  getFeeBumpService() {
    return this.feeBumpService;
  }

  getRecipientPoolRepo() {
    return this.recipientPoolRepo;
  }

  getRoundRobinStateRepo() {
    return this.roundRobinStateRepo;
  }

  getRoutingDecisionRepo() {
    return this.routingDecisionRepo;
  }

  getDonationTotalsRepo() {
    return this.donationTotalsRepo;
  }

  getDonationRouter() {
    return this.donationRouter;
  }
}

const appConfig = require('./index');

let _instance = null;

function getInstance() {
  if (!_instance) {
    _instance = new ServiceContainer({
      useMockStellar: appConfig.stellar.mockEnabled,
      stellar: {
        ...appConfig.stellar,
        serviceSecretKey: appConfig.stellar.serviceSecretKey || process.env.STELLAR_SECRET || process.env.SERVICE_SECRET_KEY || null,
      },
    });
  }
  return _instance;
}

// Proxy that delegates to lazy instance
module.exports = new Proxy({}, {
  get(_, prop) {
    return typeof getInstance()[prop] === 'function'
      ? getInstance()[prop].bind(getInstance())
      : getInstance()[prop];
  }
});
