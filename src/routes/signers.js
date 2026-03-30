/**
 * Signer Management Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for Stellar account signer management
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, AuditLogService, middleware (auth, RBAC)
 * 
 * Thin controllers that orchestrate signer operations for multi-sig setups
 * and key rotation. All business logic delegated to StellarService.
 */

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { validateSchema } = require('../middleware/schemaValidation');
const AuditLogService = require('../services/AuditLogService');
const { getStellarService } = require('../config/stellar');
const log = require('../utils/log');

const stellarService = getStellarService();

/**
 * Schema for adding a signer
 */
const addSignerSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true }
    }
  },
  body: {
    fields: {
      signerPublic: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 56,
        maxLength: 56
      },
      weight: {
        type: 'integer',
        required: false,
        min: 0,
        max: 255,
        default: 1
      },
      masterSecret: {
        type: 'string',
        required: true,
        trim: true
      }
    }
  }
});

/**
 * Schema for removing a signer
 */
const removeSignerSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
      key: { type: 'string', required: true, trim: true, minLength: 56, maxLength: 56 }
    }
  },
  body: {
    fields: {
      masterSecret: {
        type: 'string',
        required: true,
        trim: true
      }
    }
  }
});

/**
 * Schema for updating signer weight
 */
const updateSignerWeightSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
      key: { type: 'string', required: true, trim: true, minLength: 56, maxLength: 56 }
    }
  },
  body: {
    fields: {
      weight: {
        type: 'integer',
        required: true,
        min: 0,
        max: 255
      },
      masterSecret: {
        type: 'string',
        required: true,
        trim: true
      }
    }
  }
});

/**
 * GET /wallets/:id/signers
 * Get all signers for a wallet
 */
router.get('/:id/signers', checkPermission(PERMISSIONS.WALLETS_READ), async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    if (isNaN(walletId) || walletId < 1) {
      throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Get wallet from database
    const Database = require('../utils/database');
    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    // Get signers from Stellar
    const signers = await stellarService.getSigners(wallet.publicKey);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'SIGNERS_LISTED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${walletId}/signers`,
      details: { walletId, signerCount: signers.length }
    });

    res.json({
      success: true,
      data: {
        walletId,
        publicKey: wallet.publicKey,
        signers
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /wallets/:id/signers
 * Add a signer to a wallet
 */
router.post('/:id/signers', checkPermission(PERMISSIONS.WALLETS_UPDATE), addSignerSchema, async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    const { signerPublic, weight = 1, masterSecret } = req.body;

    if (isNaN(walletId) || walletId < 1) {
      throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Get wallet from database
    const Database = require('../utils/database');
    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    // Add signer via Stellar service
    const result = await stellarService.addSigner(masterSecret, signerPublic, weight);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'SIGNER_ADDED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${walletId}/signers`,
      details: {
        walletId,
        signerPublic,
        weight,
        txHash: result.hash
      }
    });

    res.status(201).json({
      success: true,
      data: {
        walletId,
        signer: {
          publicKey: signerPublic,
          weight
        },
        transaction: {
          hash: result.hash,
          ledger: result.ledger
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /wallets/:id/signers/:key
 * Remove a signer from a wallet
 */
router.delete('/:id/signers/:key', checkPermission(PERMISSIONS.WALLETS_UPDATE), removeSignerSchema, async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    const signerPublic = req.params.key;
    const { masterSecret } = req.body;

    if (isNaN(walletId) || walletId < 1) {
      throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Get wallet from database
    const Database = require('../utils/database');
    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    // Remove signer via Stellar service
    const result = await stellarService.removeSigner(masterSecret, signerPublic);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'SIGNER_REMOVED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${walletId}/signers/${signerPublic}`,
      details: {
        walletId,
        signerPublic,
        txHash: result.hash
      }
    });

    res.json({
      success: true,
      data: {
        walletId,
        signer: {
          publicKey: signerPublic
        },
        transaction: {
          hash: result.hash,
          ledger: result.ledger
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /wallets/:id/signers/:key
 * Update the weight of an existing signer
 */
router.patch('/:id/signers/:key', checkPermission(PERMISSIONS.WALLETS_UPDATE), updateSignerWeightSchema, async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    const signerPublic = req.params.key;
    const { weight, masterSecret } = req.body;

    if (isNaN(walletId) || walletId < 1) {
      throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Get wallet from database
    const Database = require('../utils/database');
    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    // Update signer weight via Stellar service
    const result = await stellarService.updateSignerWeight(masterSecret, signerPublic, weight);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'SIGNER_WEIGHT_UPDATED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${walletId}/signers/${signerPublic}`,
      details: {
        walletId,
        signerPublic,
        newWeight: weight,
        txHash: result.hash
      }
    });

    res.json({
      success: true,
      data: {
        walletId,
        signer: {
          publicKey: signerPublic,
          weight
        },
        transaction: {
          hash: result.hash,
          ledger: result.ledger
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

// ─── Thresholds endpoint (issue #633) ────────────────────────────────────────

const thresholdsRouter = express.Router();

/**
 * POST /wallets/:id/thresholds
 * Set low/medium/high signing thresholds for a wallet account.
 */
thresholdsRouter.post('/:id/thresholds', checkPermission(PERMISSIONS.WALLETS_UPDATE), async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    if (isNaN(walletId) || walletId < 1) {
      throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    const { low, medium, high, masterSecret } = req.body;

    for (const [name, val] of [['low', low], ['medium', medium], ['high', high]]) {
      if (!Number.isInteger(val) || val < 0 || val > 255) {
        throw new ValidationError(`${name} threshold must be an integer between 0 and 255`);
      }
    }
    if (!masterSecret) throw new ValidationError('masterSecret is required');

    const Database = require('../utils/database');
    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);

    const result = await stellarService.setThresholds(masterSecret, low, medium, high);

    res.json({
      success: true,
      data: {
        walletId,
        thresholds: result.thresholds,
        transaction: { hash: result.hash, ledger: result.ledger },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports.thresholdsRouter = thresholdsRouter;
