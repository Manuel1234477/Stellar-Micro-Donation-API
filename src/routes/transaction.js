const express = require('express');
const router = express.Router();
const Transaction = require('./models/transaction');
const TransactionSyncService = require('../services/TransactionSyncService');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { validatePagination } = require('../utils/validationHelpers');

router.get('/', checkPermission(PERMISSIONS.TRANSACTIONS_READ), async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;

    const paginationValidation = validatePagination(limit, offset);
    
    if (!paginationValidation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: paginationValidation.error
        }
      });
    }

    const result = Transaction.getPaginated({ 
      limit: paginationValidation.limit, 
      offset: paginationValidation.offset 
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch transactions'
      }
    });
  }
});

router.post('/sync', checkPermission(PERMISSIONS.TRANSACTIONS_SYNC), async (req, res) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PUBLIC_KEY', message: 'publicKey is required' }
      });
    }

    const syncService = new TransactionSyncService();
    const result = await syncService.syncWalletTransactions(publicKey);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: error.message }
    });
  }
});


module.exports = router;