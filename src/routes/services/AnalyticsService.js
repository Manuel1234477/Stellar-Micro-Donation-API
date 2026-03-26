// External modules
const { Horizon } = require('stellar-sdk');

// Internal modules
const Database = require('../../utils/database');
const config = require('../../config/stellar');

class AnalyticsService {
  constructor() {
    this.server = new Horizon.Server(config.horizonUrl);
  }

  /**
   * Aggregates and stores donation data for a wallet.
   * Tasks: Define aggregation logic, Store summary data.
   */
  async aggregateForWallet(address) {
    try {
      // Fetch recent operations from Horizon
      const operations = await this.server.operations()
        .forAccount(address)
        .limit(50)
        .order('desc')
        .call();

      const stats = operations.records.reduce((acc, op) => {
        if (op.type === 'payment' && op.asset_type === 'native') {
          acc.totalXlm += parseFloat(op.amount);
          acc.count += 1;
        }
        return acc;
      }, { totalXlm: 0, count: 0 });

      // Save to database
      const timestamp = new Date().toISOString();
      await Database.run(
        `INSERT OR REPLACE INTO donation_analytics (address, total_xlm, donation_count, last_updated)
         VALUES (?, ?, ?, ?)`,
        [address, stats.totalXlm, stats.count, timestamp]
      );

      return { ...stats, last_updated: timestamp };
    } catch (error) {
      console.error(`Analytics failed for ${address}:`, error.message);
      throw error;
    }
  }
}

module.exports = new AnalyticsService();
