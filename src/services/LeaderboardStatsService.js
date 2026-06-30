const Transaction = require('../models/transaction');
const Cache = require('../utils/cache');
const {
  leaderboardComputeDuration,
  recordLeaderboardCacheHit,
  recordLeaderboardCacheMiss,
} = require('../utils/metrics');

const STROOPS_PER_XLM = 10_000_000n;

/** Convert an XLM float amount from the in-memory store to BigInt stroops. */
function toStroops(xlmAmount) {
  return BigInt(Math.round(Number(xlmAmount) * Number(STROOPS_PER_XLM)));
}

/**
 * Leaderboard cache TTL in milliseconds (1 minute)
 */
const LEADERBOARD_CACHE_TTL_MS = 60_000;

/**
 * Default number of top entries to return
 */
const DEFAULT_TOP_N = 10;

/**
 * Attach a non-enumerable `cachedAt` timestamp to a leaderboard array so
 * callers can report freshness without changing the array's JSON shape
 * (existing consumers index/iterate it as a plain array of entries).
 *
 * @param {Array} leaderboard
 * @param {string} cachedAt - ISO 8601 timestamp of when the data was computed.
 * @returns {Array} The same array, with `cachedAt` attached.
 */
function withCacheMeta(leaderboard, cachedAt) {
  Object.defineProperty(leaderboard, 'cachedAt', { value: cachedAt, enumerable: false });
  return leaderboard;
}

class StatsService {
  /**
   * Get daily aggregated stats
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Array} Array of daily stats with date and total volume
   */
  static getDailyStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const dailyMap = new Map();

    transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const dateKey = this.getDateKey(date);

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          totalVolume: 0,
          transactionCount: 0,
          transactions: []
        });
      }

      const dayStats = dailyMap.get(dateKey);
      dayStats.totalVolume += parseFloat(tx.amount) || 0;
      dayStats.transactionCount += 1;
      dayStats.transactions.push({
        id: tx.id,
        amount: tx.amount,
        donor: tx.donor,
        recipient: tx.recipient,
        timestamp: tx.timestamp
      });
    });

    return Array.from(dailyMap.values()).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
    );
  }

  /**
   * Get weekly aggregated stats
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Array} Array of weekly stats with week number and total volume
   */
  static getWeeklyStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const weeklyMap = new Map();

    transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const weekKey = this.getWeekKey(date);
      const mapKey = weekKey.key;

      if (!weeklyMap.has(mapKey)) {
        weeklyMap.set(mapKey, {
          week: weekKey.week,
          year: weekKey.year,
          weekStart: weekKey.weekStart,
          weekEnd: weekKey.weekEnd,
          totalVolume: 0,
          transactionCount: 0,
          transactions: []
        });
      }

      const weekStats = weeklyMap.get(mapKey);
      weekStats.totalVolume += parseFloat(tx.amount) || 0;
      weekStats.transactionCount += 1;
      weekStats.transactions.push({
        id: tx.id,
        amount: tx.amount,
        donor: tx.donor,
        recipient: tx.recipient,
        timestamp: tx.timestamp
      });
    });

    return Array.from(weeklyMap.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.week - b.week;
    });
  }

  /**
   * Get overall stats summary
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Object} Summary stats
   */
  static getSummaryStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);

    const summary = {
      totalVolume: 0,
      totalTransactions: transactions.length,
      averageTransactionAmount: 0,
      maxTransactionAmount: 0,
      minTransactionAmount: Infinity,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    };

    if (transactions.length === 0) {
      summary.minTransactionAmount = 0;
      return summary;
    }

    transactions.forEach(tx => {
      const amount = parseFloat(tx.amount) || 0;
      summary.totalVolume += amount;
      summary.maxTransactionAmount = Math.max(summary.maxTransactionAmount, amount);
      summary.minTransactionAmount = Math.min(summary.minTransactionAmount, amount);
    });

    summary.averageTransactionAmount = summary.totalVolume / transactions.length;

    return summary;
  }

  /**
   * Get stats by donor
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Array} Array of donor stats sorted by total volume
   */
  static getDonorStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const donorMap = new Map();

    transactions.forEach(tx => {
      const donor = tx.donor || 'Anonymous';

      if (!donorMap.has(donor)) {
        donorMap.set(donor, {
          donor,
          totalDonated: 0,
          donationCount: 0,
          donations: []
        });
      }

      const donorStats = donorMap.get(donor);
      donorStats.totalDonated += parseFloat(tx.amount) || 0;
      donorStats.donationCount += 1;
      donorStats.donations.push({
        id: tx.id,
        amount: tx.amount,
        recipient: tx.recipient,
        timestamp: tx.timestamp
      });
    });

    return Array.from(donorMap.values()).sort((a, b) =>
      b.totalDonated - a.totalDonated
    );
  }

  /**
   * Get stats by recipient
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Array} Array of recipient stats sorted by total received
   */
  static getRecipientStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const recipientMap = new Map();

    transactions.forEach(tx => {
      const recipient = tx.recipient || 'Unknown';

      if (!recipientMap.has(recipient)) {
        recipientMap.set(recipient, {
          recipient,
          totalReceived: 0,
          donationCount: 0,
          donations: []
        });
      }

      const recipientStats = recipientMap.get(recipient);
      recipientStats.totalReceived += parseFloat(tx.amount) || 0;
      recipientStats.donationCount += 1;
      recipientStats.donations.push({
        id: tx.id,
        amount: tx.amount,
        donor: tx.donor,
        timestamp: tx.timestamp
      });
    });

    return Array.from(recipientMap.values()).sort((a, b) =>
      b.totalReceived - a.totalReceived
    );
  }

  // Helper methods
  static getDateKey(date) {
    return date.toISOString().split('T')[0];
  }

  static getWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const weekStart = new Date(yearStart);
    weekStart.setUTCDate(yearStart.getUTCDate() - yearStart.getUTCDay() + 1);
    const diff = d - weekStart;
    const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;

    const weekStartDate = new Date(weekStart);
    weekStartDate.setUTCDate(weekStart.getUTCDate() + (week - 1) * 7);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 6);

    return {
      key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
      week,
      year: d.getUTCFullYear(),
      weekStart: weekStartDate.toISOString().split('T')[0],
      weekEnd: weekEndDate.toISOString().split('T')[0]
    };
  }

  /**
   * Get analytics fee summary
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Object} Analytics fee summary
   */
  static getAnalyticsFeeStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);

    const feeStats = {
      totalFeesCalculated: 0,
      totalDonationVolume: 0,
      transactionCount: transactions.length,
      averageFeePerTransaction: 0,
      feesByRecipient: {},
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    };

    if (transactions.length === 0) {
      return feeStats;
    }

    transactions.forEach(tx => {
      const amount = parseFloat(tx.amount) || 0;
      const fee = parseFloat(tx.analyticsFee) || 0;

      feeStats.totalFeesCalculated += fee;
      feeStats.totalDonationVolume += amount;

      const recipient = tx.recipient || 'Unknown';
      if (!feeStats.feesByRecipient[recipient]) {
        feeStats.feesByRecipient[recipient] = {
          totalFees: 0,
          donationCount: 0,
          totalVolume: 0
        };
      }

      feeStats.feesByRecipient[recipient].totalFees += fee;
      feeStats.feesByRecipient[recipient].donationCount += 1;
      feeStats.feesByRecipient[recipient].totalVolume += amount;
    });

    feeStats.averageFeePerTransaction = feeStats.totalFeesCalculated / transactions.length;
    feeStats.effectiveFeePercentage = (feeStats.totalFeesCalculated / feeStats.totalDonationVolume) * 100;

    return feeStats;
  }
  /**
   * Get wallet donation analytics
   * @param {string} walletAddress - Wallet address (donor or recipient name)
   * @param {Date} startDate - Optional start date for filtering
   * @param {Date} endDate - Optional end date for filtering
   * @returns {Object} Wallet analytics with totals sent, received, and donation count
   */
  static getWalletAnalytics(walletAddress, startDate = null, endDate = null) {
    let transactions;

    if (startDate && endDate) {
      transactions = Transaction.getByDateRange(startDate, endDate);
    } else {
      transactions = Transaction.loadTransactions();
    }

    const analytics = {
      walletAddress,
      totalSent: 0,
      totalReceived: 0,
      donationCount: 0,
      sentCount: 0,
      receivedCount: 0,
      sentTransactions: [],
      receivedTransactions: []
    };

    if (startDate && endDate) {
      analytics.dateRange = {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      };
    } else {
      analytics.dateRange = 'lifetime';
    }

    transactions.forEach(tx => {
      const amount = parseFloat(tx.amount) || 0;

      // Check if wallet is the donor (sender)
      if (tx.donor === walletAddress) {
        analytics.totalSent += amount;
        analytics.sentCount += 1;
        analytics.sentTransactions.push({
          id: tx.id,
          amount: tx.amount,
          recipient: tx.recipient,
          timestamp: tx.timestamp,
          status: tx.status
        });
      }

      // Check if wallet is the recipient (receiver)
      if (tx.recipient === walletAddress) {
        analytics.totalReceived += amount;
        analytics.receivedCount += 1;
        analytics.receivedTransactions.push({
          id: tx.id,
          amount: tx.amount,
          donor: tx.donor,
          timestamp: tx.timestamp,
          status: tx.status
        });
      }
    });

    // Total donation count is the sum of sent and received
    analytics.donationCount = analytics.sentCount + analytics.receivedCount;

    return analytics;
  }


  // ==================== Leaderboard Methods ====================

  /**
   * Get date range for a time period
   * @param {string} period - Time period: 'all', 'monthly', 'weekly', 'daily'
   * @returns {Object} { startDate, endDate }
   */
  static getDateRangeForPeriod(period) {
    const now = new Date();
    const endDate = new Date(now);
    let startDate;

    switch (period) {
      case 'daily':
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'all':
      default:
        // Return epoch for 'all' - will be handled separately
        return { startDate: null, endDate: null };
    }

    return { startDate, endDate };
  }

  /**
   * Get donor leaderboard - top donors by total donations
   * @param {string} period - Time period: 'all', 'monthly', 'weekly', 'daily'
   * @param {number} limit - Number of top donors to return (default 10)
   * @returns {Array} Array of donor leaderboard entries
   */
  static getDonorLeaderboard(period = 'all', limit = DEFAULT_TOP_N) {
    const cacheKey = `leaderboard:donors:${period}:${limit}`;

    // Check cache
    const cached = Cache.get(cacheKey);
    if (cached) {
      recordLeaderboardCacheHit();
      return cached;
    }
    recordLeaderboardCacheMiss();
    const computeTimer = leaderboardComputeDuration.startTimer();

    let transactions;
    const { startDate, endDate } = this.getDateRangeForPeriod(period);

    if (period === 'all') {
      // For 'all' period, get all transactions
      transactions = Transaction.loadTransactions();
    } else {
      transactions = Transaction.getByDateRange(startDate, endDate);
    }

    // Filter confirmed transactions only
    const confirmedTransactions = transactions.filter(t =>
      t.status === 'confirmed' || t.status === 'COMPLETED'
    );

    // Aggregate by donor using BigInt stroops to avoid precision loss
    const donorMap = new Map();
    confirmedTransactions.forEach(tx => {
      const donor = tx.donor || 'Anonymous';
      if (!donorMap.has(donor)) {
        donorMap.set(donor, {
          rank: 0,
          donor,
          totalDonatedStroops: 0n,
          donationCount: 0,
          lastDonationAt: null,
          period
        });
      }

      const donorEntry = donorMap.get(donor);
      donorEntry.totalDonatedStroops += toStroops(tx.amount);
      donorEntry.donationCount += 1;

      const txDate = new Date(tx.timestamp);
      if (!donorEntry.lastDonationAt || txDate > new Date(donorEntry.lastDonationAt)) {
        donorEntry.lastDonationAt = tx.timestamp;
      }
    });

    // Sort by total donated (descending) and assign ranks; output stroops as string
    const leaderboard = Array.from(donorMap.values())
      .sort((a, b) => (a.totalDonatedStroops > b.totalDonatedStroops ? -1 : a.totalDonatedStroops < b.totalDonatedStroops ? 1 : 0))
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        donor: entry.donor,
        totalDonated: entry.totalDonatedStroops.toString(),
        donationCount: entry.donationCount,
        lastDonationAt: entry.lastDonationAt,
        period: entry.period,
      }));

    computeTimer();
    withCacheMeta(leaderboard, new Date().toISOString());

    // Cache the result
    Cache.set(cacheKey, leaderboard, LEADERBOARD_CACHE_TTL_MS);

    return leaderboard;
  }

  /**
   * Get recipient leaderboard - top recipients by total received
   * @param {string} period - Time period: 'all', 'monthly', 'weekly', 'daily'
   * @param {number} limit - Number of top recipients to return (default 10)
   * @returns {Array} Array of recipient leaderboard entries
   */
  static getRecipientLeaderboard(period = 'all', limit = DEFAULT_TOP_N) {
    const cacheKey = `leaderboard:recipients:${period}:${limit}`;

    // Check cache
    const cached = Cache.get(cacheKey);
    if (cached) {
      recordLeaderboardCacheHit();
      return cached;
    }
    recordLeaderboardCacheMiss();
    const computeTimer = leaderboardComputeDuration.startTimer();

    let transactions;
    const { startDate, endDate } = this.getDateRangeForPeriod(period);

    if (period === 'all') {
      // For 'all' period, get all transactions
      transactions = Transaction.loadTransactions();
    } else {
      transactions = Transaction.getByDateRange(startDate, endDate);
    }

    // Filter confirmed transactions only
    const confirmedTransactions = transactions.filter(t => 
      t.status === 'confirmed' || t.status === 'COMPLETED'
    );

    // Aggregate by recipient using BigInt stroops to avoid precision loss
    const recipientMap = new Map();
    confirmedTransactions.forEach(tx => {
      const recipient = tx.recipient || 'Unknown';
      if (!recipientMap.has(recipient)) {
        recipientMap.set(recipient, {
          rank: 0,
          recipient,
          totalReceivedStroops: 0n,
          donationCount: 0,
          lastReceivedAt: null,
          period
        });
      }

      const recipientEntry = recipientMap.get(recipient);
      recipientEntry.totalReceivedStroops += toStroops(tx.amount);
      recipientEntry.donationCount += 1;

      const txDate = new Date(tx.timestamp);
      if (!recipientEntry.lastReceivedAt || txDate > new Date(recipientEntry.lastReceivedAt)) {
        recipientEntry.lastReceivedAt = tx.timestamp;
      }
    });

    // Sort by total received (descending) and assign ranks; output stroops as string
    const leaderboard = Array.from(recipientMap.values())
      .sort((a, b) => (a.totalReceivedStroops > b.totalReceivedStroops ? -1 : a.totalReceivedStroops < b.totalReceivedStroops ? 1 : 0))
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        recipient: entry.recipient,
        totalReceived: entry.totalReceivedStroops.toString(),
        donationCount: entry.donationCount,
        lastReceivedAt: entry.lastReceivedAt,
        period: entry.period,
      }));

    computeTimer();
    withCacheMeta(leaderboard, new Date().toISOString());

    // Cache the result
    Cache.set(cacheKey, leaderboard, LEADERBOARD_CACHE_TTL_MS);

    return leaderboard;
  }

  /**
   * Invalidate all leaderboard caches (called when new confirmed donation arrives)
   */
  static invalidateLeaderboardCache() {
    Cache.clearPrefix('leaderboard:');
  }
}

StatsService.LEADERBOARD_CACHE_TTL_MS = LEADERBOARD_CACHE_TTL_MS;

module.exports = StatsService;
