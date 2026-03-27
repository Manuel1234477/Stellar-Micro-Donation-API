/**
 * Asset Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for Stellar custom asset operations
 * OWNER: Backend Team
 * DEPENDENCIES: Database, StellarService, middleware (auth, RBAC)
 *
 * Endpoints:
 *   POST /assets/issue          – issue a custom asset to a recipient
 *   POST /assets/burn           – burn (send back to issuer) a custom asset
 *   GET  /assets/:code/holders  – list all holders of an asset
 *   GET  /assets/:code/metadata – get asset metadata
 *   PUT  /assets/:code/metadata – create or update asset metadata
 */

'use strict';

const express = require('express');
const router = express.Router();
const Database = require('../utils/database');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { getStellarService } = require('../config/stellar');
const { validateRequiredFields, validateFloat } = require('../utils/validationHelpers');
const log = require('../utils/log');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Validate asset code: 1-12 alphanumeric characters */
function isValidAssetCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{1,12}$/.test(code);
}

/** Ensure asset metadata row exists, upsert totalIssued/totalBurned */
async function upsertAssetRecord(assetCode, issuerPublic, issuedDelta = 0, burnedDelta = 0) {
  const existing = await Database.get(
    'SELECT id, totalIssued, totalBurned FROM issued_assets WHERE assetCode = ? AND issuerPublicKey = ?',
    [assetCode, issuerPublic]
  );

  if (existing) {
    const newIssued = (parseFloat(existing.totalIssued) + issuedDelta).toFixed(7);
    const newBurned = (parseFloat(existing.totalBurned) + burnedDelta).toFixed(7);
    await Database.run(
      'UPDATE issued_assets SET totalIssued = ?, totalBurned = ? WHERE id = ?',
      [newIssued, newBurned, existing.id]
    );
  } else {
    await Database.run(
      `INSERT INTO issued_assets (assetCode, issuerPublicKey, totalIssued, totalBurned)
       VALUES (?, ?, ?, ?)`,
      [assetCode, issuerPublic, issuedDelta.toFixed(7), burnedDelta.toFixed(7)]
    );
  }
}

/** Upsert a holder balance row */
async function upsertHolding(assetCode, issuerPublic, holderPublic, delta) {
  const existing = await Database.get(
    `SELECT id, balance FROM asset_holdings
     WHERE assetCode = ? AND issuerPublicKey = ? AND holderPublicKey = ?`,
    [assetCode, issuerPublic, holderPublic]
  );

  if (existing) {
    const newBal = (parseFloat(existing.balance) + delta).toFixed(7);
    await Database.run(
      'UPDATE asset_holdings SET balance = ?, updatedAt = ? WHERE id = ?',
      [newBal, new Date().toISOString(), existing.id]
    );
  } else {
    await Database.run(
      `INSERT INTO asset_holdings (assetCode, issuerPublicKey, holderPublicKey, balance, updatedAt)
       VALUES (?, ?, ?, ?, ?)`,
      [assetCode, issuerPublic, holderPublic, delta.toFixed(7), new Date().toISOString()]
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /assets/issue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /assets/issue
 * @desc    Issue a custom Stellar asset to a recipient
 * @access  donations:create (reuse existing permission)
 *
 * @body {string} issuerSecret      - Secret key of the issuer account
 * @body {string} assetCode         - Asset code (1-12 alphanumeric)
 * @body {string} amount            - Amount to issue
 * @body {string} recipientPublic   - Recipient Stellar public key
 */
router.post('/issue', checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const { issuerSecret, assetCode, amount, recipientPublic } = req.body;

    const required = validateRequiredFields(
      { issuerSecret, assetCode, amount, recipientPublic },
      ['issuerSecret', 'assetCode', 'amount', 'recipientPublic']
    );
    if (!required.valid) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${required.missing.join(', ')}`,
      });
    }

    if (!isValidAssetCode(assetCode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid assetCode. Must be 1-12 alphanumeric characters.',
      });
    }

    const amountResult = validateFloat(amount);
    if (!amountResult.valid) {
      return res.status(400).json({ success: false, error: `Invalid amount: ${amountResult.error}` });
    }

    const stellar = getStellarService();
    const result = await stellar.issueAsset(issuerSecret, assetCode, amount, recipientPublic);

    // Persist metadata + holdings
    await upsertAssetRecord(assetCode, result.issuerPublic, amountResult.value, 0);
    await upsertHolding(assetCode, result.issuerPublic, recipientPublic, amountResult.value);

    log.info('ASSET_ROUTE', 'Asset issued', {
      assetCode, issuerPublic: result.issuerPublic, recipientPublic, amount,
    });

    return res.status(201).json({
      success: true,
      message: `Asset ${assetCode} issued successfully`,
      data: {
        assetCode: result.assetCode,
        issuerPublic: result.issuerPublic,
        recipientPublic,
        amount: result.amount,
        transactionHash: result.hash,
        ledger: result.ledger,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /assets/burn
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /assets/burn
 * @desc    Burn a custom asset by sending it back to the issuer
 * @access  donations:create
 *
 * @body {string} holderSecret  - Secret key of the holder
 * @body {string} assetCode     - Asset code to burn
 * @body {string} issuerPublic  - Issuer public key
 * @body {string} amount        - Amount to burn
 */
router.post('/burn', checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const { holderSecret, assetCode, issuerPublic, amount } = req.body;

    const required = validateRequiredFields(
      { holderSecret, assetCode, issuerPublic, amount },
      ['holderSecret', 'assetCode', 'issuerPublic', 'amount']
    );
    if (!required.valid) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${required.missing.join(', ')}`,
      });
    }

    if (!isValidAssetCode(assetCode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid assetCode. Must be 1-12 alphanumeric characters.',
      });
    }

    const amountResult = validateFloat(amount);
    if (!amountResult.valid) {
      return res.status(400).json({ success: false, error: `Invalid amount: ${amountResult.error}` });
    }

    const stellar = getStellarService();
    const result = await stellar.burnAsset(holderSecret, assetCode, issuerPublic, amount);

    // Update holdings and burned total
    // We need the holder's public key — derive from the mock result or look up
    const holding = await Database.get(
      `SELECT holderPublicKey FROM asset_holdings
       WHERE assetCode = ? AND issuerPublicKey = ?
       ORDER BY updatedAt DESC LIMIT 1`,
      [assetCode, issuerPublic]
    );

    if (holding) {
      await upsertHolding(assetCode, issuerPublic, holding.holderPublicKey, -amountResult.value);
    }
    await upsertAssetRecord(assetCode, issuerPublic, 0, amountResult.value);

    return res.status(200).json({
      success: true,
      message: `Asset ${assetCode} burned successfully`,
      data: {
        assetCode: result.assetCode,
        issuerPublic,
        amount: result.amount,
        transactionHash: result.hash,
        ledger: result.ledger,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /assets/:code/holders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /assets/:code/holders
 * @desc    List all holders of a specific asset
 * @access  donations:read
 * @query   {string} issuer - Issuer public key (required)
 */
router.get('/:code/holders', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const { code } = req.params;
    const { issuer } = req.query;

    if (!isValidAssetCode(code)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid asset code. Must be 1-12 alphanumeric characters.',
      });
    }

    if (!issuer) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "issuer" (issuer public key) is required',
      });
    }

    const holders = await Database.query(
      `SELECT holderPublicKey, balance, updatedAt
       FROM asset_holdings
       WHERE assetCode = ? AND issuerPublicKey = ? AND CAST(balance AS REAL) > 0
       ORDER BY CAST(balance AS REAL) DESC`,
      [code, issuer]
    );

    return res.json({
      success: true,
      data: { assetCode: code, issuerPublic: issuer, holders, count: holders.length },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /assets/:code/metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /assets/:code/metadata
 * @desc    Get metadata for a specific asset
 * @access  donations:read
 * @query   {string} issuer - Issuer public key (required)
 */
router.get('/:code/metadata', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const { code } = req.params;
    const { issuer } = req.query;

    if (!isValidAssetCode(code)) {
      return res.status(400).json({ success: false, error: 'Invalid asset code.' });
    }

    if (!issuer) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "issuer" is required',
      });
    }

    const asset = await Database.get(
      'SELECT * FROM issued_assets WHERE assetCode = ? AND issuerPublicKey = ?',
      [code, issuer]
    );

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    return res.json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /assets/:code/metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PUT /assets/:code/metadata
 * @desc    Create or update asset metadata (name, description, iconUrl)
 * @access  donations:create
 *
 * @body {string} issuerPublic  - Issuer public key
 * @body {string} [name]        - Human-readable asset name
 * @body {string} [description] - Asset description
 * @body {string} [iconUrl]     - URL to asset icon image
 */
router.put('/:code/metadata', checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res, next) => {
  try {
    const { code } = req.params;
    const { issuerPublic, name, description, iconUrl } = req.body;

    if (!isValidAssetCode(code)) {
      return res.status(400).json({ success: false, error: 'Invalid asset code.' });
    }

    if (!issuerPublic) {
      return res.status(400).json({ success: false, error: 'issuerPublic is required' });
    }

    const existing = await Database.get(
      'SELECT id FROM issued_assets WHERE assetCode = ? AND issuerPublicKey = ?',
      [code, issuerPublic]
    );

    if (existing) {
      await Database.run(
        `UPDATE issued_assets SET name = ?, description = ?, iconUrl = ? WHERE id = ?`,
        [name || null, description || null, iconUrl || null, existing.id]
      );
    } else {
      await Database.run(
        `INSERT INTO issued_assets (assetCode, issuerPublicKey, name, description, iconUrl, totalIssued, totalBurned)
         VALUES (?, ?, ?, ?, ?, '0.0000000', '0.0000000')`,
        [code, issuerPublic, name || null, description || null, iconUrl || null]
      );
    }

    const updated = await Database.get(
      'SELECT * FROM issued_assets WHERE assetCode = ? AND issuerPublicKey = ?',
      [code, issuerPublic]
    );

    return res.json({ success: true, message: 'Asset metadata saved', data: updated });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
