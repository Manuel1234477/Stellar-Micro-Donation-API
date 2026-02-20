const Transaction = require('../models/transaction');

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
}

module.exports = StatsService;
