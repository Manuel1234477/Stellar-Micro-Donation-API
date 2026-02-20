const request = require('supertest');
const app = require('../src/routes/app');
const Transaction = require('../src/routes/models/transaction');

describe('Wallet Analytics API Integration Tests', () => {
  beforeEach(() => {
    // Mock Transaction methods
    jest.spyOn(Transaction, 'loadTransactions').mockReturnValue([
      {
        id: '1',
        amount: 100,
        donor: 'GALICE123',
        recipient: 'GBOB456',
        timestamp: '2024-02-10T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '2',
        amount: 50,
        donor: 'GALICE123',
        recipient: 'GCHARLIE789',
        timestamp: '2024-02-11T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '3',
        amount: 75,
        donor: 'GBOB456',
        recipient: 'GALICE123',
        timestamp: '2024-02-12T10:00:00.000Z',
        status: 'completed'
      },
      {
        id: '4',
        amount: 200,
        donor: 'GCHARLIE789',
        recipient: 'GALICE123',
        timestamp: '2024-02-13T10:00:00.000Z',
        status: 'completed'
      }
    ]);

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

  describe('GET /stats/wallet/:walletAddress/analytics', () => {
    test('should return wallet analytics without date filtering', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        walletAddress: 'GALICE123',
        totalSent: 150,
        totalReceived: 275,
        sentCount: 2,
        receivedCount: 2,
        donationCount: 4,
        dateRange: 'lifetime'
      });
    });

    test('should return wallet analytics with date filtering', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .query({
          startDate: '2024-02-11T00:00:00.000Z',
          endDate: '2024-02-13T23:59:59.999Z'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        walletAddress: 'GALICE123',
        totalSent: 50,
        totalReceived: 275,
        sentCount: 1,
        receivedCount: 2,
        donationCount: 3
      });
      expect(response.body.data.dateRange).toHaveProperty('start');
      expect(response.body.data.dateRange).toHaveProperty('end');
    });

    test('should return 400 if only startDate is provided', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .query({ startDate: '2024-02-11T00:00:00.000Z' })
        .expect(400);

      expect(response.body.error).toBe('Both startDate and endDate are required for date filtering');
    });

    test('should return 400 if only endDate is provided', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .query({ endDate: '2024-02-13T23:59:59.999Z' })
        .expect(400);

      expect(response.body.error).toBe('Both startDate and endDate are required for date filtering');
    });

    test('should return 400 for invalid date format', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .query({
          startDate: 'invalid-date',
          endDate: '2024-02-13T23:59:59.999Z'
        })
        .expect(400);

      expect(response.body.error).toBe('Invalid date format. Use ISO format (YYYY-MM-DD or ISO 8601)');
    });

    test('should return 400 if startDate is after endDate', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .query({
          startDate: '2024-02-20T00:00:00.000Z',
          endDate: '2024-02-10T23:59:59.999Z'
        })
        .expect(400);

      expect(response.body.error).toBe('startDate must be before endDate');
    });

    test('should return empty analytics for non-existent wallet', async () => {
      const response = await request(app)
        .get('/stats/wallet/GNONEXISTENT/analytics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        walletAddress: 'GNONEXISTENT',
        totalSent: 0,
        totalReceived: 0,
        sentCount: 0,
        receivedCount: 0,
        donationCount: 0
      });
    });

    test('should include transaction details in response', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .expect(200);

      expect(response.body.data.sentTransactions).toHaveLength(2);
      expect(response.body.data.receivedTransactions).toHaveLength(2);
      expect(response.body.data.sentTransactions[0]).toHaveProperty('id');
      expect(response.body.data.sentTransactions[0]).toHaveProperty('amount');
      expect(response.body.data.sentTransactions[0]).toHaveProperty('recipient');
      expect(response.body.data.sentTransactions[0]).toHaveProperty('timestamp');
    });

    test('should handle wallet with only sent transactions', async () => {
      const response = await request(app)
        .get('/stats/wallet/GCHARLIE789/analytics')
        .expect(200);

      expect(response.body.data).toMatchObject({
        walletAddress: 'GCHARLIE789',
        totalSent: 200,
        totalReceived: 50,
        sentCount: 1,
        receivedCount: 1,
        donationCount: 2
      });
    });

    test('should handle wallet with only received transactions', async () => {
      const response = await request(app)
        .get('/stats/wallet/GBOB456/analytics')
        .expect(200);

      expect(response.body.data).toMatchObject({
        walletAddress: 'GBOB456',
        totalSent: 75,
        totalReceived: 100,
        sentCount: 1,
        receivedCount: 1,
        donationCount: 2
      });
    });

    test('should handle empty result when no transactions in date range', async () => {
      const response = await request(app)
        .get('/stats/wallet/GALICE123/analytics')
        .query({
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-01-31T23:59:59.999Z'
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        walletAddress: 'GALICE123',
        totalSent: 0,
        totalReceived: 0,
        donationCount: 0
      });
    });
  });
});
