'use strict';

const express = require('express');
const router = express.Router();

const i18nController = require('../../controllers/i18nController');
const { requireAdmin } = require('../../middleware/auth');
const { requireAdminTOTP } = require('../../middleware/adminTOTP');
const retentionService = require('../../services/retentionService');
const MemoReencryptionJob = require('../../jobs/memoReencryptionJob');
const logger = require('../../utils/logger');

// Single process-wide job instance so status/progress is observable and a
// restart resumes from the DB (memos already at the active key version are
// skipped by the job's query).
let memoReencryptionJob = null;
function getMemoReencryptionJob() {
  if (!memoReencryptionJob) memoReencryptionJob = new MemoReencryptionJob();
  return memoReencryptionJob;
}

// ---------------------------------------------------------------------------
// i18n admin routes
// ---------------------------------------------------------------------------

router.get('/i18n/locales', requireAdmin, i18nController.listLocales);
router.get('/i18n/translations/:locale', requireAdmin, i18nController.getTranslations);
router.put('/i18n/translations/:locale', requireAdmin, i18nController.updateTranslations);
router.post('/i18n/translations/:locale/validate', requireAdmin, i18nController.validateTranslations);
router.post('/i18n/cache/clear', requireAdmin, i18nController.clearCache);

// ---------------------------------------------------------------------------
// Retention status
// ---------------------------------------------------------------------------

router.get('/retention', requireAdmin, async (req, res, next) => {
  try {
    const status = await retentionService.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    logger.error('Failed to fetch retention status', { error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Memo key rotation (re-encryption) — Issue #2068
// ---------------------------------------------------------------------------

router.get('/memo-reencryption/status', requireAdmin, (req, res) => {
  res.json({ success: true, data: getMemoReencryptionJob().getStatus() });
});

router.post('/memo-reencryption/start', requireAdmin, requireAdminTOTP, (req, res) => {
  const job = getMemoReencryptionJob();
  job.start();
  res.json({ success: true, data: job.getStatus() });
});

router.post('/memo-reencryption/stop', requireAdmin, requireAdminTOTP, (req, res) => {
  const job = getMemoReencryptionJob();
  job.stop();
  res.json({ success: true, data: job.getStatus() });
});

router.post('/memo-reencryption/run-once', requireAdmin, requireAdminTOTP, async (req, res, next) => {
  try {
    const job = getMemoReencryptionJob();
    const batch = await job.runOnce();
    res.json({ success: true, data: { batch, status: job.getStatus() } });
  } catch (err) {
    logger.error('Memo re-encryption batch failed', { error: err.message });
    next(err);
  }
});

module.exports = router;