/**
 * Stats Service - Analytics and Reporting Layer
 *
 * RESPONSIBILITY: Donation statistics aggregation and analytics calculations
 * OWNER: Analytics Team
 * DEPENDENCIES: Transaction model, Database
 *
 * Provides statistical analysis of donation data including daily/weekly aggregations,
 * donor/recipient analytics, and summary reports for business intelligence.
 */

const Transaction = require('../models/transaction');
const { generatePseudonymousId, isPseudonymousId } = require('../utils/anonymization');
const { toStroops, fromStroops, addStroops } = require('../utils/money');

class StatsService {
  /**
   * Determine if a public key should be anonymized for the current caller.
   * Admin callers always see full public keys. Non-admin callers see pseudonymous IDs
   * for donors who opted for anonymous donations.
   * 
   * @param {string} publicKey - The public key to potentially anonymize
   * @param {boolean} isAnonymous - Whether the donation was marked as anonymous
   * @param {boolean} isAdmin - Whether the caller has admin role
   * @returns {string} The public key (if admin or not anonymous) or pseudonymous ID
   */
  static getDisplayKey(publicKey, isAnonymous, isAdmin) {
    // Admin always sees full keys
    if (isAdmin) return publicKey;
    
    // Non-admin sees pseudonymous ID for anonymous donations
    if (isAnonymous && publicKey && !isPseudonymousId(publicKey)) {
      return generatePseudonymousId(publicKey);
    }
    
    // Non-anonymous donations show full key to everyone
    return publicKey;
  }

  /**
   * Get daily aggregated stats
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @param {string} [timezone='UTC'] - IANA timezone string
   * @param {boolean} [isAdmin=false] - Whether caller is admin (for anonymization)
   * @returns {Array} Array of daily stats with date and total volume
   */
  static getDailyStats(startDate, endDate, timezone = 'UTC', isAdmin = false) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const dailyMap = new Map();

    transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const dateKey = this.getDateKeyInTimezone(date, timezone);
      
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          _totalVolumeStroops: 0n,
          transactionCount: 0,
          transactions: []
        });
      }

      const dayStats = dailyMap.get(dateKey);
      dayStats._totalVolumeStroops = addStroops(dayStats._totalVolumeStroops, toStroops(tx.amount || 0));
      dayStats.transactionCount += 1;
      dayStats.transactions.push({
        id: tx.id,
        amount: tx.amount,
        donor: this.getDisplayKey(tx.donor, tx.anonymous, isAdmin),
        recipient: this.getDisplayKey(tx.recipient, false, isAdmin),
        timestamp: tx.timestamp
      });
    });

    return Array.from(dailyMap.values())
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(d => {
        const { _totalVolumeStroops, ...rest } = d;
        return { ...rest, totalVolume: fromStroops(_totalVolumeStroops) };
      });
  }

  /**
   * Get weekly aggregated stats
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @param {boolean} [isAdmin=false] - Whether caller is admin (for anonymization)
   * @returns {Array} Array of weekly stats with week number and total volume
   */
  static getWeeklyStats(startDate, endDate, isAdmin = false) {
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
          _totalVolumeStroops: 0n,
          transactionCount: 0,
          transactions: []
        });
      }

      const weekStats = weeklyMap.get(mapKey);
      weekStats._totalVolumeStroops = addStroops(weekStats._totalVolumeStroops, toStroops(tx.amount || 0));
      weekStats.transactionCount += 1;
      weekStats.transactions.push({
        id: tx.id,
        amount: tx.amount,
        donor: this.getDisplayKey(tx.donor, tx.anonymous, isAdmin),
        recipient: this.getDisplayKey(tx.recipient, false, isAdmin),
        timestamp: tx.timestamp
      });
    });

    return Array.from(weeklyMap.values())
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.week - b.week;
      })
      .map(w => {
        const { _totalVolumeStroops, ...rest } = w;
        return { ...rest, totalVolume: fromStroops(_totalVolumeStroops) };
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
      totalVolume: '0.0000000',
      totalTransactions: transactions.length,
      averageTransactionAmount: '0.0000000',
      maxTransactionAmount: '0.0000000',
      minTransactionAmount: '0.0000000',
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    };

    if (transactions.length === 0) {
      return summary;
    }

    let totalStroops = 0n;
    let maxStroops = 0n;
    let minStroops = null;

    transactions.forEach(tx => {
      const s = toStroops(tx.amount || 0);
      totalStroops += s;
      if (s > maxStroops) maxStroops = s;
      if (minStroops === null || s < minStroops) minStroops = s;
    });

    summary.totalVolume = fromStroops(totalStroops);
    summary.maxTransactionAmount = fromStroops(maxStroops);
    summary.minTransactionAmount = fromStroops(minStroops ?? 0n);
    // average: integer division (floor)
    summary.averageTransactionAmount = fromStroops(totalStroops / BigInt(transactions.length));

    return summary;
  }

  /**
   * Get stats by donor.
   * Anonymous donations are excluded so that pseudonymous IDs do not pollute
   * public donor rankings or leaderboards.
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @param {boolean} [isAdmin=false] - Whether caller is admin (for anonymization)
   * @returns {Array} Array of donor stats sorted by total volume
   */
  static getDonorStats(startDate, endDate, isAdmin = false) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const donorMap = new Map();

    // Exclude anonymous donations from public donor stats / leaderboards
    transactions.filter(tx => !tx.anonymous).forEach(tx => {
      const donor = tx.donor || 'Anonymous';
      
      if (!donorMap.has(donor)) {
        donorMap.set(donor, {
          donor,
          _totalDonatedStroops: 0n,
          donationCount: 0,
          donations: []
        });
      }

      const donorStats = donorMap.get(donor);
      donorStats._totalDonatedStroops = addStroops(donorStats._totalDonatedStroops, toStroops(tx.amount || 0));
      donorStats.donationCount += 1;
      donorStats.donations.push({
        id: tx.id,
        amount: tx.amount,
        recipient: this.getDisplayKey(tx.recipient, false, isAdmin),
        timestamp: tx.timestamp
      });
    });

    return Array.from(donorMap.values())
      .map(d => {
        const { _totalDonatedStroops, ...rest } = d;
        return { ...rest, totalDonated: fromStroops(_totalDonatedStroops) };
      })
      .sort((a, b) => {
        // sort descending by stroop value (compare as strings of equal-length wouldn't work; re-parse)
        const aS = toStroops(a.totalDonated);
        const bS = toStroops(b.totalDonated);
        return bS > aS ? 1 : bS < aS ? -1 : 0;
      });
  }

  /**
   * Get stats by recipient
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @param {boolean} [isAdmin=false] - Whether caller is admin (for anonymization)
   * @returns {Array} Array of recipient stats sorted by total received
   */
  static getRecipientStats(startDate, endDate, isAdmin = false) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const recipientMap = new Map();

    transactions.forEach(tx => {
      const recipient = tx.recipient || 'Unknown';
      
      if (!recipientMap.has(recipient)) {
        recipientMap.set(recipient, {
          recipient,
          _totalReceivedStroops: 0n,
          donationCount: 0,
          donations: []
        });
      }

      const recipientStats = recipientMap.get(recipient);
      recipientStats._totalReceivedStroops = addStroops(recipientStats._totalReceivedStroops, toStroops(tx.amount || 0));
      recipientStats.donationCount += 1;
      recipientStats.donations.push({
        id: tx.id,
        amount: tx.amount,
        donor: this.getDisplayKey(tx.donor, tx.anonymous, isAdmin),
        timestamp: tx.timestamp
      });
    });

    return Array.from(recipientMap.values())
      .map(r => {
        const { _totalReceivedStroops, ...rest } = r;
        return { ...rest, totalReceived: fromStroops(_totalReceivedStroops) };
      })
      .sort((a, b) => {
        const aS = toStroops(a.totalReceived);
        const bS = toStroops(b.totalReceived);
        return bS > aS ? 1 : bS < aS ? -1 : 0;
      });
  }

  /**
   * Get stats by tag
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Array} Array of tag stats sorted by total donated
   */
  static getTagStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const tagMap = new Map();

    transactions.forEach(tx => {
      if (!tx.tags || !Array.isArray(tx.tags)) return;
      
      tx.tags.forEach(tag => {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, {
            tag,
            totalDonated: 0,
            donationCount: 0
          });
        }
        
        const tagStats = tagMap.get(tag);
        tagStats.totalDonated += parseFloat(tx.amount) || 0;
        tagStats.donationCount += 1;
      });
    });

    return Array.from(tagMap.values()).sort((a, b) => 
      b.totalDonated - a.totalDonated
    );
  }

  // Helper methods
  static getDateKey(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Return the calendar date key (YYYY-MM-DD) for a date as observed in a
   * specific IANA timezone. Falls back to UTC when the timezone is invalid.
   * @param {Date} date
   * @param {string} [timezone='UTC']
   * @returns {string} YYYY-MM-DD
   */
  static getDateKeyInTimezone(date, timezone = 'UTC') {
    try {
      // en-CA formats as YYYY-MM-DD
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    } catch (_) {
      return this.getDateKey(date);
    }
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
   * Get analytics fee summary broken down by asset type.
   * Fees are grouped per asset so mixed-currency totals are not meaninglessly summed.
   * A `totalInXLM` field provides a unified view using stored exchange rates.
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {Object} Analytics fee summary with per-asset breakdown
   */
  static getAnalyticsFeeStats(startDate, endDate) {
    const transactions = Transaction.getByDateRange(startDate, endDate);
    const byAsset = {};

    let totalFeeStroops = 0n;
    let totalVolumeStroops = 0n;

    transactions.forEach(tx => {
      const asset = tx.asset || tx.assetCode || 'XLM';
      const amountStroops = toStroops(tx.amount || 0);
      const feeStroops = toStroops(tx.analyticsFee || 0);
      const xlmRate = parseFloat(tx.xlmRate) || (asset === 'XLM' ? 1 : 0);

      if (!byAsset[asset]) {
        byAsset[asset] = {
          asset,
          _totalFeesStroops: 0n,
          _totalVolumeStroops: 0n,
          _totalFeesInXLMStroops: 0n,
          transactionCount: 0,
        };
      }

      byAsset[asset]._totalFeesStroops += feeStroops;
      byAsset[asset]._totalVolumeStroops += amountStroops;
      byAsset[asset].transactionCount += 1;
      // For non-XLM, convert fee to XLM stroops using stored rate
      const feeInXLMStroops = asset === 'XLM' ? feeStroops : BigInt(Math.floor(Number(feeStroops) * xlmRate));
      byAsset[asset]._totalFeesInXLMStroops += feeInXLMStroops;

      totalFeeStroops += feeInXLMStroops;
      totalVolumeStroops += asset === 'XLM' ? amountStroops : 0n;
    });

    const feesByAsset = Object.values(byAsset).map(a => {
      const { _totalFeesStroops, _totalVolumeStroops, _totalFeesInXLMStroops, ...rest } = a;
      const volStroops = _totalVolumeStroops;
      return {
        ...rest,
        totalFees: fromStroops(_totalFeesStroops),
        totalVolume: fromStroops(_totalVolumeStroops),
        totalFeesInXLM: fromStroops(_totalFeesInXLMStroops),
        effectiveFeePercentage: volStroops > 0n
          ? Number(_totalFeesStroops * 10000n / volStroops) / 100
          : 0,
      };
    });

    const totalInXLMStroops = feesByAsset.reduce((s, a) => s + toStroops(a.totalFeesInXLM), 0n);
    const totalInXLM = fromStroops(totalInXLMStroops);
    const totalTransactions = transactions.length;
    const _totalFeesXLM = feesByAsset.find(a => a.asset === 'XLM');

    return {
      feesByAsset,
      totalInXLM,
      transactionCount: totalTransactions,
      averageFeePerTransactionXLM: totalTransactions > 0
        ? fromStroops(totalInXLMStroops / BigInt(totalTransactions))
        : '0.0000000',
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      note: 'totalInXLM uses exchange rates stored at transaction time; non-XLM assets with no rate are excluded from totalInXLM',
    };
  }
  /**
   * Get wallet donation analytics
   * @param {string} walletAddress - Wallet address (donor or recipient name)
   * @param {Date} startDate - Optional start date for filtering
   * @param {Date} endDate - Optional end date for filtering
   * @param {boolean} [isAdmin=false] - Whether caller is admin (for anonymization)
   * @returns {Object} Wallet analytics with totals sent, received, and donation count
   */
  static getWalletAnalytics(walletAddress, startDate = null, endDate = null, isAdmin = false) {
    let transactions;

    if (startDate && endDate) {
      transactions = Transaction.getByDateRange(startDate, endDate);
    } else {
      transactions = Transaction.loadTransactions();
    }

    const analytics = {
      walletAddress,
      totalSent: '0.0000000',
      totalReceived: '0.0000000',
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

    let sentStroops = 0n;
    let receivedStroops = 0n;

    transactions.forEach(tx => {
      const s = toStroops(tx.amount || 0);

      if (tx.donor === walletAddress) {
        sentStroops += s;
        analytics.sentCount += 1;
        analytics.sentTransactions.push({
          id: tx.id,
          amount: tx.amount,
          recipient: this.getDisplayKey(tx.recipient, false, isAdmin),
          timestamp: tx.timestamp,
          status: tx.status
        });
      }

      if (tx.recipient === walletAddress) {
        receivedStroops += s;
        analytics.receivedCount += 1;
        analytics.receivedTransactions.push({
          id: tx.id,
          amount: tx.amount,
          donor: this.getDisplayKey(tx.donor, tx.anonymous, isAdmin),
          timestamp: tx.timestamp,
          status: tx.status
        });
      }
    });

    analytics.totalSent = fromStroops(sentStroops);
    analytics.totalReceived = fromStroops(receivedStroops);
    analytics.donationCount = analytics.sentCount + analytics.receivedCount;

    return analytics;
  }

  /**
   * Get orphaned transaction stats from the database
   * @returns {Promise<{count: number, totalAmount: number}>}
   */
  static async getOrphanStats() {
    const Database = require('../utils/database');
    const rows = await Database.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as totalAmount FROM transactions WHERE is_orphan = 1',
      []
    );
    const row = rows[0] || { count: 0, totalAmount: 0 };
    return { count: row.count, totalAmount: row.totalAmount };
  }

  /**
   * Get memo collision statistics — flagged and suspicious transactions.
   *
   * @param {Date|null} [startDate]
   * @param {Date|null} [endDate]
   * @returns {{
   *   totalCollisions: number,
   *   totalSuspicious: number,
   *   transactions: Array
   * }}
   */
  static getMemoCollisionStats(startDate = null, endDate = null) {
    const Transaction = require('../models/transaction');
    let transactions = Transaction.getAll();

    if (startDate || endDate) {
      transactions = transactions.filter(t => {
        const ts = new Date(t.timestamp);
        if (startDate && ts < startDate) return false;
        if (endDate && ts > endDate) return false;
        return true;
      });
    }

    const collisions = transactions.filter(t => t.memoCollision === true);
    const suspicious = collisions.filter(t => t.memoSuspicious === true);

    return {
      totalCollisions: collisions.length,
      totalSuspicious: suspicious.length,
      transactions: collisions.map(t => ({
        id: t.id,
        memo: t.memo,
        donor: t.donor,
        recipient: t.recipient,
        amount: t.amount,
        memoSuspicious: t.memoSuspicious,
        memoCollisionReason: t.memoCollisionReason,
        timestamp: t.timestamp,
      })),
    };
  }

  /**
   * Reads from the JSON transaction store and aggregates flagged overpayments.
   *
   * @param {Date|null} [startDate] - Optional start of date range
   * @param {Date|null} [endDate]   - Optional end of date range
   * @returns {{
   *   totalOverpayments: number,
   *   totalExcessAmount: number,
   *   averageExcessAmount: number,
   *   transactions: Array
   * }}
   */
  static getOverpaymentStats(startDate = null, endDate = null) {
    const Transaction = require('../models/transaction');
    let transactions = Transaction.getAll();

    // Apply optional date filter
    if (startDate || endDate) {
      transactions = transactions.filter(t => {
        const ts = new Date(t.timestamp);
        if (startDate && ts < startDate) return false;
        if (endDate && ts > endDate) return false;
        return true;
      });
    }

    const overpaid = transactions.filter(t => t.overpaymentFlagged === true);

    const totalExcessAmount = parseFloat(
      overpaid.reduce((sum, t) => sum + (t.overpaymentDetails?.excessAmount || 0), 0).toFixed(7)
    );

    return {
      totalOverpayments: overpaid.length,
      totalExcessAmount,
      averageExcessAmount: overpaid.length > 0
        ? parseFloat((totalExcessAmount / overpaid.length).toFixed(7))
        : 0,
      transactions: overpaid.map(t => ({
        id: t.id,
        donor: t.donor,
        recipient: t.recipient,
        donationAmount: t.amount,
        analyticsFee: t.analyticsFee,
        expectedTotal: t.overpaymentDetails?.expectedTotal,
        receivedAmount: t.overpaymentDetails?.receivedAmount,
        excessAmount: t.overpaymentDetails?.excessAmount,
        overpaymentPercentage: t.overpaymentDetails?.overpaymentPercentage,
        detectedAt: t.overpaymentDetails?.detectedAt,
        timestamp: t.timestamp,
      })),
    };
  }

  /**
   * Parse a period string (e.g. '7d', '30d', '90d', '1y') into a date range.
   * @param {string} period
   * @returns {{ start: Date, end: Date, granularity: string }}
   */
  static parsePeriod(period = '30d') {
    const now = new Date();
    const match = String(period).match(/^(\d+)(h|d|w|m|y)$/i);
    if (!match) {
      const err = new Error('Invalid period format. Use e.g. 7d, 24h, 4w, 3m, 1y');
      err.statusCode = 400;
      throw err;
    }

    const [, n, unit] = match;
    const num = parseInt(n, 10);
    const start = new Date(now);

    switch (unit.toLowerCase()) {
      case 'h': start.setHours(start.getHours() - num); break;
      case 'd': start.setDate(start.getDate() - num); break;
      case 'w': start.setDate(start.getDate() - num * 7); break;
      case 'm': start.setMonth(start.getMonth() - num); break;
      case 'y': start.setFullYear(start.getFullYear() - num); break;
    }

    const hours = (now - start) / 3_600_000;
    let granularity = 'daily';
    if (hours <= 48) granularity = 'hourly';
    else if (hours <= 24 * 14) granularity = 'daily';
    else if (hours <= 24 * 90) granularity = 'weekly';
    else granularity = 'monthly';

    return { start, end: now, granularity };
  }

  /**
   * Bucket transactions by granularity.
   * @param {Array} transactions
   * @param {'hourly'|'daily'|'weekly'|'monthly'} granularity
   * @returns {Array<{bucket: string, count: number, totalAmount: number, avgAmount: number}>}
   */
  static bucketByGranularity(transactions, granularity) {
    const map = new Map();

    for (const tx of transactions) {
      const d = new Date(tx.timestamp);
      let key;
      switch (granularity) {
        case 'hourly':
          key = `${d.toISOString().slice(0, 13)}:00:00Z`;
          break;
        case 'weekly':
          key = StatsService.getWeekKey(d).key;
          break;
        case 'monthly':
          key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          key = StatsService.getDateKey(d);
      }

      if (!map.has(key)) map.set(key, { bucket: key, count: 0, totalAmount: 0 });
      const b = map.get(key);
      b.count += 1;
      b.totalAmount += parseFloat(tx.amount) || 0;
    }

    return Array.from(map.values())
      .map(b => ({ ...b, totalAmount: +b.totalAmount.toFixed(7), avgAmount: b.count ? +(b.totalAmount / b.count).toFixed(7) : 0 }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  /**
   * Compute a simple moving average over bucketed trend data.
   * @param {Array<{bucket: string, totalAmount: number}>} buckets
   * @param {number} [window=3]
   * @returns {Array<{bucket: string, movingAvg: number}>}
   */
  static movingAverage(buckets, window = 3) {
    return buckets.map((b, i) => {
      const slice = buckets.slice(Math.max(0, i - window + 1), i + 1);
      const avg = slice.reduce((s, x) => s + x.totalAmount, 0) / slice.length;
      return { bucket: b.bucket, movingAvg: +avg.toFixed(7) };
    });
  }

  /**
   * Build the full dashboard analytics payload with 5-minute caching.
   *
   * @param {object} [options]
   * @param {string} [options.period='30d']       - Period string (e.g. '7d', '24h', '3m').
   * @param {string} [options.granularity]        - Override: hourly|daily|weekly|monthly.
   * @param {number} [options.topN=10]            - Top donors/recipients count.
   * @param {number} [options.movingAvgWindow=3]  - Moving average window size.
   * @param {boolean} [options.isAdmin=false]     - Whether caller is admin (for anonymization).
   * @returns {object} Dashboard data payload.
   */
  static getDashboardData({ period = '30d', granularity: granularityOverride, topN = 10, movingAvgWindow = 3, isAdmin = false } = {}) {
    const Cache = require('../utils/cache');
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const cacheKey = `dashboard:${period}:${granularityOverride || 'auto'}:${topN}:${movingAvgWindow}:${isAdmin ? 'admin' : 'user'}`;

    const cached = Cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { start, end, granularity: autoGranularity } = StatsService.parsePeriod(period);
    const granularity = granularityOverride || autoGranularity;

    const Transaction = require('../models/transaction');
    const transactions = Transaction.getByDateRange(start, end);

    const totalAmount = transactions.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
    const totalDonations = transactions.length;
    const avgAmount = totalDonations ? totalAmount / totalDonations : 0;

    const trendBuckets = StatsService.bucketByGranularity(transactions, granularity);
    const trendMovingAvg = StatsService.movingAverage(trendBuckets, movingAvgWindow);

    const donorMap = new Map();
    for (const tx of transactions) {
      if (tx.anonymous) continue; // exclude anonymous donations from public leaderboard
      const key = tx.donor || 'anonymous';
      if (!donorMap.has(key)) donorMap.set(key, { address: key, totalAmount: 0, count: 0 });
      const d = donorMap.get(key);
      d.totalAmount += parseFloat(tx.amount) || 0;
      d.count += 1;
    }
    const topDonors = Array.from(donorMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, topN)
      .map(d => ({ ...d, totalAmount: +d.totalAmount.toFixed(7) }));

    const recipientMap = new Map();
    for (const tx of transactions) {
      const key = tx.recipient || 'unknown';
      if (!recipientMap.has(key)) recipientMap.set(key, { address: key, totalAmount: 0, count: 0 });
      const r = recipientMap.get(key);
      r.totalAmount += parseFloat(tx.amount) || 0;
      r.count += 1;
    }
    const topRecipients = Array.from(recipientMap.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, topN)
      .map(r => ({ ...r, totalAmount: +r.totalAmount.toFixed(7) }));

    const result = {
      period,
      granularity,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        totalDonations,
        totalAmount: +totalAmount.toFixed(7),
        avgAmount: +avgAmount.toFixed(7),
      },
      trend: trendBuckets,
      trendMovingAvg,
      topDonors,
      topRecipients,
      cached: false,
    };

    Cache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  }

  /**
   * Get anonymous vs identified donation breakdown
   * @param {Date} startDate - Start date for aggregation
   * @param {Date} endDate - End date for aggregation
   * @returns {object} Breakdown with anonymous and identified totals
   */
  static getAnonymousBreakdown(startDate, endDate) {
    const Transaction = require('../models/transaction');
    const transactions = Transaction.getByDateRange(startDate, endDate);
    let anonymousCount = 0;
    let anonymousAmount = 0;
    let identifiedCount = 0;
    let identifiedAmount = 0;

    transactions.forEach(tx => {
      const amount = parseFloat(tx.amount) || 0;
      if (tx.anonymous) {
        anonymousCount += 1;
        anonymousAmount += amount;
      } else {
        identifiedCount += 1;
        identifiedAmount += amount;
      }
    });

    return {
      anonymous: {
        count: anonymousCount,
        totalAmount: +anonymousAmount.toFixed(7),
      },
      identified: {
        count: identifiedCount,
        totalAmount: +identifiedAmount.toFixed(7),
      },
      total: {
        count: anonymousCount + identifiedCount,
        totalAmount: +(anonymousAmount + identifiedAmount).toFixed(7),
      },
    };
  }
}

// ─── Dashboard analytics (appended) ──────────────────────────────────────────

// Invalidate dashboard AND stats cache whenever a new donation is created
const donationEvents = require('../events/donationEvents');
donationEvents.on('donation.created', () => {
  const Cache = require('../utils/cache');
  Cache.clearPrefix('dashboard:');
  Cache.clearPrefix('stats:');
});

module.exports = StatsService;
