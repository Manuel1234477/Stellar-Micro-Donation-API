const express = require('express');
const router = express.Router();
const { verifyAdmin } = require('../middleware/auth'); // assuming you have this

const i18nController = require('../controllers/admin/i18nController');
const RetentionService = require('../services/RetentionService');

router.get('/i18n/messages', verifyAdmin, i18nController.getAllMessages);
router.patch('/i18n/messages/:lang/:key', verifyAdmin, i18nController.updateTranslation);
router.post('/i18n/languages', verifyAdmin, i18nController.addLanguage);

// Data retention policy status (#1912). Exposes the configured retention
// windows, including the transaction/memo window, so operators can verify
// what the enforcement job will apply.
router.get('/retention', verifyAdmin, (req, res) => {
  const parseDays = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  res.json({
    success: true,
    data: {
      donationDays: parseDays(process.env.RETENTION_DONATION_DAYS, 365),
      auditLogDays: parseDays(process.env.RETENTION_AUDIT_LOG_DAYS, 365),
      idempotencyDays: parseDays(process.env.RETENTION_IDEMPOTENCY_DAYS, 30),
      cancelledScheduleDays: parseDays(process.env.RETENTION_CANCELLED_SCHEDULE_DAYS, 90),
      transactionDays: parseDays(process.env.RETENTION_TRANSACTION_DAYS, 365),
    },
  });
});

// XDR decoding lives in routes/admin/inspect.js (#1778); its deprecated
// /admin/transactions/decode-xdr alias is mounted from src/bootstrap/routes.js.

module.exports = router;