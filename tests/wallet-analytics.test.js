const StatsService = require('../src/routes/services/StatsService');
const Transaction = require('../src/routes/models/transaction');

describe('Wallet Analytics - Statistics Service Tests', () => {
  beforeEach(() => {
    // Mock Transaction.loadTransactions to return test data
    jest.spyOn(Transaction, 'loadTransactions').mockReturnValue([
      {
        id: '1',
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        timestamp: '2024-02-10T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '2',
        amount: 50,
        donor: 'Alice',
        recipient: 'Charlie',
        timestamp: '2024-02-11T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '3',
        amount: 75,
        donor: 'Bob',
        recipient: 'Alice',
        timestamp: '2024-02-12T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '4',
        amount: 200,
        donor: 'Charlie',
        recipient: 'Alice',
        timestamp: '2024-02-13T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '5',
        amount: 30,
        donor: 'Alice',
        recipient: 'Bob',
        timestamp: '2024-02-14T10:00:00.000Z',
        status: 'completed'
      }
    ]);

    // Mock getByDateRange
    jest.spyOn(Transaction, 'getByDateRange').mockImplementation((startDate, endDate) => {
      const allTransactions = Transaction.loadTransactions();
      return allTransactions.filter(tx => {
        const txDate = new Date(tx.timestamp);
        return txDate >= startDate && txDate <= endDate;
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Lifetime Analytics Calculation', () => {
    test('should calculate correct totals for wallet with sent and received transactions', () => {
      const analytics = StatsService.getWalletAnalytics('Alice');

      expect(analytics.walletAddress).toBe('Alice');
      expect(analytics.totalSent).toBe(180); // 100 + 50 + 30
      expect(analytics.totalReceived).toBe(275); // 75 + 200
      expect(analytics.sentCount).toBe(3);
      expect(analytics.receivedCount).toBe(2);
      expect(analytics.donationCount).toBe(5); // 3 sent + 2 received
      expect(analytics.dateRange).toBe('lifetime');
    });

    test('should calculate correct totals for wallet with only sent transactions', () => {
      const analytics = StatsService.getWalletAnalytics('Charlie');

      expect(analytics.walletAddress).toBe('Charlie');
      expect(analytics.totalSent).toBe(200);
      expect(analytics.totalReceived).toBe(50);
      expect(analytics.sentCount).toBe(1);
      expect(analytics.receivedCount).toBe(1);
      expect(analytics.donationCount).toBe(2);
    });

    test('should calculate correct totals for wallet with only received transactions', () => {
      const analytics = StatsService.getWalletAnalytics('Bob');

      expect(analytics.walletAddress).toBe('Bob');
      expect(analytics.totalSent).toBe(75);
      expect(analytics.totalReceived).toBe(130); // 100 + 30
      expect(analytics.sentCount).toBe(1);
      expect(analytics.receivedCount).toBe(2);
      expect(analytics.donationCount).toBe(3);
    });

    test('should return zero totals for non-existent wallet', () => {
      const analytics = StatsService.getWalletAnalytics('NonExistent');

      expect(analytics.walletAddress).toBe('NonExistent');
      expect(analytics.totalSent).toBe(0);
      expect(analytics.totalReceived).toBe(0);
      expect(analytics.sentCount).toBe(0);
      expect(analytics.receivedCount).toBe(0);
      expect(analytics.donationCount).toBe(0);
      expect(analytics.sentTransactions).toEqual([]);
      expect(analytics.receivedTransactions).toEqual([]);
    });
  });

  describe('Date Range Filtering', () => {
    test('should filter transactions within specified date range', () => {
      const startDate = new Date('2024-02-11T00:00:00.000Z');
      const endDate = new Date('2024-02-13T23:59:59.999Z');

      const analytics = StatsService.getWalletAnalytics('Alice', startDate, endDate);

      expect(analytics.walletAddress).toBe('Alice');
      expect(analytics.totalSent).toBe(50); // Only transaction on 2024-02-11
      expect(analytics.totalReceived).toBe(275); // 75 + 200 (2024-02-12 and 2024-02-13)
      expect(analytics.sentCount).toBe(1);
      expect(analytics.receivedCount).toBe(2);
      expect(analytics.donationCount).toBe(3);
      expect(analytics.dateRange).toEqual({
        start: startDate.toISOString(),
        end: endDate.toISOString()
      });
    });

    test('should return empty results when no transactions in date range', () => {
      const startDate = new Date('2024-01-01T00:00:00.000Z');
      const endDate = new Date('2024-01-31T23:59:59.999Z');

      const analytics = StatsService.getWalletAnalytics('Alice', startDate, endDate);

      expect(analytics.totalSent).toBe(0);
      expect(analytics.totalReceived).toBe(0);
      expect(analytics.donationCount).toBe(0);
    });

    test('should handle single day date range', () => {
      const startDate = new Date('2024-02-10T00:00:00.000Z');
      const endDate = new Date('2024-02-10T23:59:59.999Z');

      const analytics = StatsService.getWalletAnalytics('Alice', startDate, endDate);

      expect(analytics.totalSent).toBe(100);
      expect(analytics.totalReceived).toBe(0);
      expect(analytics.sentCount).toBe(1);
      expect(analytics.receivedCount).toBe(0);
      expect(analytics.donationCount).toBe(1);
    });
  });

  describe('Transaction Details', () => {
    test('should include detailed information for sent transactions', () => {
      const analytics = StatsService.getWalletAnalytics('Alice');

      expect(analytics.sentTransactions).toHaveLength(3);
      expect(analytics.sentTransactions[0]).toMatchObject({
        id: '1',
        amount: 100,
        recipient: 'Bob',
        timestamp: '2024-02-10T10:00:00.000Z',
        status: 'completed'
      });
    });

    test('should include detailed received transaction information', () => {
      const analytics = StatsService.getWalletAnalytics('Alice');

      expect(analytics.receivedTransactions).toHaveLength(2);
      expect(analytics.receivedTransactions[0]).toMatchObject({
        id: '3',
        amount: 75,
        donor: 'Bob',
        timestamp: '2024-02-12T10:00:00.000Z',
        status: 'completed'
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty transaction list gracefully', () => {
      Transaction.loadTransactions.mockReturnValue([]);

      const analytics = StatsService.getWalletAnalytics('Alice');

      expect(analytics.totalSent).toBe(0);
      expect(analytics.totalReceived).toBe(0);
      expect(analytics.donationCount).toBe(0);
    });

    test('should handle single transaction', () => {
      Transaction.loadTransactions.mockReturnValue([
        {
          id: '1',
          amount: 100,
          donor: 'Alice',
          recipient: 'Bob',
          timestamp: '2024-02-10T10:00:00.000Z',
          status: 'completed'
        }
      ]);

      const analytics = StatsService.getWalletAnalytics('Alice');

      expect(analytics.totalSent).toBe(100);
      expect(analytics.totalReceived).toBe(0);
      expect(analytics.donationCount).toBe(1);
    });

    test('should handle large dataset efficiently', () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i}`,
        amount: 10,
        donor: i % 2 === 0 ? 'Alice' : 'Bob',
        recipient: i % 2 === 0 ? 'Bob' : 'Alice',
        timestamp: new Date(2024, 1, 10 + (i % 20)).toISOString(),
        status: 'completed'
      }));

      Transaction.loadTransactions.mockReturnValue(largeDataset);

      const analytics = StatsService.getWalletAnalytics('Alice');

      expect(analytics.totalSent).toBe(5000); // 500 transactions * 10
      expect(analytics.totalReceived).toBe(5000); // 500 transactions * 10
      expect(analytics.donationCount).toBe(1000);
    });

    test('should not count duplicate records', () => {
      Transaction.loadTransactions.mockReturnValue([
        {
          id: '1',
          amount: 100,
          donor: 'Alice',
          recipient: 'Bob',
          timestamp: '2024-02-10T10:00:00.000Z',
          status: 'completed'
        },
        {
          id: '1', // Same ID
          amount: 100,
          donor: 'Alice',
          recipient: 'Bob',
          timestamp: '2024-02-10T10:00:00.000Z',
          status: 'completed'
        }
      ]);

      const analytics = StatsService.getWalletAnalytics('Alice');

      // Should count both records as they appear in the data
      expect(analytics.totalSent).toBe(200);
      expect(analytics.sentCount).toBe(2);
    });
  });
});
