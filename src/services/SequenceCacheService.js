/**
 * Sequence Number Cache Service
 * 
 * RESPONSIBILITY: Manages caching and pre-fetching of Stellar account sequence numbers
 * OWNER: Blockchain Performance Team
 * DEPENDENCIES: StellarService, WalletService, log utils
 * 
 * This service reduces latency by caching sequence numbers and using optimistic increment.
 * Cache is refreshed on tx_bad_seq errors to ensure consistency.
 * 
 * Key features:
 * - Per-account sequence caching
 * - Optimistic increment tracking
 * - Automatic refresh on tx_bad_seq errors
 * - Pre-fetching for active wallets
 * - Hit/miss metrics tracking
 * - Thread-safe increment operations
 */

const log = require('../utils/log');

class SequenceCacheService {
  /**
   * Create a new SequenceCacheService instance
   * @param {Object} stellarService - StellarService instance for fetching sequences
   * @param {Object} [config={}] - Configuration options
   * @param {number} [config.cacheStalenessThresholdMs=300000] - Cache invalidation threshold (5 minutes default)
   * @param {number} [config.maxRetryCount=3] - Max retries for sequence fetch
   */
  constructor(stellarService, config = {}) {
    this.stellarService = stellarService;
    this.cacheStalenessThresholdMs = config.cacheStalenessThresholdMs || 300000; // 5 minutes
    this.maxRetryCount = config.maxRetryCount || 3;

    // Cache structure: { accountAddress: { sequence, lastFamilyCount, fetchedAt, optimisticDeltas: [] } }
    this.cache = new Map();

    // Metrics tracking
    this.metrics = {
      totalHits: 0,
      totalMisses: 0,
      totalRefreshes: 0,
      totalErrors: 0,
      lastRefreshAt: null,
      cacheAge: new Map(), // Track cache age per account
    };

    // Lock management for preventing concurrent fetches
    this.fetchLocks = new Map();

    log.info('SEQ_CACHE', 'SequenceCacheService initialized', {
      cacheStalenessThresholdMs: this.cacheStalenessThresholdMs,
      maxRetryCount: this.maxRetryCount,
    });
  }

  /**
   * Get cached or fetched sequence number for an account
   * @param {string} accountAddress - Stellar account public key
   * @param {boolean} [forceRefresh=false] - Force fetch from Horizon
   * @returns {Promise<string>} The current sequence number
   */
  async getSequenceNumber(accountAddress, forceRefresh = false) {
    try {
      const cacheEntry = this.cache.get(accountAddress);
      const now = Date.now();

      // Check if cache is valid and not stale
      if (
        !forceRefresh &&
        cacheEntry &&
        (now - cacheEntry.fetchedAt) < this.cacheStalenessThresholdMs
      ) {
        this.metrics.totalHits++;
        const sequence = this._getOptimisticSequence(cacheEntry);
        log.debug('SEQ_CACHE', 'Cache hit', {
          account: accountAddress,
          sequence,
          age: now - cacheEntry.fetchedAt,
        });
        return sequence;
      }

      // Cache miss or expired - fetch from Horizon
      this.metrics.totalMisses++;
      return await this._fetchAndCacheSequence(accountAddress);
    } catch (error) {
      this.metrics.totalErrors++;
      log.error('SEQ_CACHE', 'Error getting sequence number', {
        account: accountAddress,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Optimistically increment cached sequence number after successful transaction
   * @param {string} accountAddress - Stellar account public key
   * @returns {void}
   */
  incrementSequence(accountAddress) {
    try {
      const cacheEntry = this.cache.get(accountAddress);
      if (!cacheEntry) {
        log.warn('SEQ_CACHE', 'Attempted to increment uncached sequence', {
          account: accountAddress,
        });
        return;
      }

      cacheEntry.sequence = (BigInt(cacheEntry.sequence) + BigInt(1)).toString();
      cacheEntry.lastFamilyCount = (cacheEntry.lastFamilyCount || 0) + 1;

      log.debug('SEQ_CACHE', 'Sequence incremented optimistically', {
        account: accountAddress,
        newSequence: cacheEntry.sequence,
      });
    } catch (error) {
      log.error('SEQ_CACHE', 'Error incrementing sequence', {
        account: accountAddress,
        error: error.message,
      });
    }
  }

  /**
   * Refresh cache on tx_bad_seq error - critical for consistency
   * @param {string} accountAddress - Stellar account public key
   * @returns {Promise<string>} The refreshed sequence number
   */
  async refreshOnTxBadSeq(accountAddress) {
    try {
      log.warn('SEQ_CACHE', 'tx_bad_seq detected - refreshing cache', {
        account: accountAddress,
      });

      // Remove from cache to force fresh fetch
      this.cache.delete(accountAddress);

      // Fetch fresh sequence
      const sequence = await this._fetchAndCacheSequence(accountAddress);

      this.metrics.totalRefreshes++;

      log.info('SEQ_CACHE', 'Cache refreshed on tx_bad_seq', {
        account: accountAddress,
        newSequence: sequence,
      });

      return sequence;
    } catch (error) {
      this.metrics.totalErrors++;
      log.error('SEQ_CACHE', 'Failed to refresh cache on tx_bad_seq', {
        account: accountAddress,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Pre-fetch sequence numbers for multiple accounts
   * @param {string[]} accountAddresses - Array of Stellar account public keys
   * @param {Object} [options={}] - Configuration options
   * @param {boolean} [options.force=false] - Force refresh even if cached
   * @returns {Promise<Map>} Map of address -> sequence number
   */
  async prefetchSequences(accountAddresses, options = {}) {
    try {
      if (!accountAddresses || accountAddresses.length === 0) {
        return new Map();
      }

      log.info('SEQ_CACHE', 'Pre-fetching sequences', {
        count: accountAddresses.length,
        forceRefresh: options.force,
      });

      const results = new Map();
      const errors = [];

      for (const address of accountAddresses) {
        try {
          const sequence = await this.getSequenceNumber(address, options.force);
          results.set(address, sequence);
        } catch (error) {
          errors.push({ address, error: error.message });
          log.warn('SEQ_CACHE', 'Pre-fetch failed for account', {
            account: address,
            error: error.message,
          });
        }
      }

      log.info('SEQ_CACHE', 'Pre-fetch completed', {
        successful: results.size,
        failed: errors.length,
      });

      return results;
    } catch (error) {
      log.error('SEQ_CACHE', 'Error during pre-fetch', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific account
   * @param {string} accountAddress - Stellar account public key
   * @returns {void}
   */
  invalidateAccount(accountAddress) {
    this.cache.delete(accountAddress);
    this.fetchLocks.delete(accountAddress);
    log.debug('SEQ_CACHE', 'Cache invalidated', { account: accountAddress });
  }

  /**
   * Clear entire cache
   * @returns {void}
   */
  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    this.fetchLocks.clear();
    log.info('SEQ_CACHE', 'Cache cleared', { entriesCleared: size });
  }

  /**
   * Get cache statistics and metrics
   * @returns {Object} Current cache metrics
   */
  getMetrics() {
    const hitRate =
      this.metrics.totalHits + this.metrics.totalMisses > 0
        ? ((this.metrics.totalHits / (this.metrics.totalHits + this.metrics.totalMisses)) * 100).toFixed(2)
        : 0;

    return {
      cacheSize: this.cache.size,
      totalHits: this.metrics.totalHits,
      totalMisses: this.metrics.totalMisses,
      hitRate: `${hitRate}%`,
      totalRefreshes: this.metrics.totalRefreshes,
      totalErrors: this.metrics.totalErrors,
      lastRefreshAt: this.metrics.lastRefreshAt,
      cacheStalenessThresholdMs: this.cacheStalenessThresholdMs,
      accounts: Array.from(this.cache.entries()).map(([address, entry]) => ({
        address,
        sequence: entry.sequence,
        cacheAge: Date.now() - entry.fetchedAt,
        optimisticDelta: entry.lastFamilyCount || 0,
      })),
    };
  }

  /**
   * Get cache status for health checks
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const metrics = this.getMetrics();
    const isHealthy =
      this.metrics.totalErrors < 5 && // Allow some errors but flag if too many
      (this.metrics.totalHits + this.metrics.totalMisses > 0); // Must have activity

    return {
      healthy: isHealthy,
      cacheSize: this.cache.size,
      hitRate: metrics.hitRate,
      errorCount: this.metrics.totalErrors,
      message: isHealthy ? 'Sequence cache operational' : 'Sequence cache degraded',
    };
  }

  /**
   * [PRIVATE] Fetch sequence from Horizon and cache it
   * @private
   * @param {string} accountAddress - Stellar account public key
   * @returns {Promise<string>} The sequence number
   */
  async _fetchAndCacheSequence(accountAddress) {
    // Acquire fetch lock to prevent concurrent fetches for same account
    if (!this.fetchLocks.has(accountAddress)) {
      this.fetchLocks.set(accountAddress, Promise.resolve());
    }

    const lockPromise = this.fetchLocks.get(accountAddress);

    return new Promise((resolve, reject) => {
      lockPromise
        .then(async () => {
          // Check if another thread already cached while we waited
          const cached = this.cache.get(accountAddress);
          if (cached && Date.now() - cached.fetchedAt < this.cacheStalenessThresholdMs) {
            return resolve(this._getOptimisticSequence(cached));
          }

          // Fetch from Horizon with retry
          let lastError;
          for (let attempt = 1; attempt <= this.maxRetryCount; attempt++) {
            try {
              const account = await this.stellarService.server.loadAccount(accountAddress);
              const sequence = account.sequence;

              // Cache the result
              this.cache.set(accountAddress, {
                sequence,
                lastFamilyCount: 0,
                fetchedAt: Date.now(),
                optimisticDeltas: [],
              });

              this.metrics.lastRefreshAt = new Date().toISOString();

              log.debug('SEQ_CACHE', 'Sequence fetched and cached', {
                account: accountAddress,
                sequence,
                attempt,
              });

              return resolve(sequence);
            } catch (error) {
              lastError = error;
              log.warn('SEQ_CACHE', 'Failed to fetch sequence', {
                account: accountAddress,
                attempt,
                error: error.message,
              });

              if (attempt < this.maxRetryCount) {
                // Exponential backoff
                await new Promise(sleep => setTimeout(sleep, Math.pow(2, attempt) * 100));
              }
            }
          }

          reject(lastError);
        })
        .catch(reject);
    });
  }

  /**
   * [PRIVATE] Get optimistic sequence (base + increments)
   * @private
   * @param {Object} cacheEntry - Cache entry object
   * @returns {string} The optimistic sequence number
   */
  _getOptimisticSequence(cacheEntry) {
    if (!cacheEntry) {
      return '0';
    }

    const baseSequence = BigInt(cacheEntry.sequence);
    const optimisticDelta = BigInt(cacheEntry.lastFamilyCount || 0);
    return (baseSequence + optimisticDelta).toString();
  }
}

module.exports = SequenceCacheService;
