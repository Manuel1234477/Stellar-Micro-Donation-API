'use strict';
const express = require('express');
const router = express.Router();
const asyncHandler = require('../../utils/asyncHandler');
const { requireAdmin } = require('../../middleware/rbac');
const { getStellarService } = require('../../config/stellar');
const DonationService = require('../../services/DonationService');

const service = () => new DonationService(getStellarService());

router.post('/:id/refund', requireAdmin(), asyncHandler(async (req, res) => {
  const result = await service().refundDonation(req.params.id, {
    reason: req.body?.reason,
    notes: req.body?.notes,
    idempotencyKey: req.body?.idempotencyKey || req.get('Idempotency-Key'),
    recipientSecret: req.body?.recipientSecret,
    requestId: req.id,
  });
  return res.status(result.alreadyProcessed ? 200 : 201).json({ success: true, data: result });
}));

router.post('/:id/overpayment/approve', requireAdmin(), asyncHandler(async (req, res) => {
  const result = await service().approveOverpaymentReturn(req.params.id, {
    recipientSecret: req.body?.recipientSecret,
    requestId: req.id,
  });
  return res.status(result.alreadyProcessed ? 200 : 201).json({ success: true, data: result });
}));

router.post('/:id/overpayment/reject', requireAdmin(), asyncHandler(async (req, res) => {
  const donation = service().getDonationById(req.params.id);
  if (!donation.overpaymentFlagged) return res.status(404).json({ success: false, error: { code: 'NO_OVERPAYMENT', message: 'Donation has no detected overpayment' } });
  donation.overpaymentReturnStatus = 'rejected';
  const Transaction = require('../../models/transaction');
  Transaction.saveTransactions(Transaction.loadTransactions());
  return res.json({ success: true, data: { donationId: req.params.id, status: 'rejected' } });
}));

module.exports = router;
