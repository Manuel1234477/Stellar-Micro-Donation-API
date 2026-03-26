/**
 * Chaos Testing Helper
 * Utilities for injecting controlled chaos into tests
 */

class ChaosHelper {
  constructor(config = {}) {
    this.config = {
      failureProbability: config.failureProbability || 0.3,
      minDelay: config.minDelay || 0,
      maxDelay: config.maxDelay || 100,
      verbose: config.verbose || false,
    };
    
    this.metrics = {
      totalOperations: 0,
      failures: 0,
      successes: 0,
      crashes: 0,
      recoveries: 0,
    };
  }

  /**
   * Randomly decide if an operation should fail
   * @returns {boolean}
   */
  shouldFail() {
    return Math.random() < this.config.failureProbability;
  }

  /**
   * Get a random delay in milliseconds
   * @returns {number}
   */
  getRandomDelay() {
    return Math.floor(
      Math.random() * (this.config.maxDelay - this.config.minDelay) + this.config.minDelay
    );
  }

  /**
   * Inject random delay
   * @returns {Promise<void>}
   */
  async injectDelay() {
    const delay = this.getRandomDelay();
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Get a random error from a list
   * @param {Array<Error>} errors - List of possible errors
   * @returns {Error}
   */
  getRandomError(errors) {
    return errors[Math.floor(Math.random() * errors.length)];
  }

  /**
   * Wrap a function with chaos injection
   * @param {Function} fn - Function to wrap
   * @param {Array<Error>} possibleErrors - Errors that can be thrown
   * @returns {Function}
   */
  wrapWithChaos(fn, possibleErrors = []) {
    return async (...args) => {
      this.metrics.totalOperations++;
      
      // Random delay
      await this.injectDelay();
      
      // Random failure
      if (this.shouldFail() && possibleErrors.length > 0) {
        this.metrics.failures++;
        throw this.getRandomError(possibleErrors);
      }
      
      try {
        const result = await fn(...args);
        this.metrics.successes++;
        return result;
      } catch (error) {
        this.metrics.failures++;
        throw error;
      }
    };
  }

  /**
   * Create a chaos-injected database query function
   * @param {Function} originalQuery - Original database query function
   * @returns {Function}
   */
  createChaoticDbQuery(originalQuery) {
    const dbErrors = [
      new Error('SQLITE_BUSY: database is locked'),
      new Error('SQLITE_IOERR: disk I/O error'),
      new Error('Connection timeout'),
      new Error('SQLITE_CORRUPT: database disk image is malformed'),
      new Error('SQLITE_FULL: database or disk is full'),
    ];
    
    return this.wrapWithChaos(originalQuery, dbErrors);
  }

  /**
   * Create a chaos-injected network function
   * @param {Function} originalFn - Original network function
   * @returns {Function}
   */
  createChaoticNetworkFn(originalFn) {
    const networkErrors = [
      new Error('Network timeout'),
      new Error('Connection refused'),
      new Error('ECONNRESET: Connection reset by peer'),
      new Error('ETIMEDOUT: Operation timed out'),
      new Error('ENOTFOUND: DNS lookup failed'),
    ];
    
    return this.wrapWithChaos(originalFn, networkErrors);
  }

  /**
   * Record a crash
   */
  recordCrash() {
    this.metrics.crashes++;
  }

  /**
   * Record a recovery
   */
  recordRecovery() {
    this.metrics.recoveries++;
  }

  /**
   * Get current metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalOperations > 0
        ? (this.metrics.successes / this.metrics.totalOperations * 100).toFixed(2)
        : 0,
      crashRate: this.metrics.totalOperations > 0
        ? (this.metrics.crashes / this.metrics.totalOperations * 100).toFixed(2)
        : 0,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalOperations: 0,
      failures: 0,
      successes: 0,
      crashes: 0,
      recoveries: 0,
    };
  }

  /**
   * Print metrics report
   */
  printReport() {
    const metrics = this.getMetrics();
    console.log('\n📊 Chaos Testing Metrics:');
    console.log(`   Total Operations: ${metrics.totalOperations}`);
    console.log(`   Successes: ${metrics.successes}`);
    console.log(`   Failures: ${metrics.failures}`);
    console.log(`   Crashes: ${metrics.crashes}`);
    console.log(`   Recoveries: ${metrics.recoveries}`);
    console.log(`   Success Rate: ${metrics.successRate}%`);
    console.log(`   Crash Rate: ${metrics.crashRate}%\n`);
  }

  /**
   * Simulate a flaky operation that sometimes fails
   * @param {Function} operation - Operation to execute
   * @param {Object} options - Options
   * @returns {Promise<any>}
   */
  async simulateFlakyOperation(operation, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 100;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.metrics.totalOperations++;
        
        // Inject chaos
        await this.injectDelay();
        if (this.shouldFail() && attempt < maxRetries - 1) {
          this.metrics.failures++;
          throw new Error('Simulated transient failure');
        }
        
        const result = await operation();
        this.metrics.successes++;
        
        if (attempt > 0) {
          this.metrics.recoveries++;
        }
        
        return result;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          this.metrics.failures++;
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }
  }

  /**
   * Simulate concurrent chaos operations
   * @param {Array<Function>} operations - Operations to run concurrently
   * @returns {Promise<Array>}
   */
  async simulateConcurrentChaos(operations) {
    const promises = operations.map(async (op, index) => {
      try {
        // Random delay to create timing variations
        await this.injectDelay();
        
        this.metrics.totalOperations++;
        
        if (this.shouldFail()) {
          this.metrics.failures++;
          throw new Error(`Operation ${index} failed due to chaos`);
        }
        
        const result = await op();
        this.metrics.successes++;
        return { success: true, result, index };
      } catch (error) {
        this.metrics.failures++;
        return { success: false, error: error.message, index };
      }
    });
    
    return Promise.allSettled(promises);
  }

  /**
   * Create a chaos scenario configuration
   * @param {string} name - Scenario name
   * @param {Object} config - Scenario configuration
   * @returns {Object}
   */
  static createScenario(name, config = {}) {
    return {
      name,
      failureProbability: config.failureProbability || 0.3,
      iterations: config.iterations || 20,
      concurrency: config.concurrency || 1,
      delayRange: config.delayRange || [0, 100],
      errorTypes: config.errorTypes || ['generic'],
      description: config.description || `Chaos scenario: ${name}`,
    };
  }

  /**
   * Common chaos scenarios
   */
  static get SCENARIOS() {
    return {
      LIGHT_CHAOS: ChaosHelper.createScenario('Light Chaos', {
        failureProbability: 0.1,
        iterations: 10,
        description: 'Light chaos with 10% failure rate',
      }),
      MODERATE_CHAOS: ChaosHelper.createScenario('Moderate Chaos', {
        failureProbability: 0.3,
        iterations: 20,
        description: 'Moderate chaos with 30% failure rate',
      }),
      HEAVY_CHAOS: ChaosHelper.createScenario('Heavy Chaos', {
        failureProbability: 0.5,
        iterations: 50,
        description: 'Heavy chaos with 50% failure rate',
      }),
      EXTREME_CHAOS: ChaosHelper.createScenario('Extreme Chaos', {
        failureProbability: 0.7,
        iterations: 100,
        description: 'Extreme chaos with 70% failure rate',
      }),
      CONCURRENT_CHAOS: ChaosHelper.createScenario('Concurrent Chaos', {
        failureProbability: 0.3,
        iterations: 20,
        concurrency: 10,
        description: 'Concurrent operations with chaos',
      }),
    };
  }
}

module.exports = ChaosHelper;
