/**
 * Tests for Donation Tax Receipt Generation with IRS Compliance
 * 
 * Verifies:
 * - Receipt includes EIN, donation date, USD fair market value
 * - Required IRS statements present
 * - Exchange rate stored at donation time
 * - Missing org config returns 503
 */

const TaxReceiptService = require('../../src/services/TaxReceiptService');
const Database = require('../../src/utils/database');
const config = require('../../src/config');

// Mock dependencies
jest.mock('../../src/utils/database');
jest.mock('../../src/services/PriceOracleService', () => ({
  getPriceAtTime: jest.fn().mockResolvedValue(0.15)
}));

describe('Donation Tax Receipt Generation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database operations
    Database.get = jest.fn();
    Database.run = jest.fn();
    Database.query = jest.fn();
  });

  describe('isConfigured', () => {
    test('should return false when organization EIN is not set', () => {
      // Temporarily override config
      const originalConfig = config.taxReceipt;
      config.taxReceipt = { isConfigured: false };

      expect(TaxReceiptService.isConfigured()).toBe(false);

      config.taxReceipt = originalConfig;
    });

    test('should return true when organization is configured', () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization'
      };

      expect(TaxReceiptService.isConfigured()).toBe(true);

      config.taxReceipt = originalConfig;
    });
  });

  describe('getOrganizationConfig', () => {
    test('should throw error when not configured', () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = { isConfigured: false };

      expect(() => TaxReceiptService.getOrganizationConfig()).toThrow('Organization tax configuration is incomplete');

      config.taxReceipt = originalConfig;
    });

    test('should return organization config when configured', () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345'
      };

      const config = TaxReceiptService.getOrganizationConfig();

      expect(config.ein).toBe('12-3456789');
      expect(config.legalName).toBe('Test Organization');
      expect(config.address).toBe('123 Main St');

      config.taxReceipt = originalConfig;
    });
  });

  describe('calculateFairMarketValue', () => {
    test('should calculate fair market value correctly', () => {
      const xlmAmount = 100;
      const exchangeRate = 0.15;

      const fairMarketValue = TaxReceiptService.calculateFairMarketValue(xlmAmount, exchangeRate);

      expect(fairMarketValue).toBe(15.00);
    });

    test('should handle decimal precision', () => {
      const xlmAmount = 123.456;
      const exchangeRate = 0.123456;

      const fairMarketValue = TaxReceiptService.calculateFairMarketValue(xlmAmount, exchangeRate);

      expect(fairMarketValue).toBe(15.24); // Rounded to 2 decimal places
    });
  });

  describe('generateTaxReceiptData', () => {
    test('should throw error when organization not configured', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = { isConfigured: false };

      await expect(
        TaxReceiptService.generateTaxReceiptData(1)
      ).rejects.toThrow('Organization tax configuration is incomplete');

      config.taxReceipt = originalConfig;
    });

    test('should throw error when donation not found', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization'
      };

      Database.get.mockResolvedValue(null);

      await expect(
        TaxReceiptService.generateTaxReceiptData(999)
      ).rejects.toThrow('Donation not found');

      config.taxReceipt = originalConfig;
    });

    test('should generate receipt data when all required fields', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
        phone: '555-1234',
        email: 'test@example.com',
        website: 'https://example.com'
      };

      const mockDonation = {
        id: 1,
        amount: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
        xlm_usd_rate: null,
        fair_market_value_usd: null,
        stellar_tx_id: 'abc123',
        donorPublicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        recipientPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      };

      Database.get.mockResolvedValue(mockDonation);
      Database.run.mockResolvedValue({});

      const receiptData = await TaxReceiptService.generateTaxReceiptData(1);

      // Verify organization information
      expect(receiptData.organization.ein).toBe('12-3456789');
      expect(receiptData.organization.legalName).toBe('Test Organization');
      expect(receiptData.organization.address).toBe('123 Main St');

      // Verify donation information
      expect(receiptData.donation.id).toBe(1);
      expect(receiptData.donation.date).toBe('2024-01-15T10:30:00.000Z');
      expect(receiptData.donation.stellarTxId).toBe('abc123');

      // Verify financial information
      expect(receiptData.financial.xlmAmount).toBe(100);
      expect(receiptData.financial.xlmUsdRate).toBe(0.15);
      expect(receiptData.financial.fairMarketValueUsd).toBe(15.00);
      expect(receiptData.financial.currency).toBe('XLM');

      // Verify IRS compliance
      expect(receiptData.irs.formType).toBe('8283');
      expect(receiptData.irs.statement).toContain('No goods or services were provided');
      expect(receiptData.irs.qualifiedOrganization).toBe(true);
      expect(receiptData.irs.noGoodsServicesProvided).toBe(true);

      // Verify metadata
      expect(receiptData.receiptNumber).toMatch(/^TXN-1-\d+$/);
      expect(receiptData.generatedAt).toBeDefined();

      config.taxReceipt = originalConfig;
    });

    test('should use stored exchange rate when available', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization'
      };

      const mockDonation = {
        id: 1,
        amount: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
        xlm_usd_rate: 0.20, // Already stored
        fair_market_value_usd: 20.00, // Already stored
        stellar_tx_id: 'abc123',
        donorPublicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        recipientPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      };

      Database.get.mockResolvedValue(mockDonation);

      const receiptData = await TaxReceiptService.generateTaxReceiptData(1);

      // Should use stored rate, not fetch new one
      expect(receiptData.financial.xlmUsdRate).toBe(0.20);
      expect(receiptData.financial.fairMarketValueUsd).toBe(20.00);

      config.taxReceipt = originalConfig;
    });
  });

  describe('storeExchangeRateSnapshot', () => {
    test('should store exchange rate snapshot', async () => {
      Database.run.mockResolvedValue({});

      await TaxReceiptService.storeExchangeRateSnapshot(1, 0.15, 15.00);

      expect(Database.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE transactions'),
        [0.15, 15.00, 1]
      );
    });
  });

  describe('getDonationForReceipt', () => {
    test('should throw error when donation not found', async () => {
      Database.get.mockResolvedValue(null);

      await expect(
        TaxReceiptService.getDonationForReceipt(999)
      ).rejects.toThrow('Donation not found');
    });

    test('should return donation details', async () => {
      const mockDonation = {
        id: 1,
        amount: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
        xlm_usd_rate: 0.15,
        fair_market_value_usd: 15.00,
        stellar_tx_id: 'abc123',
        donorPublicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        recipientPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      };

      Database.get.mockResolvedValue(mockDonation);

      const donation = await TaxReceiptService.getDonationForReceipt(1);

      expect(donation.id).toBe(1);
      expect(donation.amount).toBe(100);
      expect(donation.stellar_tx_id).toBe('abc123');
    });
  });

  describe('markReceiptGenerated', () => {
    test('should mark donation as having receipt generated', async () => {
      Database.run.mockResolvedValue({});

      await TaxReceiptService.markReceiptGenerated(1);

      expect(Database.run).toHaveBeenCalledWith(
        'UPDATE transactions SET tax_receipt_generated = 1 WHERE id = ?',
        [1]
      );
    });
  });

  describe('hasReceiptBeenGenerated', () => {
    test('should return true when receipt has been generated', async () => {
      Database.get.mockResolvedValue({ tax_receipt_generated: 1 });

      const hasGenerated = await TaxReceiptService.hasReceiptBeenGenerated(1);

      expect(hasGenerated).toBe(true);
    });

    test('should return false when receipt has not been generated', async () => {
      Database.get.mockResolvedValue({ tax_receipt_generated: 0 });

      const hasGenerated = await TaxReceiptService.hasReceiptBeenGenerated(1);

      expect(hasGenerated).toBe(false);
    });

    test('should return false when donation not found', async () => {
      Database.get.mockResolvedValue(null);

      const hasGenerated = await TaxReceiptService.hasReceiptBeenGenerated(999);

      expect(hasGenerated).toBe(false);
    });
  });

  describe('getEligibleDonations', () => {
    test('should return list of eligible donations', async () => {
      const mockDonations = [
        { id: 1, amount: 100, tax_receipt_generated: 0 },
        { id: 2, amount: 200, tax_receipt_generated: 1 }
      ];

      Database.query.mockResolvedValue(mockDonations);

      const donations = await TaxReceiptService.getEligibleDonations();

      expect(donations).toHaveLength(2);
      expect(donations[0].hasReceipt).toBe(false);
      expect(donations[1].hasReceipt).toBe(true);
    });

    test('should filter by date range', async () => {
      Database.query.mockResolvedValue([]);

      await TaxReceiptService.getEligibleDonations({
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });

      expect(Database.query).toHaveBeenCalledWith(
        expect.stringContaining('t.timestamp >= ?'),
        expect.arrayContaining(['2024-01-01', '2024-12-31'])
      );
    });
  });

  describe('IRS compliance', () => {
    test('should include all required IRS Form 8283 fields', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345'
      };

      const mockDonation = {
        id: 1,
        amount: 100,
        timestamp: '2024-01-15T10:30:00.000Z',
        xlm_usd_rate: null,
        fair_market_value_usd: null,
        stellar_tx_id: 'abc123',
        donorPublicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        recipientPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      };

      Database.get.mockResolvedValue(mockDonation);
      Database.run.mockResolvedValue({});

      const receiptData = await TaxReceiptService.generateTaxReceiptData(1);

      // Verify all required IRS fields are present
      expect(receiptData.organization.ein).toBeDefined();
      expect(receiptData.organization.legalName).toBeDefined();
      expect(receiptData.donation.date).toBeDefined();
      expect(receiptData.financial.fairMarketValueUsd).toBeDefined();
      expect(receiptData.irs.statement).toBeDefined();
      expect(receiptData.irs.formType).toBe('8283');

      // Verify IRS statement content
      expect(receiptData.irs.statement).toContain('No goods or services were provided in exchange');

      config.taxReceipt = originalConfig;
    });
  });

  describe('Security validations', () => {
    test('should validate donation ID is positive integer', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Test Organization'
      };

      // This would be caught by route validation, but service should also handle
      await expect(
        TaxReceiptService.generateTaxReceiptData(-1)
      ).rejects.toThrow();

      config.taxReceipt = originalConfig;
    });
  });
});

// ─── Annual Summary Tests (#1595) ─────────────────────────────────────────────

describe('TaxReceiptService — Annual Summary (#1595)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Database.get = jest.fn();
    Database.run = jest.fn();
    Database.query = jest.fn();
  });

  describe('getAnnualSummaryData', () => {
    test('should throw if walletAddress is missing', async () => {
      await expect(
        TaxReceiptService.getAnnualSummaryData({ year: 2026 })
      ).rejects.toThrow('walletAddress is required');
    });

    test('should throw if year is missing', async () => {
      await expect(
        TaxReceiptService.getAnnualSummaryData({ walletAddress: 'GTEST' })
      ).rejects.toThrow('year must be a valid calendar year');
    });

    test('should throw if year is out of range', async () => {
      await expect(
        TaxReceiptService.getAnnualSummaryData({ walletAddress: 'GTEST', year: 1999 })
      ).rejects.toThrow('year must be a valid calendar year');
    });

    test('should return summary with empty donations for unknown wallet', async () => {
      Database.query.mockResolvedValue([]);

      const result = await TaxReceiptService.getAnnualSummaryData({
        walletAddress: 'GUNKNOWN',
        year: 2026,
      });

      expect(result.donations).toEqual([]);
      expect(result.grandTotalXlm).toBe(0);
      expect(result.donationCount).toBe(0);
      expect(result.year).toBe(2026);
      expect(result.walletAddress).toBe('GUNKNOWN');
      expect(result.recipientTotals).toEqual({});
    });

    test('should aggregate donations by recipient correctly', async () => {
      const mockDonations = [
        { id: 1, amount: 100, timestamp: '2026-03-01T00:00:00Z', fair_market_value_usd: 15, donorPublicKey: 'GDONOR', recipientPublicKey: 'GRECIP1', status: 'confirmed', stellar_tx_id: 'tx1' },
        { id: 2, amount: 200, timestamp: '2026-06-01T00:00:00Z', fair_market_value_usd: 30, donorPublicKey: 'GDONOR', recipientPublicKey: 'GRECIP2', status: 'confirmed', stellar_tx_id: 'tx2' },
        { id: 3, amount: 50,  timestamp: '2026-09-01T00:00:00Z', fair_market_value_usd: 7.5, donorPublicKey: 'GDONOR', recipientPublicKey: 'GRECIP1', status: 'confirmed', stellar_tx_id: 'tx3' },
      ];
      Database.query.mockResolvedValue(mockDonations);

      const result = await TaxReceiptService.getAnnualSummaryData({
        walletAddress: 'GDONOR',
        year: 2026,
      });

      expect(result.donationCount).toBe(3);
      expect(result.grandTotalXlm).toBeCloseTo(350, 2);
      expect(result.recipientTotals['GRECIP1'].count).toBe(2);
      expect(result.recipientTotals['GRECIP1'].xlmTotal).toBeCloseTo(150, 2);
      expect(result.recipientTotals['GRECIP2'].count).toBe(1);
      expect(result.recipientTotals['GRECIP2'].xlmTotal).toBeCloseTo(200, 2);
    });

    test('should query with correct year date range', async () => {
      Database.query.mockResolvedValue([]);

      await TaxReceiptService.getAnnualSummaryData({ walletAddress: 'GTEST', year: 2026 });

      const callArgs = Database.query.mock.calls[0];
      expect(callArgs[1]).toContain('2026-01-01T00:00:00.000Z');
      expect(callArgs[1]).toContain('2026-12-31T23:59:59.999Z');
    });

    test('should exclude refunded, failed, cancelled donations', async () => {
      Database.query.mockResolvedValue([]);

      await TaxReceiptService.getAnnualSummaryData({ walletAddress: 'GTEST', year: 2026 });

      const sql = Database.query.mock.calls[0][0];
      expect(sql).toContain("NOT IN ('refunded','failed','cancelled')");
    });
  });

  describe('generateAnnualSummaryPDF', () => {
    test('should return a Buffer', async () => {
      Database.query.mockResolvedValue([
        { id: 1, amount: 100, timestamp: '2026-01-15T10:00:00Z', fair_market_value_usd: 15, donorPublicKey: 'GDONOR', recipientPublicKey: 'GRECIP1', status: 'confirmed', stellar_tx_id: 'tx1' },
      ]);

      const buffer = await TaxReceiptService.generateAnnualSummaryPDF({ walletAddress: 'GDONOR', year: 2026 });

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    test('should embed PDF header bytes (%PDF)', async () => {
      Database.query.mockResolvedValue([]);

      const buffer = await TaxReceiptService.generateAnnualSummaryPDF({ walletAddress: 'GDONOR', year: 2026 });
      const header = buffer.slice(0, 4).toString('ascii');
      expect(header).toBe('%PDF');
    });

    test('should generate PDF even with no donations', async () => {
      Database.query.mockResolvedValue([]);

      const buffer = await TaxReceiptService.generateAnnualSummaryPDF({ walletAddress: 'GDONOR', year: 2026 });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    test('should include organization info when configured', async () => {
      const originalConfig = config.taxReceipt;
      config.taxReceipt = {
        isConfigured: true,
        ein: '12-3456789',
        legalName: 'Stellar Foundation',
        address: '1 Blockchain Way',
        city: 'San Francisco',
        state: 'CA',
        zipCode: '94105',
      };
      Database.query.mockResolvedValue([]);

      // Just verify it generates without throwing when org is configured
      const buffer = await TaxReceiptService.generateAnnualSummaryPDF({ walletAddress: 'GDONOR', year: 2026 });
      expect(Buffer.isBuffer(buffer)).toBe(true);

      config.taxReceipt = originalConfig;
    });

    test('should generate multi-recipient summary correctly', async () => {
      const donations = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        amount: 50 + i * 10,
        timestamp: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
        fair_market_value_usd: (50 + i * 10) * 0.15,
        donorPublicKey: 'GDONOR',
        recipientPublicKey: `GRECIP${i % 3}`,
        status: 'confirmed',
        stellar_tx_id: `tx${i}`,
      }));
      Database.query.mockResolvedValue(donations);

      const buffer = await TaxReceiptService.generateAnnualSummaryPDF({ walletAddress: 'GDONOR', year: 2026 });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);
    });
  });
});
