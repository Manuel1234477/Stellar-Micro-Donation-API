/**
 * Tax Receipt Service - IRS Compliance Layer
 * 
 * RESPONSIBILITY: Generate IRS-compliant tax receipts for non-cash donations
 * OWNER: Compliance Team
 * DEPENDENCIES: Database, config, PriceOracleService
 * 
 * Generates Form 8283-compliant receipts for XLM donations including:
 * - Organization EIN and legal name
 * - Donation date and fair market value in USD
 * - Statement that no goods or services were provided in exchange
 * - Exchange rate snapshot at time of donation
 */

const Database = require('../utils/database');
const config = require('../config');
const log = require('../utils/log');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const priceOracle = require('./PriceOracleService');

/**
 * IRS Form 8283 required statement for non-cash donations
 * @type {string}
 */
const IRS_STATEMENT = `No goods or services were provided in exchange for this contribution.`;

/**
 * Tax receipt service class
 */
class TaxReceiptService {
  /**
   * Check if organization tax configuration is complete
   * @returns {boolean} True if tax receipt generation is configured
   */
  static isConfigured() {
    return config.taxReceipt?.isConfigured || false;
  }

  /**
   * Get organization tax configuration
   * @returns {Object} Tax configuration
   */
  static getOrganizationConfig() {
    if (!this.isConfigured()) {
      throw new ValidationError(
        'Organization tax configuration is incomplete. Please set ORGANIZATION_EIN and ORGANIZATION_LEGAL_NAME.',
        null,
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    return {
      ein: config.taxReceipt.ein,
      legalName: config.taxReceipt.legalName,
      address: config.taxReceipt.address,
      city: config.taxReceipt.city,
      state: config.taxReceipt.state,
      zipCode: config.taxReceipt.zipCode,
      phone: config.taxReceipt.phone,
      email: config.taxReceipt.email,
      website: config.taxReceipt.website
    };
  }

  /**
   * Get XLM/USD exchange rate at a specific timestamp
   * @param {string} timestamp - ISO 8601 timestamp
   * @returns {Promise<number>} Exchange rate (USD per XLM)
   */
  static async getExchangeRateAtTime(timestamp) {
    try {
      const rate = await priceOracle.getPriceAtTime('XLM', 'USD', timestamp);
      return rate;
    } catch (error) {
      log.error('TAX_RECEIPT_SERVICE', 'Failed to get exchange rate', {
        timestamp,
        error: error.message
      });
      throw new ValidationError(
        'Unable to retrieve exchange rate for donation',
        null,
        ERROR_CODES.EXTERNAL_SERVICE_ERROR
      );
    }
  }

  /**
   * Calculate fair market value in USD
   * @param {number} xlmAmount - Amount in XLM
   * @param {number} exchangeRate - XLM/USD exchange rate
   * @returns {number} Fair market value in USD
   */
  static calculateFairMarketValue(xlmAmount, exchangeRate) {
    return parseFloat((xlmAmount * exchangeRate).toFixed(2));
  }

  /**
   * Store exchange rate snapshot with donation
   * @param {number} donationId - Donation ID
   * @param {number} exchangeRate - XLM/USD exchange rate
   * @param {number} fairMarketValue - Fair market value in USD
   * @returns {Promise<void>}
   */
  static async storeExchangeRateSnapshot(donationId, exchangeRate, fairMarketValue) {
    try {
      await Database.run(
        `UPDATE transactions SET 
          xlm_usd_rate = ?, 
          fair_market_value_usd = ?,
          tax_receipt_generated = 0
        WHERE id = ?`,
        [exchangeRate, fairMarketValue, donationId]
      );

      log.info('TAX_RECEIPT_SERVICE', 'Exchange rate snapshot stored', {
        donationId,
        exchangeRate,
        fairMarketValue
      });
    } catch (error) {
      log.error('TAX_RECEIPT_SERVICE', 'Failed to store exchange rate snapshot', {
        donationId,
        error: error.message
      });
      // Don't throw - this is non-critical
    }
  }

  /**
   * Get donation details for tax receipt
   * @param {number} donationId - Donation ID
   * @returns {Promise<Object>} Donation details
   */
  static async getDonationForReceipt(donationId) {
    const donation = await Database.get(
      `SELECT 
        t.id,
        t.amount,
        t.timestamp,
        t.xlm_usd_rate,
        t.fair_market_value_usd,
        t.stellar_tx_id,
        sender.publicKey as donorPublicKey,
        receiver.publicKey as recipientPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE t.id = ?`,
      [donationId]
    );

    if (!donation) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    return donation;
  }

  /**
   * Generate IRS-compliant tax receipt data
   * @param {number} donationId - Donation ID
   * @returns {Promise<Object>} Tax receipt data
   */
  static async generateTaxReceiptData(donationId) {
    // Check if organization is configured
    if (!this.isConfigured()) {
      throw new ValidationError(
        'Organization tax configuration is incomplete',
        null,
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    // Get donation details
    const donation = await this.getDonationForReceipt(donationId);

    // Get exchange rate if not already stored
    let exchangeRate = donation.xlm_usd_rate;
    let fairMarketValue = donation.fair_market_value_usd;

    if (!exchangeRate || !fairMarketValue) {
      exchangeRate = await this.getExchangeRateAtTime(donation.timestamp);
      fairMarketValue = this.calculateFairMarketValue(donation.amount, exchangeRate);

      // Store the snapshot
      await this.storeExchangeRateSnapshot(donationId, exchangeRate, fairMarketValue);
    }

    // Get organization config
    const orgConfig = this.getOrganizationConfig();

    // Generate receipt data
    const receiptData = {
      // Organization information
      organization: {
        ein: orgConfig.ein,
        legalName: orgConfig.legalName,
        address: orgConfig.address,
        city: orgConfig.city,
        state: orgConfig.state,
        zipCode: orgConfig.zipCode,
        phone: orgConfig.phone,
        email: orgConfig.email,
        website: orgConfig.website
      },

      // Donation information
      donation: {
        id: donation.id,
        date: donation.timestamp,
        stellarTxId: donation.stellar_tx_id,
        donorPublicKey: donation.donorPublicKey,
        recipientPublicKey: donation.recipientPublicKey
      },

      // Financial information
      financial: {
        xlmAmount: donation.amount,
        xlmUsdRate: exchangeRate,
        fairMarketValueUsd: fairMarketValue,
        currency: 'XLM'
      },

      // IRS compliance
      irs: {
        formType: '8283',
        statement: IRS_STATEMENT,
        qualifiedOrganization: true,
        noGoodsServicesProvided: true
      },

      // Metadata
      generatedAt: new Date().toISOString(),
      receiptNumber: `TXN-${donation.id}-${Date.now()}`
    };

    log.info('TAX_RECEIPT_SERVICE', 'Tax receipt data generated', {
      donationId,
      receiptNumber: receiptData.receiptNumber,
      fairMarketValue
    });

    return receiptData;
  }

  /**
   * Generate tax receipt as PDF (placeholder - requires PDF library)
   * @param {number} donationId - Donation ID
   * @returns {Promise<Buffer>} PDF buffer
   */
  static async generateTaxReceiptPDF(donationId) {
    const receiptData = await this.generateTaxReceiptData(donationId);

    // Note: This is a placeholder for PDF generation
    // In production, use a library like pdfkit, puppeteer, or jsPDF
    // For now, return JSON representation
    
    log.info('TAX_RECEIPT_SERVICE', 'Tax receipt PDF generation requested', {
      donationId,
      receiptNumber: receiptData.receiptNumber
    });

    // Return receipt data as JSON for now
    // In production, this would return a PDF buffer
    return JSON.stringify(receiptData, null, 2);
  }

  /**
   * Mark donation as having tax receipt generated
   * @param {number} donationId - Donation ID
   * @returns {Promise<void>}
   */
  static async markReceiptGenerated(donationId) {
    try {
      await Database.run(
        'UPDATE transactions SET tax_receipt_generated = 1 WHERE id = ?',
        [donationId]
      );

      log.info('TAX_RECEIPT_SERVICE', 'Donation marked as tax receipt generated', {
        donationId
      });
    } catch (error) {
      log.error('TAX_RECEIPT_SERVICE', 'Failed to mark receipt as generated', {
        donationId,
        error: error.message
      });
    }
  }

  /**
   * Check if tax receipt has been generated for a donation
   * @param {number} donationId - Donation ID
   * @returns {Promise<boolean>} True if receipt has been generated
   */
  static async hasReceiptBeenGenerated(donationId) {
    const donation = await Database.get(
      'SELECT tax_receipt_generated FROM transactions WHERE id = ?',
      [donationId]
    );

    return donation && donation.tax_receipt_generated === 1;
  }

  /**
   * Get all donations eligible for tax receipts
   * @param {Object} options - Query options
   * @param {string} options.startDate - Start date filter
   * @param {string} options.endDate - End date filter
   * @param {number} options.limit - Maximum results
   * @returns {Promise<Array>} List of donations
   */
  static async getEligibleDonations(options = {}) {
    const { startDate, endDate, limit = 100 } = options;

    let query = `
      SELECT 
        t.id,
        t.amount,
        t.timestamp,
        t.xlm_usd_rate,
        t.fair_market_value_usd,
        t.tax_receipt_generated,
        sender.publicKey as donorPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      query += ' AND t.timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND t.timestamp <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY t.timestamp DESC LIMIT ?';
    params.push(limit);

    const donations = await Database.query(query, params);

    return donations.map(d => ({
      ...d,
      hasReceipt: d.tax_receipt_generated === 1
    }));
  }
}

module.exports = TaxReceiptService;
