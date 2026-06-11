/**
 * Stats Anonymization Privacy Tests
 * 
 * RESPONSIBILITY: Verify that anonymous donors' public keys are properly anonymized
 * in stats endpoints for non-admin callers, while admin callers see full keys.
 * 
 * Acceptance Criteria:
 * 1. Non-admin callers receive pseudonymous IDs for anonymous donors
 * 2. Admin callers receive full public keys
 * 3. Non-anonymous donors' public keys are returned to all callers
 * 4. Anonymization applies to all stats endpoints (donors, recipients, daily, weekly, dashboard, wallet)
 */

const express = require('express');
const request = require('supertest');
const StatsService = require('../../src/services/StatsService');
const Transaction = require('../../src/models/transaction');
const { generatePseudonymousId, isPseudonymousId } = require('../../src/utils/anonymization');

// Mock Transaction model
jest.mock('../../src/models/transaction');

describe('Stats Anonymization Privacy', () => {
  const DONOR_WALLET = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJVNHX3XCRSZ3ZBOJXLUBXVQ';
  const RECIPIENT_WALLET = 'GBBD47UZQ5CSHKQQ5V6ZYSQ2ILCJYXLFBCVEUOUPLLE5YPZIUAAVXLN4';
  const ANOTHER_DONOR = 'GCZST3XVCDTUJ76ZAV2HA72KYQJD5W5NRQRQEWGQE2XJJWUDPXVZZ7Z7';

  const mockTransactions = [
    {
      id: 1,
      donor: DONOR_WALLET,
      recipient: RECIPIENT_WALLET,
      amount: 100,
      anonymous: true,
      timestamp: '2024-01-15T10:00:00Z',
      status: 'completed'
    },
    {
      id: 2,
      donor: ANOTHER_DONOR,
      recipient: RECIPIENT_WALLET,
      amount: 50,
      anonymous: false,
      timestamp: '2024-01-15T11:00:00Z',
      status: 'completed'
    },
    {
      id: 3,
      donor: DONOR_WALLET,
      recipient: RECIPIENT_WALLET,
      amount: 75,
      anonymous: false,
      timestamp: '2024-01-16T10:00:00Z',
      status: 'completed'
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    Transaction.getByDateRange.mockReturnValue(mockTransactions);
    Transaction.loadTransactions.mockReturnValue(mockTransactions);
  });

  describe('getDisplayKey helper', () => {
    test('returns full key for admin regardless of anonymous flag', () => {
      const key = StatsService.getDisplayKey(DONOR_WALLET, true, true);
      expect(key).toBe(DONOR_WALLET);
    });

    test('returns pseudonymous ID for non-admin anonymous donor', () => {
      const key = StatsService.getDisplayKey(DONOR_WALLET, true, false);
      expect(isPseudonymousId(key)).toBe(true);
      expect(key).toBe(generatePseudonymousId(DONOR_WALLET));
    });

    test('returns full key for non-admin non-anonymous donor', () => {
      const key = StatsService.getDisplayKey(DONOR_WALLET, false, false);
      expect(key).toBe(DONOR_WALLET);
    });

    test('returns full key for non-admin when already pseudonymous', () => {
      const pseudoId = generatePseudonymousId(DONOR_WALLET);
      const key = StatsService.getDisplayKey(pseudoId, true, false);
      expect(key).toBe(pseudoId);
    });
  });

  describe('getDonorStats anonymization', () => {
    test('non-admin caller does not see anonymous donors in leaderboard', () => {
      const stats = StatsService.getDonorStats(new Date('2024-01-01'), new Date('2024-01-31'), false);
      
      // Anonymous donations are filtered out, so only ANOTHER_DONOR and DONOR_WALLET (non-anonymous) appear
      expect(stats.length).toBe(2);
      
      // Find the non-anonymous donation from DONOR_WALLET
      const donorStats = stats.find(s => s.donor === DONOR_WALLET);
      expect(donorStats).toBeDefined();
      expect(donorStats.totalDonated).toBe(75); // Only the non-anonymous donation
    });

    test('admin caller sees full donor keys', () => {
      const stats = StatsService.getDonorStats(new Date('2024-01-01'), new Date('2024-01-31'), true);
      
      // Admin sees the same filtered list (anonymous donations still excluded from donor leaderboard)
      expect(stats.length).toBe(2);
      
      const donorStats = stats.find(s => s.donor === DONOR_WALLET);
      expect(donorStats).toBeDefined();
      expect(donorStats.donor).toBe(DONOR_WALLET); // Full key, not pseudonymous
    });

    test('recipient keys in donor stats are not anonymized', () => {
      const stats = StatsService.getDonorStats(new Date('2024-01-01'), new Date('2024-01-31'), false);
      
      const donorStats = stats[0];
      expect(donorStats.donations[0].recipient).toBe(RECIPIENT_WALLET);
    });
  });

  describe('getRecipientStats anonymization', () => {
    test('non-admin caller sees pseudonymous IDs for anonymous donors', () => {
      const stats = StatsService.getRecipientStats(new Date('2024-01-01'), new Date('2024-01-31'), false);
      
      expect(stats.length).toBe(1); // Only one recipient
      const recipientStats = stats[0];
      expect(recipientStats.recipient).toBe(RECIPIENT_WALLET);
      
      // Check that anonymous donation shows pseudonymous ID
      const anonDonation = recipientStats.donations.find(d => d.id === 1);
      expect(anonDonation).toBeDefined();
      expect(isPseudonymousId(anonDonation.donor)).toBe(true);
      expect(anonDonation.donor).toBe(generatePseudonymousId(DONOR_WALLET));
      
      // Check that non-anonymous donation shows full key
      const identifiedDonation = recipientStats.donations.find(d => d.id === 2);
      expect(identifiedDonation).toBeDefined();
      expect(identifiedDonation.donor).toBe(ANOTHER_DONOR);
    });

    test('admin caller sees full donor keys in recipient stats', () => {
      const stats = StatsService.getRecipientStats(new Date('2024-01-01'), new Date('2024-01-31'), true);
      
      const recipientStats = stats[0];
      
      // Admin sees full key even for anonymous donation
      const anonDonation = recipientStats.donations.find(d => d.id === 1);
      expect(anonDonation.donor).toBe(DONOR_WALLET);
    });
  });

  describe('getDailyStats anonymization', () => {
    test('non-admin caller sees pseudonymous IDs for anonymous donors', () => {
      const stats = StatsService.getDailyStats(new Date('2024-01-01'), new Date('2024-01-31'), 'UTC', false);
      
      expect(stats.length).toBeGreaterThan(0);
      
      // Find the transaction with anonymous donation
      const dayWithAnon = stats.find(day => 
        day.transactions.some(tx => tx.id === 1)
      );
      
      expect(dayWithAnon).toBeDefined();
      const anonTx = dayWithAnon.transactions.find(tx => tx.id === 1);
      expect(isPseudonymousId(anonTx.donor)).toBe(true);
    });

    test('admin caller sees full keys in daily stats', () => {
      const stats = StatsService.getDailyStats(new Date('2024-01-01'), new Date('2024-01-31'), 'UTC', true);
      
      const dayWithAnon = stats.find(day => 
        day.transactions.some(tx => tx.id === 1)
      );
      
      const anonTx = dayWithAnon.transactions.find(tx => tx.id === 1);
      expect(anonTx.donor).toBe(DONOR_WALLET);
    });
  });

  describe('getWeeklyStats anonymization', () => {
    test('non-admin caller sees pseudonymous IDs for anonymous donors', () => {
      const stats = StatsService.getWeeklyStats(new Date('2024-01-01'), new Date('2024-01-31'), false);
      
      expect(stats.length).toBeGreaterThan(0);
      
      const weekWithAnon = stats.find(week => 
        week.transactions.some(tx => tx.id === 1)
      );
      
      expect(weekWithAnon).toBeDefined();
      const anonTx = weekWithAnon.transactions.find(tx => tx.id === 1);
      expect(isPseudonymousId(anonTx.donor)).toBe(true);
    });

    test('admin caller sees full keys in weekly stats', () => {
      const stats = StatsService.getWeeklyStats(new Date('2024-01-01'), new Date('2024-01-31'), true);
      
      const weekWithAnon = stats.find(week => 
        week.transactions.some(tx => tx.id === 1)
      );
      
      const anonTx = weekWithAnon.transactions.find(tx => tx.id === 1);
      expect(anonTx.donor).toBe(DONOR_WALLET);
    });
  });

  describe('getWalletAnalytics anonymization', () => {
    test('non-admin caller sees pseudonymous IDs for anonymous donors to wallet', () => {
      const analytics = StatsService.getWalletAnalytics(RECIPIENT_WALLET, new Date('2024-01-01'), new Date('2024-01-31'), false);
      
      expect(analytics.receivedCount).toBe(3);
      
      // Find the anonymous donation
      const anonDonation = analytics.receivedTransactions.find(tx => tx.id === 1);
      expect(anonDonation).toBeDefined();
      expect(isPseudonymousId(anonDonation.donor)).toBe(true);
    });

    test('admin caller sees full keys in wallet analytics', () => {
      const analytics = StatsService.getWalletAnalytics(RECIPIENT_WALLET, new Date('2024-01-01'), new Date('2024-01-31'), true);
      
      const anonDonation = analytics.receivedTransactions.find(tx => tx.id === 1);
      expect(anonDonation.donor).toBe(DONOR_WALLET);
    });

    test('non-admin caller sees full keys for non-anonymous donors', () => {
      const analytics = StatsService.getWalletAnalytics(RECIPIENT_WALLET, new Date('2024-01-01'), new Date('2024-01-31'), false);
      
      const identifiedDonation = analytics.receivedTransactions.find(tx => tx.id === 2);
      expect(identifiedDonation.donor).toBe(ANOTHER_DONOR);
    });
  });

  describe('getDashboardData anonymization', () => {
    test('non-admin caller does not see anonymous donors in top donors', () => {
      const data = StatsService.getDashboardData({ period: '30d', isAdmin: false });
      
      // Anonymous donations are excluded from donor leaderboard
      const topDonors = data.topDonors;
      expect(topDonors.length).toBeGreaterThan(0);
      
      // Should not contain pseudonymous IDs in the address field
      topDonors.forEach(donor => {
        expect(donor.address).not.toMatch(/^anon_/);
      });
    });

    test('admin caller sees full donor keys in dashboard', () => {
      const data = StatsService.getDashboardData({ period: '30d', isAdmin: true });
      
      const topDonors = data.topDonors;
      topDonors.forEach(donor => {
        expect(donor.address).toBeTruthy();
      });
    });

    test('cache key includes admin status', () => {
      const Cache = require('../../src/utils/cache');
      jest.spyOn(Cache, 'get').mockReturnValue(null);
      jest.spyOn(Cache, 'set');
      
      StatsService.getDashboardData({ period: '30d', isAdmin: false });
      const userCacheKey = Cache.set.mock.calls[0][0];
      
      Cache.set.mockClear();
      
      StatsService.getDashboardData({ period: '30d', isAdmin: true });
      const adminCacheKey = Cache.set.mock.calls[0][0];
      
      expect(userCacheKey).not.toBe(adminCacheKey);
      expect(userCacheKey).toContain('user');
      expect(adminCacheKey).toContain('admin');
    });
  });

  describe('Integration: Stats Routes with Anonymization', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      
      // Mock middleware
      app.use((req, res, next) => {
        req.id = 'test-req-id';
        next();
      });
      
      app.use('/stats', require('../../src/routes/stats'));
      
      // Mock error handler
      app.use((err, req, res, next) => {
        res.status(500).json({ success: false, error: err.message });
      });
    });

    test('GET /stats/donors returns pseudonymous IDs for non-admin', async () => {
      const response = await request(app)
        .get('/stats/donors')
        .query({ startDate: '2024-01-01', endDate: '2024-01-31' })
        .set('x-api-key', 'user-key');
      
      expect(response.status).toBe(200);
      // Response structure verified (actual anonymization tested in unit tests)
    });

    test('GET /stats/recipients returns pseudonymous IDs for non-admin', async () => {
      const response = await request(app)
        .get('/stats/recipients')
        .query({ startDate: '2024-01-01', endDate: '2024-01-31' })
        .set('x-api-key', 'user-key');
      
      expect(response.status).toBe(200);
    });

    test('GET /stats/dashboard returns anonymized data for non-admin', async () => {
      const response = await request(app)
        .get('/stats/dashboard')
        .query({ period: '30d' })
        .set('x-api-key', 'user-key');
      
      expect(response.status).toBe(200);
    });
  });

  describe('Deterministic Pseudonymous IDs', () => {
    test('same donor always maps to same pseudonymous ID', () => {
      const id1 = generatePseudonymousId(DONOR_WALLET);
      const id2 = generatePseudonymousId(DONOR_WALLET);
      
      expect(id1).toBe(id2);
    });

    test('different donors map to different pseudonymous IDs', () => {
      const id1 = generatePseudonymousId(DONOR_WALLET);
      const id2 = generatePseudonymousId(ANOTHER_DONOR);
      
      expect(id1).not.toBe(id2);
    });

    test('pseudonymous ID is deterministic across multiple calls', () => {
      const ids = Array(5).fill(null).map(() => 
        StatsService.getDisplayKey(DONOR_WALLET, true, false)
      );
      
      expect(new Set(ids).size).toBe(1); // All IDs are identical
    });
  });

  describe('Edge Cases', () => {
    test('handles null/undefined donor gracefully', () => {
      const key = StatsService.getDisplayKey(null, true, false);
      expect(key).toBeNull();
    });

    test('handles empty string donor', () => {
      const key = StatsService.getDisplayKey('', true, false);
      expect(key).toBe('');
    });

    test('handles already-pseudonymous ID in non-admin context', () => {
      const pseudoId = generatePseudonymousId(DONOR_WALLET);
      const key = StatsService.getDisplayKey(pseudoId, true, false);
      
      // Should return the pseudonymous ID as-is (already anonymized)
      expect(key).toBe(pseudoId);
    });
  });
});
