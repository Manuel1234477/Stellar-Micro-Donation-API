'use strict';

/**
 * Admin Encryption Routes
 * POST /admin/encryption/rotate — re-encrypt all wallet records with the current key version
 * POST /admin/encryption/memo-rotate — re-encrypt all transaction memos with the new key version
 */

const express = require('express');
const router = express.Router();
const { requireAdmin, checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const Wallet = require('../models/wallet');
const Transaction = require('../models/transaction');
const log = require('../../utils/log');

/**
 * POST /admin/encryption/rotate
 * Re-encrypt all wallet label and notes fields with the current ENCRYPTION_KEY_VERSION.
 * Records already encrypted with the current version are skipped.
 * Admin only.
 */
router.post('/rotate', requireAdmin(), async (req, res, next) => {
  try {
    const svc = require('../../services/EncryptionService');
    const targetVersion = parseInt(process.env.ENCRYPTION_KEY_VERSION || '1', 10);

    const wallets = Wallet.loadWallets();
    let rotated = 0;
    let skipped = 0;
    let errors = 0;

    for (const wallet of wallets) {
      if (wallet.deletedAt) { skipped++; continue; }

      let changed = false;
      for (const field of Wallet.ENCRYPTED_FIELDS) {
        const raw = wallet[field];
        if (raw == null) continue;

        // Determine current version of stored value
        const currentVersion = String(raw).startsWith('v')
          ? parseInt(String(raw).split(':')[0].slice(1), 10)
          : 0; // 0 = plaintext (unencrypted)

        if (currentVersion === targetVersion) continue;

        try {
          const plaintext = currentVersion === 0 ? raw : svc.decryptField(raw);
          wallet[field] = svc.encryptField(plaintext, targetVersion);
          changed = true;
        } catch (err) {
          errors++;
          log.error('ENCRYPTION_ROTATE', 'Failed to re-encrypt field', {
            walletId: wallet.id, field, error: err.message,
          });
        }
      }

      if (changed) rotated++;
      else skipped++;
    }

    Wallet.saveWallets(wallets);

    log.info('ENCRYPTION_ROTATE', 'Key rotation complete', { rotated, skipped, errors, targetVersion });
    res.json({ success: true, data: { rotated, skipped, errors, targetVersion } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/encryption/memo-rotate
 * Initiate key rotation for encrypted transaction memos.
 *
 * This endpoint:
 * 1. Generates a new key version
 * 2. Returns information about memos that need re-encryption
 * 3. Does NOT immediately re-encrypt (that requires the recipient's secret key)
 *
 * The actual re-encryption must be done separately via a batch job that
 * has access to the recipients' secret keys, using the returned memo IDs.
 *
 * Response includes:
 * - rotationStatus: "initiated"
 * - previousVersion: old active key version
 * - newVersion: new active key version
 * - memosRequiringReencryption: count of memos with old key version
 * - memoIds: list of transaction IDs requiring re-encryption
 *
 * Admin only.
 */
router.post('/memo-rotate', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const MemoEncryptionService = require('../../services/MemoEncryptionService');
    const memoKeyManager = require('../../utils/memoKeyManager');

    // Initiate key rotation (creates new key version)
    const rotationInfo = MemoEncryptionService.initiateKeyRotation();

    // Load all transactions
    const allTransactions = Transaction.getAll();

    // Identify memos that need re-encryption
    const memosToReencrypt = MemoEncryptionService.getMemosToReencrypt(
      allTransactions,
      rotationInfo.previousVersion
    );

    const memoIds = memosToReencrypt.map(tx => tx.id);

    log.info('MEMO_ROTATION_INITIATED', 'Memo key rotation initiated', {
      previousVersion: rotationInfo.previousVersion,
      newVersion: rotationInfo.newVersion,
      memosRequiringReencryption: memoIds.length,
    });

    return res.status(200).json({
      success: true,
      data: {
        rotationStatus: rotationInfo.status,
        previousVersion: rotationInfo.previousVersion,
        newVersion: rotationInfo.newVersion,
        memosRequiringReencryption: memoIds.length,
        memoIds,
        nextSteps: [
          'Run batch job to re-encrypt memos using reencryptMemoToLatestVersion',
          'Ensure all replicas are re-encrypted before retiring the old key',
          'Monitor for any decryption failures during transition',
        ],
      },
    });
  } catch (error) {
    log.error('MEMO_ROTATION_FAILED', 'Failed to initiate memo key rotation', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
});

module.exports = router;
