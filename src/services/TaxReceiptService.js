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
 * - Annual summary PDFs for year-end tax filing (#1595)
 */

const PDFDocument = require('pdfkit');
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
        t.status,
        t.is_anonymous,
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

    // Check if donation is in a valid state for tax receipt generation
    const invalidStatuses = ['refunded', 'failed', 'cancelled'];
    if (donation.status && invalidStatuses.includes(donation.status.toLowerCase())) {
      throw new ValidationError(
        `Cannot generate tax receipt for a donation with status "${donation.status}"`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
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

    // Anonymous donations must never expose donor identity in metadata or body
    const isAnonymous = Boolean(donation.is_anonymous);

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
        isAnonymous,
        donorPublicKey: isAnonymous ? null : donation.donorPublicKey,
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
   * Build PDF document metadata for a tax receipt.
   *
   * Named donations include donor and recipient in the document metadata so
   * donor/accounting systems can index receipts. Anonymous donations
   * deliberately omit the donor identity (explicit branch, not an accident).
   *
   * @param {Object} receiptData - Receipt data from generateTaxReceiptData
   * @returns {Object} pdfkit document info object
   */
  static buildReceiptMetadata(receiptData) {
    const { donation, organization } = receiptData;
    const isAnonymous = Boolean(donation.isAnonymous);

    const info = {
      Title: `Tax Receipt ${receiptData.receiptNumber}`,
      Author: organization.legalName,
      Creator: organization.legalName,
      Producer: 'HandsOff Tax Receipt Service'
    };

    if (isAnonymous) {
      // Explicit anonymity branch: never include donor identity in metadata
      info.Subject = `Anonymous donation receipt ${receiptData.receiptNumber}`;
      info.Keywords = [
        'tax-receipt',
        'anonymous',
        `recipient:${donation.recipientPublicKey || 'unknown'}`
      ].join(', ');
    } else {
      info.Subject = `Donation receipt for ${donation.donorPublicKey || 'unknown donor'}`;
      info.Keywords = [
        'tax-receipt',
        `donor:${donation.donorPublicKey || 'unknown'}`,
        `recipient:${donation.recipientPublicKey || 'unknown'}`
      ].join(', ');
    }

    return info;
  }

  /**
   * Generate tax receipt as PDF (placeholder - requires PDF library)
   * @param {number} donationId - Donation ID
   * @returns {Promise<Buffer>} PDF buffer
   */
  static async generateTaxReceiptPDF(donationId) {
    const receiptData = await this.generateTaxReceiptData(donationId);
    const info = this.buildReceiptMetadata(receiptData);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ info });
        const chunks = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const { organization, donation, financial, irs } = receiptData;

        doc.fontSize(18).text(organization.legalName, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`EIN: ${organization.ein}`);
        doc.text(`${organization.address}, ${organization.city}, ${organization.state} ${organization.zipCode}`);
        doc.moveDown();

        doc.fontSize(14).text('Tax Receipt', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Receipt Number: ${receiptData.receiptNumber}`);
        doc.text(`Date: ${donation.date}`);
        doc.text(`Stellar Transaction ID: ${donation.stellarTxId || 'N/A'}`);

        if (donation.isAnonymous) {
          doc.text('Donor: Anonymous');
        } else {
          doc.text(`Donor: ${donation.donorPublicKey || 'Unknown'}`);
        }
        doc.text(`Recipient: ${donation.recipientPublicKey || 'Unknown'}`);
        doc.moveDown();

        doc.text(`Amount: ${financial.xlmAmount} ${financial.currency}`);
        doc.text(`Exchange Rate: ${financial.xlmUsdRate} USD/XLM`);
        doc.text(`Fair Market Value: $${financial.fairMarketValueUsd} USD`);
        doc.moveDown();

        doc.text(`IRS Form: ${irs.formType}`);
        doc.text(irs.statement);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = TaxReceiptService;
