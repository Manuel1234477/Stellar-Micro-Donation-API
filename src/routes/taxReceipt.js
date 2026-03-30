/**
 * Tax Receipt Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for IRS-compliant tax receipt generation
 * OWNER: Compliance Team
 * DEPENDENCIES: TaxReceiptService, AuditLogService, middleware (auth, RBAC)
 * 
 * Thin controllers that orchestrate tax receipt generation for donations.
 * All business logic delegated to TaxReceiptService.
 */

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { validateSchema } = require('../middleware/schemaValidation');
const AuditLogService = require('../services/AuditLogService');
const TaxReceiptService = require('../services/TaxReceiptService');
const log = require('../utils/log');

/**
 * Schema for tax receipt request
 */
const taxReceiptSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  },
  query: {
    fields: {
      format: {
        type: 'string',
        required: false,
        enum: ['json', 'pdf'],
        default: 'json'
      }
    }
  }
});

/**
 * Schema for eligible donations query
 */
const eligibleDonationsSchema = validateSchema({
  query: {
    fields: {
      startDate: {
        type: 'string',
        required: false,
        nullable: true
      },
      endDate: {
        type: 'string',
        required: false,
        nullable: true
      },
      limit: {
        type: 'integerString',
        required: false,
        min: 1,
        max: 1000,
        default: 100
      }
    }
  }
});

/**
 * GET /donations/:id/tax-receipt
 * Generate IRS-compliant tax receipt for a donation
 */
router.get('/:id/tax-receipt', checkPermission(PERMISSIONS.DONATIONS_READ), taxReceiptSchema, async (req, res, next) => {
  try {
    const donationId = parseInt(req.params.id, 10);
    const format = req.query.format || 'json';

    if (isNaN(donationId) || donationId < 1) {
      throw new ValidationError('Invalid donation ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Check if organization is configured for tax receipts
    if (!TaxReceiptService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Tax receipt service is not configured. Organization information is required.',
          details: {
            required: ['ORGANIZATION_EIN', 'ORGANIZATION_LEGAL_NAME'],
            current: {
              ein: !!process.env.ORGANIZATION_EIN,
              legalName: !!process.env.ORGANIZATION_LEGAL_NAME
            }
          }
        }
      });
    }

    // Generate tax receipt data
    const receiptData = await TaxReceiptService.generateTaxReceiptData(donationId);

    // Mark receipt as generated
    await TaxReceiptService.markReceiptGenerated(donationId);

    // Log the receipt generation
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: 'TAX_RECEIPT_GENERATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/donations/${donationId}/tax-receipt`,
      details: {
        donationId,
        receiptNumber: receiptData.receiptNumber,
        format,
        fairMarketValue: receiptData.financial.fairMarketValueUsd
      }
    });

    // Return based on format
    if (format === 'pdf') {
      // Note: PDF generation is a placeholder
      // In production, this would return a PDF file
      const pdfContent = await TaxReceiptService.generateTaxReceiptPDF(donationId);
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="tax-receipt-${donationId}.json"`);
      res.send(pdfContent);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: receiptData
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/tax-receipts/eligible
 * Get all donations eligible for tax receipts
 */
router.get('/tax-receipts/eligible', checkPermission(PERMISSIONS.DONATIONS_READ), eligibleDonationsSchema, async (req, res, next) => {
  try {
    const { startDate, endDate, limit } = req.query;

    const donations = await TaxReceiptService.getEligibleDonations({
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : 100
    });

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.DATA_ACCESS,
      action: 'TAX_RECEIPTS_ELIGIBLE_LISTED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/donations/tax-receipts/eligible',
      details: {
        count: donations.length,
        startDate,
        endDate
      }
    });

    res.json({
      success: true,
      data: {
        donations,
        count: donations.length,
        filters: {
          startDate,
          endDate,
          limit
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/tax-receipts/config
 * Get tax receipt configuration status
 */
router.get('/tax-receipts/config', requireAdmin(), async (req, res, next) => {
  try {
    const isConfigured = TaxReceiptService.isConfigured();
    const config = isConfigured ? TaxReceiptService.getOrganizationConfig() : null;

    res.json({
      success: true,
      data: {
        configured: isConfigured,
        organization: config ? {
          ein: config.ein,
          legalName: config.legalName,
          address: config.address,
          city: config.city,
          state: config.state,
          zipCode: config.zipCode
        } : null,
        requiredEnvVars: [
          'ORGANIZATION_EIN',
          'ORGANIZATION_LEGAL_NAME',
          'ORGANIZATION_ADDRESS',
          'ORGANIZATION_CITY',
          'ORGANIZATION_STATE',
          'ORGANIZATION_ZIP_CODE'
        ]
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
