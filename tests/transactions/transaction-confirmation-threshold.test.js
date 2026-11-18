/**
 * Transaction Confirmation Threshold Monitoring (#1606)
 *
 * Tests the complete confirmation threshold workflow:
 * 1. Configuration loading and validation (max 10, min 1)
 * 2. State machine transitions: SUBMITTED → PENDING_CONFIRMATION → CONFIRMED
 * 3. Donation flow with pending_confirmation state for high-threshold donations
 * 4. Background worker polling transactions awaiting confirmation
 * 5. High-value donations auto-override threshold (MULTISIG_THRESHOLD_XLM)
 *
 * The config singleton is mutated directly for test duration rather than
 * reloaded via env vars + require.cache manipulation.
 */

'use strict';

const config = require('../../src/config');
const DonationService = require('../../src/services/DonationService');
const Transaction = require('../../src/models/transaction');
const { TRANSACTION_STATES } = require('../../src/utils/transactionStateMachine');
const { checkConfirmations, checkAllPendingConfirmations, getCurrentLedger } = require('../../src/utils/confirmationChecker');
const { CONFIRMATION_THRESHOLD } = require('../../src/config/confirmationThreshold');

const DONOR = `G${'A'.repeat(55)}`;
const RECIPIENT = `G${'B'.repeat(55)}`;

function makeStubStellarService(overrides = {}) {
  return {
    serviceSecretKey: 'SSTUBSECRETKEY0000000000000000000000000000000000000000',
    sendDonation: jest.fn().mockResolvedValue({
      transactionId: 'stub-tx-hash',
      ledger: 1000,
      currentLedger: 1000,
    }),
    getAccountInfo: jest.fn().mockResolvedValue({ notFound: false }),
    server: {
      ledgers: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue({
              records: [{ sequence: 1000 }],
            }),
          }),
        }),
      }),
    },
    setCorrelationId: jest.fn(),
    ...overrides,
  };
}

describe('Transaction Confirmation Threshold Monitoring (#1606)', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // Configuration Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('Configuration (confirmationThreshold.js)', () => {
    it('exports CONFIRMATION_THRESHOLD constant', () => {
      expect(CONFIRMATION_THRESHOLD).toBeDefined();
      expect(typeof CONFIRMATION_THRESHOLD).toBe('number');
      expect(CONFIRMATION_THRESHOLD >= 1).toBe(true);
      expect(CONFIRMATION_THRESHOLD <= 10).toBe(true);
    });

    it('has default threshold of 1 when environment is not set', () => {
      // The module is already loaded, so just verify defaults
      const { DEFAULT_THRESHOLD, MIN_THRESHOLD, MAX_THRESHOLD } = require('../../src/config/confirmationThreshold');
      expect(DEFAULT_THRESHOLD).toBe(1);
      expect(MIN_THRESHOLD).toBe(1);
      expect(MAX_THRESHOLD).toBe(10);
    });

    it('clamps threshold to maximum of 10', () => {
      const { loadConfirmationThreshold } = require('../../src/config/confirmationThreshold');
      // Mock process.env for this test
      const originalEnv = process.env.CONFIRMATION_THRESHOLD;
      try {
        process.env.CONFIRMATION_THRESHOLD = '15';
        const threshold = loadConfirmationThreshold();
        expect(threshold).toBe(10);
      } finally {
        process.env.CONFIRMATION_THRESHOLD = originalEnv;
      }
    });

    it('clamps threshold to minimum of 1', () => {
      const { loadConfirmationThreshold } = require('../../src/config/confirmationThreshold');
      const originalEnv = process.env.CONFIRMATION_THRESHOLD;
      try {
        process.env.CONFIRMATION_THRESHOLD = '0';
        const threshold = loadConfirmationThreshold();
        expect(threshold).toBe(1);
      } finally {
        process.env.CONFIRMATION_THRESHOLD = originalEnv;
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Confirmation Checker Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('checkConfirmations() - Threshold Calculation', () => {
    it('returns confirmed: true when confirmations >= required (1-ledger threshold)', () => {
      const result = checkConfirmations(1000, 1001, 1);
      expect(result.confirmed).toBe(true);
      expect(result.confirmations).toBe(1);
      expect(result.required).toBe(1);
    });

    it('returns confirmed: false when confirmations < required', () => {
      const result = checkConfirmations(1000, 1001, 3);
      expect(result.confirmed).toBe(false);
      expect(result.confirmations).toBe(1);
      expect(result.required).toBe(3);
    });

    it('returns confirmed: true for 3-ledger confirmation when threshold is met', () => {
      const result = checkConfirmations(1000, 1003, 3);
      expect(result.confirmed).toBe(true);
      expect(result.confirmations).toBe(3);
      expect(result.required).toBe(3);
    });

    it('handles edge case: transaction and current ledger are same', () => {
      const result = checkConfirmations(1000, 1000, 1);
      expect(result.confirmed).toBe(false);
      expect(result.confirmations).toBe(0);
    });

    it('throws error when transactionLedger is invalid', () => {
      expect(() => checkConfirmations(-1, 1000, 1)).toThrow();
      expect(() => checkConfirmations(null, 1000, 1)).toThrow();
      expect(() => checkConfirmations(NaN, 1000, 1)).toThrow();
    });

    it('throws error when currentLedger is invalid', () => {
      expect(() => checkConfirmations(1000, -1, 1)).toThrow();
      expect(() => checkConfirmations(1000, null, 1)).toThrow();
      expect(() => checkConfirmations(1000, NaN, 1)).toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // State Machine Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('Transaction State Machine - PENDING_CONFIRMATION state', () => {
    it('includes PENDING_CONFIRMATION state in TRANSACTION_STATES', () => {
      expect(TRANSACTION_STATES.PENDING_CONFIRMATION).toBe('pending_confirmation');
    });

    it('allows transition from SUBMITTED to PENDING_CONFIRMATION', () => {
      const { canTransition } = require('../../src/utils/transactionStateMachine');
      expect(canTransition(TRANSACTION_STATES.SUBMITTED, TRANSACTION_STATES.PENDING_CONFIRMATION)).toBe(true);
    });

    it('allows transition from PENDING_CONFIRMATION to CONFIRMED', () => {
      const { canTransition } = require('../../src/utils/transactionStateMachine');
      expect(canTransition(TRANSACTION_STATES.PENDING_CONFIRMATION, TRANSACTION_STATES.CONFIRMED)).toBe(true);
    });

    it('allows transition from PENDING_CONFIRMATION to FAILED', () => {
      const { canTransition } = require('../../src/utils/transactionStateMachine');
      expect(canTransition(TRANSACTION_STATES.PENDING_CONFIRMATION, TRANSACTION_STATES.FAILED)).toBe(true);
    });

    it('does not allow direct transition from PENDING_CONFIRMATION to other states', () => {
      const { canTransition } = require('../../src/utils/transactionStateMachine');
      expect(canTransition(TRANSACTION_STATES.PENDING_CONFIRMATION, TRANSACTION_STATES.SUBMITTED)).toBe(false);
      expect(canTransition(TRANSACTION_STATES.PENDING_CONFIRMATION, TRANSACTION_STATES.QUEUED)).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Donation Flow Tests - 1-Ledger Confirmation
  // ────────────────────────────────────────────────────────────────────────────

  describe('Donation flow - 1-Ledger Confirmation (Default)', () => {
    let originalMultisigThreshold;

    beforeEach(() => {
      originalMultisigThreshold = config.donations.multisigThresholdXLM;
    });

    afterEach(() => {
      config.donations.multisigThresholdXLM = originalMultisigThreshold;
    });

    it('marks donation CONFIRMED immediately when threshold = 1 (most common case)', async () => {
      config.donations.multisigThresholdXLM = null; // Disable multisig
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 100,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.status).toBe(TRANSACTION_STATES.CONFIRMED);
      expect(tx.confirmed).toBe(true);
      expect(tx.confirmationThreshold).toBe(1);
      expect(tx.confirmations).toBeGreaterThanOrEqual(0);
    });

    it('returns transaction object with confirmation details', async () => {
      config.donations.multisigThresholdXLM = null;
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 50,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx).toHaveProperty('id');
      expect(tx).toHaveProperty('stellarTxId');
      expect(tx).toHaveProperty('ledger');
      expect(tx).toHaveProperty('confirmationThreshold');
      expect(tx).toHaveProperty('confirmations');
      expect(tx).toHaveProperty('confirmed');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Donation Flow Tests - Multi-Ledger Confirmation
  // ────────────────────────────────────────────────────────────────────────────

  describe('Donation flow - Multi-Ledger Confirmation (Pending)', () => {
    let originalMultisigThreshold;

    beforeEach(() => {
      originalMultisigThreshold = config.donations.multisigThresholdXLM;
    });

    afterEach(() => {
      config.donations.multisigThresholdXLM = originalMultisigThreshold;
    });

    it('marks donation PENDING_CONFIRMATION when threshold > 1 and not yet confirmed', async () => {
      config.donations.multisigThresholdXLM = null; // Disable multisig
      
      // Mock StellarService to return transaction in a ledger with insufficient confirmations
      const stellarService = makeStubStellarService({
        sendDonation: jest.fn().mockResolvedValue({
          transactionId: 'tx-hash-1',
          ledger: 1000,
          currentLedger: 1000, // Same as transaction ledger = 0 confirmations
        }),
      });
      
      const donationService = new DonationService(stellarService);

      // Mock the config to use a higher threshold temporarily
      const origThreshold = require('../../src/config/confirmationThreshold').CONFIRMATION_THRESHOLD;
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: 3, configurable: true }
      );

      try {
        const tx = await donationService.createDonationRecord({
          amount: 100,
          donor: DONOR,
          recipient: RECIPIENT,
        });

        // When threshold > 1 and not yet confirmed, should be PENDING_CONFIRMATION
        expect(tx.status).toBe(TRANSACTION_STATES.PENDING_CONFIRMATION);
        expect(tx.confirmed).toBe(false);
        expect(tx.confirmationThreshold).toBe(3);
      } finally {
        Object.defineProperty(
          require('../../src/config/confirmationThreshold'),
          'CONFIRMATION_THRESHOLD',
          { value: origThreshold, configurable: true }
        );
      }
    });

    it('marks donation CONFIRMED when multi-ledger threshold is met immediately', async () => {
      config.donations.multisigThresholdXLM = null;
      
      // Mock StellarService to return transaction already 3 ledgers deep
      const stellarService = makeStubStellarService({
        sendDonation: jest.fn().mockResolvedValue({
          transactionId: 'tx-hash-2',
          ledger: 1000,
          currentLedger: 1003, // 3 confirmations immediately
        }),
      });
      
      const donationService = new DonationService(stellarService);

      const origThreshold = require('../../src/config/confirmationThreshold').CONFIRMATION_THRESHOLD;
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: 3, configurable: true }
      );

      try {
        const tx = await donationService.createDonationRecord({
          amount: 100,
          donor: DONOR,
          recipient: RECIPIENT,
        });

        expect(tx.status).toBe(TRANSACTION_STATES.CONFIRMED);
        expect(tx.confirmed).toBe(true);
        expect(tx.confirmationThreshold).toBe(3);
        expect(tx.confirmations).toBe(3);
      } finally {
        Object.defineProperty(
          require('../../src/config/confirmationThreshold'),
          'CONFIRMATION_THRESHOLD',
          { value: origThreshold, configurable: true }
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // High-Value Donation Auto-Threshold Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('High-Value Donation Auto-Threshold Override', () => {
    let originalMultisigThreshold;
    let originalThreshold;

    beforeEach(() => {
      originalMultisigThreshold = config.donations.multisigThresholdXLM;
      originalThreshold = require('../../src/config/confirmationThreshold').CONFIRMATION_THRESHOLD;
    });

    afterEach(() => {
      config.donations.multisigThresholdXLM = originalMultisigThreshold;
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: originalThreshold, configurable: true }
      );
    });

    it('enforces minimum 2-ledger confirmation for donations above MULTISIG_THRESHOLD_XLM', async () => {
      config.donations.multisigThresholdXLM = 1000; // High-value threshold
      
      // Set global threshold to 1 (normally immediate)
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: 1, configurable: true }
      );

      const stellarService = makeStubStellarService({
        sendDonation: jest.fn().mockResolvedValue({
          transactionId: 'tx-hash-3',
          ledger: 1000,
          currentLedger: 1000, // Only 0 confirmations
        }),
      });

      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 5000, // Above multisig threshold
        donor: DONOR,
        recipient: RECIPIENT,
      });

      // Even though global threshold is 1, high-value donations get minimum 2
      expect(tx.confirmationThreshold).toBeGreaterThanOrEqual(2);
      expect(tx.status).toBe(TRANSACTION_STATES.PENDING_CONFIRMATION);
    });

    it('does not override threshold for donations below MULTISIG_THRESHOLD_XLM', async () => {
      config.donations.multisigThresholdXLM = 1000;
      
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: 1, configurable: true }
      );

      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 500, // Below multisig threshold
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.confirmationThreshold).toBe(1);
      expect(tx.status).toBe(TRANSACTION_STATES.CONFIRMED);
    });

    it('uses configured threshold when no multisig threshold is set', async () => {
      config.donations.multisigThresholdXLM = null; // Disabled
      
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: 1, configurable: true }
      );

      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const tx = await donationService.createDonationRecord({
        amount: 9000, // Would be high-value if threshold was set
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.confirmationThreshold).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Background Worker / Polling Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('Background Polling - checkAllPendingConfirmations()', () => {
    it('returns summary with checked, updated, and errors counts', async () => {
      const stellarService = makeStubStellarService();
      const donationService = new DonationService(stellarService);

      const result = await checkAllPendingConfirmations(stellarService, donationService);

      expect(result).toHaveProperty('checked');
      expect(result).toHaveProperty('updated');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('details');
      expect(Array.isArray(result.details)).toBe(true);
      expect(typeof result.checked).toBe('number');
      expect(typeof result.updated).toBe('number');
      expect(typeof result.errors).toBe('number');
    });

    it('throws error when stellarService is missing', async () => {
      const donationService = new DonationService(null);
      await expect(checkAllPendingConfirmations(null, donationService)).rejects.toThrow();
    });

    it('throws error when donationService is missing', async () => {
      const stellarService = makeStubStellarService();
      await expect(checkAllPendingConfirmations(stellarService, null)).rejects.toThrow();
    });
  });

  describe('Background Polling - getCurrentLedger()', () => {
    it('fetches current ledger sequence from Horizon API', async () => {
      const stellarService = makeStubStellarService();
      const ledger = await getCurrentLedger(stellarService);

      expect(typeof ledger).toBe('number');
      expect(ledger).toBeGreaterThan(0);
      expect(ledger).toBe(1000); // From our mock
    });

    it('throws error when unable to fetch ledger', async () => {
      const stellarService = makeStubStellarService({
        server: {
          ledgers: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                call: jest.fn().mockRejectedValue(new Error('Network error')),
              }),
            }),
          }),
        },
      });

      await expect(getCurrentLedger(stellarService)).rejects.toThrow();
    });

    it('throws error when ledger records are empty', async () => {
      const stellarService = makeStubStellarService({
        server: {
          ledgers: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                call: jest.fn().mockResolvedValue({ records: [] }),
              }),
            }),
          }),
        },
      });

      await expect(getCurrentLedger(stellarService)).rejects.toThrow();
    });

    it('throws error when ledger sequence is invalid', async () => {
      const stellarService = makeStubStellarService({
        server: {
          ledgers: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                call: jest.fn().mockResolvedValue({
                  records: [{ sequence: -1 }], // Invalid
                }),
              }),
            }),
          }),
        },
      });

      await expect(getCurrentLedger(stellarService)).rejects.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Integration Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('End-to-End Confirmation Flow', () => {
    let originalMultisigThreshold;
    let originalThreshold;

    beforeEach(() => {
      originalMultisigThreshold = config.donations.multisigThresholdXLM;
      originalThreshold = require('../../src/config/confirmationThreshold').CONFIRMATION_THRESHOLD;
    });

    afterEach(() => {
      config.donations.multisigThresholdXLM = originalMultisigThreshold;
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: originalThreshold, configurable: true }
      );
    });

    it('transitions transaction from SUBMITTED → PENDING_CONFIRMATION → CONFIRMED', async () => {
      config.donations.multisigThresholdXLM = null;
      
      // Step 1: Create donation with high threshold, initially pending
      Object.defineProperty(
        require('../../src/config/confirmationThreshold'),
        'CONFIRMATION_THRESHOLD',
        { value: 3, configurable: true }
      );

      let callCount = 0;
      const stellarService = makeStubStellarService({
        sendDonation: jest.fn().mockResolvedValue({
          transactionId: 'tx-hash-end-to-end',
          ledger: 1000,
          currentLedger: 1000, // Not yet confirmed
        }),
        server: {
          ledgers: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                call: jest.fn(async () => {
                  // Simulate ledger progression
                  callCount++;
                  return { records: [{ sequence: 1000 + callCount }] };
                }),
              }),
            }),
          }),
        },
      });

      const donationService = new DonationService(stellarService);

      // Step 1: Create and verify initially PENDING_CONFIRMATION
      const tx = await donationService.createDonationRecord({
        amount: 100,
        donor: DONOR,
        recipient: RECIPIENT,
      });

      expect(tx.status).toBe(TRANSACTION_STATES.PENDING_CONFIRMATION);
      expect(tx.confirmations).toBe(0);

      // Step 2: Simulate polling - verify transaction transitions to CONFIRMED
      const result = await checkAllPendingConfirmations(stellarService, donationService);
      expect(result.checked).toBeGreaterThan(0);
      // After 3 ledger increments in our mock, it should be confirmed
      expect(result.updated).toBeGreaterThan(0);
    });
  });
});
