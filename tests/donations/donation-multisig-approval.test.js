/**
 * Multi-signature donation approval workflow (#1498)
 *
 * Donations above MULTISIG_THRESHOLD_XLM are queued with status
 * 'awaiting_approval' instead of being submitted immediately. Authorised
 * signers call approveDonation() (exposed via POST /donations/:id/approve,
 * gated behind the donations:approve permission — see
 * tests/security/rbac-authorization-matrix.test.js for the HTTP-level
 * permission check) until the required threshold is met, at which point the
 * donation is submitted to Stellar automatically. Unapproved donations past
 * their approval window are expired by expireOverdueApprovals().
 *
 * The config singleton (src/config) is mutated directly for the duration of
 * each test rather than reloaded via env vars + require.cache manipulation,
 * since it is loaded once per process.
 */

'use strict';

const config = require('../../src/config');
const DonationService = require('../../src/services/DonationService');
const Transaction = require('../../src/models/transaction');
const { TRANSACTION_STATES } = require('../../src/utils/transactionStateMachine');

const DONOR = `G${'A'.repeat(55)}`;
const RECIPIENT = `G${'B'.repeat(55)}`;

function makeStubStellarService(overrides = {}) {
  return {
    serviceSecretKey: 'SSTUBSECRETKEY0000000000000000000000000000000000000000',
    sendDonation: jest.fn().mockResolvedValue({ transactionId: 'stub-tx-hash', ledger: 12345 }),
    getAccountInfo: jest.fn().mockResolvedValue({ notFound: false }),
    setCorrelationId: jest.fn(),
    ...overrides,
  };
}

describe('Donation multi-sig approval workflow (#1498)', () => {
  let originalThreshold;
  let originalRequiredApprovals;

  beforeEach(() => {
    originalThreshold = config.donations.multisigThresholdXLM;
    originalRequiredApprovals = config.donations.multisigRequiredApprovals;
  });

  afterEach(() => {
    config.donations.multisigThresholdXLM = originalThreshold;
    config.donations.multisigRequiredApprovals = originalRequiredApprovals;
  });

  describe('createDonationRecord() threshold gating', () => {
    it('processes a donation below the threshold immediately (unchanged behavior)', async () => {
      config.donations.multisigThresholdXLM = 1000;
      config.donations.multisigRequiredApprovals = 2;

      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 100,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(tx.requiresApproval).toBe(false);
      expect(stellarService.sendDonation).toHaveBeenCalledTimes(1);
    });

    it('queues a donation above the threshold as awaiting_approval instead of submitting it', async () => {
      config.donations.multisigThresholdXLM = 1000;
      config.donations.multisigRequiredApprovals = 2;

      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 5000,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.status).toBe(TRANSACTION_STATES.AWAITING_APPROVAL);
      expect(tx.requiresApproval).toBe(true);
      expect(tx.requiredApprovals).toBe(2);
      expect(tx.approvals).toEqual([]);
      expect(tx.approvalExpiresAt).toBeTruthy();
      expect(stellarService.sendDonation).not.toHaveBeenCalled();
    });

    it('does not gate donations when MULTISIG_THRESHOLD_XLM is unset (disabled)', async () => {
      config.donations.multisigThresholdXLM = null;

      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 9000,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(stellarService.sendDonation).toHaveBeenCalledTimes(1);
    });
  });

  describe('approveDonation()', () => {
    async function createAwaitingApproval(donationService, overrides = {}) {
      config.donations.multisigThresholdXLM = 1000;
      config.donations.multisigRequiredApprovals = 2;
      return donationService.createDonationRecord({
        amount: 5000,
        donor: DONOR,
        recipient: RECIPIENT,
        ...overrides,
      });
    }

    it('records one approval without submitting when the threshold is not yet met', async () => {
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);
      const tx = await createAwaitingApproval(donationService);

      const result = await donationService.approveDonation(tx.id, { signerKeyId: 'signer-a' });

      expect(result.fullyApproved).toBe(false);
      expect(result.approvalsCount).toBe(1);
      expect(result.transaction.status).toBe(TRANSACTION_STATES.AWAITING_APPROVAL);
      expect(stellarService.sendDonation).not.toHaveBeenCalled();
    });

    it('submits the donation once the required number of distinct signers approve', async () => {
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);
      const tx = await createAwaitingApproval(donationService);

      await donationService.approveDonation(tx.id, { signerKeyId: 'signer-a' });
      const result = await donationService.approveDonation(tx.id, { signerKeyId: 'signer-b' });

      expect(result.fullyApproved).toBe(true);
      expect(result.approvalsCount).toBe(2);
      expect(result.transaction.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(result.transaction.stellarTxId).toBe('stub-tx-hash');
      expect(stellarService.sendDonation).toHaveBeenCalledTimes(1);
    });

    it('rejects a second approval from the same signer', async () => {
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);
      const tx = await createAwaitingApproval(donationService);

      await donationService.approveDonation(tx.id, { signerKeyId: 'signer-a' });

      await expect(
        donationService.approveDonation(tx.id, { signerKeyId: 'signer-a' })
      ).rejects.toThrow(/already approved/);
    });

    it('rejects approval when signerKeyId is missing', async () => {
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);
      const tx = await createAwaitingApproval(donationService);

      await expect(donationService.approveDonation(tx.id, {})).rejects.toThrow(/signerKeyId is required/);
    });

    it('rejects approval for a donation not awaiting approval', async () => {
      config.donations.multisigThresholdXLM = 1000;
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 100, // below threshold — processed immediately
        donor: DONOR,
        recipient: RECIPIENT,
      });
      expect(tx.status).toBe(TRANSACTION_STATES.CONFIRMED);

      await expect(
        donationService.approveDonation(tx.id, { signerKeyId: 'signer-a' })
      ).rejects.toThrow(/not awaiting approval/);
    });

    it('rejects approval for an unknown donation id', async () => {
      const donationService = new DonationService(makeStubStellarService());

      await expect(
        donationService.approveDonation('nonexistent-id', { signerKeyId: 'signer-a' })
      ).rejects.toThrow(/not found/i);
    });

    it('marks the donation failed and surfaces the error when submission fails on full approval', async () => {
      const stellarService = makeStubStellarService({
        sendDonation: jest.fn().mockRejectedValue(new Error('horizon unreachable')),
      });
      const donationService = new DonationService(stellarService);
      const tx = await createAwaitingApproval(donationService);

      await donationService.approveDonation(tx.id, { signerKeyId: 'signer-a' });
      await expect(
        donationService.approveDonation(tx.id, { signerKeyId: 'signer-b' })
      ).rejects.toThrow(/failed to submit/);

      const failed = Transaction.getById(tx.id);
      expect(failed.status).toBe(TRANSACTION_STATES.FAILED);
    });
  });

  describe('expireOverdueApprovals()', () => {
    it('expires donations whose approval window has passed and leaves others untouched', async () => {
      config.donations.multisigThresholdXLM = 1000;
      config.donations.multisigRequiredApprovals = 2;

      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const overdue = await donationService.createDonationRecord({
        amount: 5000,
        donor: DONOR,
        recipient: RECIPIENT,
      });
      const stillOpen = await donationService.createDonationRecord({
        amount: 5000,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      // Backdate the approval window so `overdue` is already past due.
      // Transaction.getById() returns the live in-memory record (see
      // Transaction.updateApprovals doc comment) — mutating it directly is
      // the same pattern the tags endpoints in donations/notes.js rely on.
      Transaction.getById(overdue.id).approvalExpiresAt = new Date(Date.now() - 1000).toISOString();

      const { expired } = await donationService.expireOverdueApprovals();

      expect(expired).toBeGreaterThanOrEqual(1);
      expect(Transaction.getById(overdue.id).status).toBe(TRANSACTION_STATES.EXPIRED);
      expect(Transaction.getById(stillOpen.id).status).toBe(TRANSACTION_STATES.AWAITING_APPROVAL);
    });
  });
});
