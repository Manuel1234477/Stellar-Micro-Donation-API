/**
 * Network Status Service - Stellar Network Health Monitoring
 *
 * RESPONSIBILITY: Monitor Stellar network health and adjust API behavior accordingly
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Database
 *
 * Polls Horizon status every 30 seconds, tracks network health metrics,
 * queues transactions during outages, and adjusts fee estimates during congestion.
 */

const log = require('../utils/log');
const Database = require('../utils/database');

const POLL_INTERVAL_MS = 30000; // 30 seconds
const NETWORK_OUTAGE_THRESHOLD = 3; // 3 consecutive failures = outage
const HIGH_CONGESTION_FEE_MULTIPLIER = 1.5; // 50% fee increase during congestion
const QUEUE_RETENTION_MS = 3600000; // 1 hour retention for queued transactions

/**
 * Network status states
 */
const NETWORK_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  OUTAGE: 'outage',
};

/**
 * Transaction queue states
 */
const QUEUE_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  FAILED: 'failed',
};

class NetworkStatusService {
  /**
   * Create a new NetworkStatusService instance
   * @param {Object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    this.stellarService = stellarService;
    this.status = NETWORK_STATUS.HEALTHY;
    this.lastCheckTime = null;
    this.consecutiveFailures = 0;
    this.metrics = {
      ledgerCloseTime: null,
      operationFeeStats: null,
      baseReserve: null,
      lastUpdate: null,
    };
    this.pollingInterval = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the service and start polling
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create transaction queue table if it doesn't exist
      await this._createQueueTable();
      
      // Perform initial health check
      await this.checkNetworkHealth();
      
      // Start polling
      this._startPolling();
      
      this.isInitialized = true;
      log.info('NETWORK_STATUS', 'NetworkStatusService initialized', {
        initialStatus: this.status,
      });
    } catch (err) {
      log.error('NETWORK_STATUS', 'Failed to initialize NetworkStatusService', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Shutdown the service and stop polling
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isInitialized = false;
    log.info('NETWORK_STATUS', 'NetworkStatusService shutdown');
  }

  /**
   * Check Stellar network health by querying Horizon
   * @returns {Promise<void>}
   */
  async checkNetworkHealth() {
    try {
      const startTime = Date.now();
      
      // Query Horizon for network metrics
      const metrics = await this._fetchNetworkMetrics();
      
      // Update metrics
      this.metrics = {
        ledgerCloseTime: metrics.ledgerCloseTime,
        operationFeeStats: metrics.operationFeeStats,
        baseReserve: metrics.baseReserve,
        lastUpdate: new Date().toISOString(),
      };

      // Determine network status based on metrics
      const previousStatus = this.status;
      this._updateNetworkStatus(metrics);
      
      // Reset consecutive failures on success
      this.consecutiveFailures = 0;
      this.lastCheckTime = new Date().toISOString();

      // Log status changes
      if (previousStatus !== this.status) {
        log.warn('NETWORK_STATUS', 'Network status changed', {
          from: previousStatus,
          to: this.status,
          metrics: this.metrics,
        });
      }

      const responseTime = Date.now() - startTime;
      log.debug('NETWORK_STATUS', 'Network health check completed', {
        status: this.status,
        responseTime,
      });
    } catch (err) {
      this.consecutiveFailures++;
      log.warn('NETWORK_STATUS', 'Network health check failed', {
        error: err.message,
        consecutiveFailures: this.consecutiveFailures,
      });

      // Transition to outage if threshold exceeded
      if (this.consecutiveFailures >= NETWORK_OUTAGE_THRESHOLD) {
        const previousStatus = this.status;
        this.status = NETWORK_STATUS.OUTAGE;
        
        if (previousStatus !== this.status) {
          log.error('NETWORK_STATUS', 'Network outage detected', {
            consecutiveFailures: this.consecutiveFailures,
          });
        }
      }
    }
  }

  /**
   * Fetch network metrics from Horizon
   * @private
   * @returns {Promise<Object>} Network metrics
   */
  async _fetchNetworkMetrics() {
    // For real StellarService, query Horizon
    if (this.stellarService.server && typeof this.stellarService.server.root === 'function') {
      const root = await this.stellarService.server.root();
      
      return {
        ledgerCloseTime: root.core_latest_ledger_close_time,
        operationFeeStats: root.operation_fee_stats,
        baseReserve: root.base_reserve_in_stroops,
      };
    }

    // For MockStellarService, return simulated metrics
    return {
      ledgerCloseTime: Date.now(),
      operationFeeStats: {
        last_ledger: 1000,
        last_ledger_base_fee: 100,
        ledger_capacity_usage: 0.5,
        max_fee: {
          p99: 1000,
          p95: 500,
          p90: 300,
          p75: 200,
          p50: 100,
          p25: 100,
          p10: 100,
          p1: 100,
        },
      },
      baseReserve: 5000000, // 0.5 XLM in stroops
    };
  }

  /**
   * Update network status based on metrics
   * @private
   * @param {Object} metrics - Network metrics
   */
  _updateNetworkStatus(metrics) {
    // Check for high congestion (p99 fee > 500 stroops)
    const p99Fee = metrics.operationFeeStats?.max_fee?.p99 || 100;
    const ledgerCapacityUsage = metrics.operationFeeStats?.ledger_capacity_usage || 0;

    if (p99Fee > 500 || ledgerCapacityUsage > 0.8) {
      this.status = NETWORK_STATUS.DEGRADED;
    } else {
      this.status = NETWORK_STATUS.HEALTHY;
    }
  }

  /**
   * Get current network status
   * @returns {Object} Current network status and metrics
   */
  getStatus() {
    return {
      status: this.status,
      metrics: this.metrics,
      lastCheckTime: this.lastCheckTime,
      consecutiveFailures: this.consecutiveFailures,
      isHealthy: this.status === NETWORK_STATUS.HEALTHY,
      isDegraded: this.status === NETWORK_STATUS.DEGRADED,
      isOutage: this.status === NETWORK_STATUS.OUTAGE,
    };
  }

  /**
   * Get adjusted fee multiplier based on network status
   * @returns {number} Fee multiplier (1.0 = normal, 1.5 = high congestion)
   */
  getFeeMultiplier() {
    if (this.status === NETWORK_STATUS.DEGRADED) {
      return HIGH_CONGESTION_FEE_MULTIPLIER;
    }
    return 1.0;
  }

  /**
   * Queue a transaction for later submission during network outage
   * @param {Object} transaction - Transaction data to queue
   * @returns {Promise<string>} Queue ID
   */
  async queueTransaction(transaction) {
    if (this.status !== NETWORK_STATUS.OUTAGE) {
      throw new Error('Transactions can only be queued during network outages');
    }

    const queueId = require('uuid').v4();
    const enqueuedAt = new Date().toISOString();

    try {
      await Database.run(
        `INSERT INTO network_transaction_queue 
         (queue_id, transaction_data, status, enqueued_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          queueId,
          JSON.stringify(transaction),
          QUEUE_STATUS.PENDING,
          enqueuedAt,
          enqueuedAt,
        ]
      );

      log.info('NETWORK_STATUS', 'Transaction queued during outage', {
        queueId,
        transactionType: transaction.type,
      });

      return queueId;
    } catch (err) {
      log.error('NETWORK_STATUS', 'Failed to queue transaction', {
        error: err.message,
        queueId,
      });
      throw err;
    }
  }

  /**
   * Get queued transactions
   * @param {string} [status] - Optional status filter
   * @returns {Promise<Array>} Queued transactions
   */
  async getQueuedTransactions(status = null) {
    try {
      let query = 'SELECT * FROM network_transaction_queue WHERE 1=1';
      const params = [];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      query += ' ORDER BY enqueued_at ASC';

      const rows = await Database.all(query, params);
      return rows.map(row => ({
        ...row,
        transaction_data: JSON.parse(row.transaction_data),
      }));
    } catch (err) {
      log.error('NETWORK_STATUS', 'Failed to fetch queued transactions', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Update queued transaction status
   * @param {string} queueId - Queue ID
   * @param {string} newStatus - New status
   * @returns {Promise<void>}
   */
  async updateQueuedTransactionStatus(queueId, newStatus) {
    try {
      await Database.run(
        'UPDATE network_transaction_queue SET status = ?, updated_at = ? WHERE queue_id = ?',
        [newStatus, new Date().toISOString(), queueId]
      );

      log.debug('NETWORK_STATUS', 'Queued transaction status updated', {
        queueId,
        newStatus,
      });
    } catch (err) {
      log.error('NETWORK_STATUS', 'Failed to update queued transaction status', {
        error: err.message,
        queueId,
      });
      throw err;
    }
  }

  /**
   * Clean up old queued transactions
   * @returns {Promise<number>} Number of deleted transactions
   */
  async cleanupOldQueuedTransactions() {
    try {
      const cutoffTime = new Date(Date.now() - QUEUE_RETENTION_MS).toISOString();

      const result = await Database.run(
        'DELETE FROM network_transaction_queue WHERE enqueued_at < ?',
        [cutoffTime]
      );

      const deletedCount = result.changes || 0;
      if (deletedCount > 0) {
        log.info('NETWORK_STATUS', 'Cleaned up old queued transactions', {
          deletedCount,
          cutoffTime,
        });
      }

      return deletedCount;
    } catch (err) {
      log.error('NETWORK_STATUS', 'Failed to cleanup old queued transactions', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Start polling for network health
   * @private
   */
  _startPolling() {
    this.pollingInterval = setInterval(async () => {
      try {
        await this.checkNetworkHealth();
      } catch (err) {
        log.error('NETWORK_STATUS', 'Error during polling', {
          error: err.message,
        });
      }
    }, POLL_INTERVAL_MS);

    // Unref the interval so it doesn't keep the process alive
    if (this.pollingInterval.unref) {
      this.pollingInterval.unref();
    }
  }

  /**
   * Create the transaction queue table if it doesn't exist
   * @private
   * @returns {Promise<void>}
   */
  async _createQueueTable() {
    try {
      await Database.run(`
        CREATE TABLE IF NOT EXISTS network_transaction_queue (
          queue_id TEXT PRIMARY KEY,
          transaction_data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          enqueued_at TEXT NOT NULL,
          updated_at TEXT,
          created_at TEXT NOT NULL,
          CONSTRAINT valid_status CHECK (status IN ('pending', 'submitted', 'failed'))
        )
      `);

      // Create index for efficient querying
      await Database.run(`
        CREATE INDEX IF NOT EXISTS idx_network_queue_status 
        ON network_transaction_queue(status)
      `);

      await Database.run(`
        CREATE INDEX IF NOT EXISTS idx_network_queue_enqueued_at 
        ON network_transaction_queue(enqueued_at)
      `);

      log.debug('NETWORK_STATUS', 'Transaction queue table initialized');
    } catch (err) {
      // Table might already exist, which is fine
      if (!err.message.includes('already exists')) {
        log.error('NETWORK_STATUS', 'Failed to create queue table', {
          error: err.message,
        });
        throw err;
      }
    }
  }
}

module.exports = NetworkStatusService;
module.exports.NETWORK_STATUS = NETWORK_STATUS;
module.exports.QUEUE_STATUS = QUEUE_STATUS;
module.exports.POLL_INTERVAL_MS = POLL_INTERVAL_MS;
