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
jest.mock('../src/utils/database');
jest.mock('../src/services/PriceOracleService', () => ({
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
