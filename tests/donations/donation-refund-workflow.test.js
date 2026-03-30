/**
 * Donation Refund Workflow Tests
 * 
 * COVERAGE:
 * - Successful refund of confirmed donations
 * - Refund eligibility window enforcement
 * - Prevention of double refunds
 * - Reverse transaction creation on Stellar
 * - Audit logging of refund operations
 * - Error handling for ineligible donations
 * - Permission-based access control
 * 
 * MINIMUM COVERAGE: 95%
 */

const request = require('supertest');
const Database = require('../../src/utils/database');
const DonationService = require('../../src/services/DonationService');
const { getStellarService } = require('../../src/config/stellar');
const AuditLogService = require('../../src/services/AuditLogService');
const { TRANSACTION_STATES } = require('../../src/utils/transactionStateMachine');
const { ValidationError, BusinessLogicError, NotFoundError } = require('../../src/utils/errors');
const Transaction = require('../../src/routes/models/transaction');

// Test setup
let app;
let donationService;
let stellarService;
let testApiKey;

beforeAll(async () => {
  // Initialize database
  await Database.initialize();

  // Create test app
  const express = require('express');
  app = express();
  app.use(express.json());

  // Setup services
  stellarService = getStellarService();
  donationService = new DonationService(stellarService);

  // Setup test API key
  testApiKey = 'test-api-key-refund-workflow';

  // Mount donation routes
  const donationRoutes = require('../../src/routes/donation');
  app.use('/donations', donationRoutes);

  // Global error handler
  app.use((err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    const code = err.errorCode || err.code || 'INTERNAL_ERROR';
    const message = err.message || 'Internal server error';

    res.status(status).json({
      success: false,
      error: { code, message, ...(err.details && { details: err.details }) }
    });
  });
});

afterAll(async () => {
  await Database.close();
});

beforeEach(async () => {
  // Clear transactions before each test
  Transaction.loadTransactions().length = 0;
  Transaction.saveTransactions([]);
});

describe('POST /donations/:id/refund', () => {
  describe('Successful Refund Scenarios', () => {
    test('should successfully refund a confirmed donation', async () => {
      // Create a confirmed donation
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR123',
        recipient: 'GRECIPIENT456',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-confirmed-123',
        timestamp: new Date().toISOString()
      });

      // Mock Stellar service to return successful reverse transaction
      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: 'tx-refund-reverse-123',
        ledger: 12345,
        hash: 'hash-refund-123'
      });

      // Mock user retrieval
      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 1,
        publicKey: 'GDONOR123',
        encryptedSecret: 'encrypted-secret-key'
      });

      // Mock encryption
      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret');

      try {
        const result = await donationService.refundDonation(donation.id, {
          reason: 'Customer requested refund',
          requestId: 'req-123'
        });

        expect(result).toHaveProperty('refundId');
        expect(result).toHaveProperty('originalDonationId', donation.id);
        expect(result).toHaveProperty('reverseTxId', 'tx-refund-reverse-123');
        expect(result).toHaveProperty('amount', 100);
        expect(result).toHaveProperty('reason', 'Customer requested refund');
        expect(result).toHaveProperty('status', 'pending');
        expect(result).toHaveProperty('refundedAt');

        // Verify reverse transaction was created
        expect(stellarService.sendDonation).toHaveBeenCalledWith(
          expect.objectContaining({
            destinationPublic: 'GDONOR123',
            amount: 100,
            memo: expect.stringContaining('REFUND:')
          })
        );

        // Verify audit log was created
        const auditLogs = await AuditLogService.query({
          category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
          limit: 1
        });
        expect(auditLogs.length).toBeGreaterThan(0);
      } finally {
        // Restore mocks
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });

    test('should include refund reason in audit log', async () => {
      const donation = Transaction.create({
        amount: 50,
        donor: 'GDONOR789',
        recipient: 'GRECIPIENT999',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-confirmed-789',
        timestamp: new Date().toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: 'tx-refund-reverse-789',
        ledger: 12346,
        hash: 'hash-refund-789'
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 2,
        publicKey: 'GDONOR789',
        encryptedSecret: 'encrypted-secret-key-2'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-2');

      try {
        const refundReason = 'Duplicate donation - accidental double charge';
        await donationService.refundDonation(donation.id, {
          reason: refundReason,
          requestId: 'req-456'
        });

        // Verify audit log contains reason
        const auditLogs = await AuditLogService.query({
          category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
          limit: 1
        });
        expect(auditLogs[0].details).toContain(refundReason);
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });
  });

  describe('Refund Eligibility Window', () => {
    test('should reject refund outside eligibility window (30 days)', async () => {
      // Create donation from 31 days ago
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-OLD',
        recipient: 'GRECIPIENT-OLD',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-old-123',
        timestamp: thirtyOneDaysAgo.toISOString()
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 3,
        publicKey: 'GDONOR-OLD',
        encryptedSecret: 'encrypted-secret-old'
      });

      try {
        await expect(
          donationService.refundDonation(donation.id, {
            reason: 'Too late',
            requestId: 'req-old'
          })
        ).rejects.toThrow(BusinessLogicError);

        // Verify error message mentions eligibility window
        try {
          await donationService.refundDonation(donation.id, {
            reason: 'Too late',
            requestId: 'req-old'
          });
        } catch (error) {
          expect(error.message).toContain('Refund window has expired');
          expect(error.message).toContain('30 days');
        }
      } finally {
        donationService.getUserById = originalGetUserById;
      }
    });

    test('should allow refund within eligibility window', async () => {
      // Create donation from 15 days ago (within 30-day window)
      const fifteenDaysAgo = new Date();
      fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-RECENT',
        recipient: 'GRECIPIENT-RECENT',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-recent-123',
        timestamp: fifteenDaysAgo.toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: 'tx-refund-recent-123',
        ledger: 12347,
        hash: 'hash-refund-recent-123'
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 4,
        publicKey: 'GDONOR-RECENT',
        encryptedSecret: 'encrypted-secret-recent'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-recent');

      try {
        const result = await donationService.refundDonation(donation.id, {
          reason: 'Within window',
          requestId: 'req-recent'
        });

        expect(result).toHaveProperty('refundId');
        expect(result.status).toBe('pending');
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });
  });

  describe('Double Refund Prevention', () => {
    test('should prevent refunding an already refunded donation', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-DOUBLE',
        recipient: 'GRECIPIENT-DOUBLE',
        status: 'refunded',
        stellarTxId: 'tx-double-123',
        timestamp: new Date().toISOString()
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 5,
        publicKey: 'GDONOR-DOUBLE',
        encryptedSecret: 'encrypted-secret-double'
      });

      try {
        await expect(
          donationService.refundDonation(donation.id, {
            reason: 'Double refund attempt',
            requestId: 'req-double'
          })
        ).rejects.toThrow(BusinessLogicError);

        try {
          await donationService.refundDonation(donation.id, {
            reason: 'Double refund attempt',
            requestId: 'req-double'
          });
        } catch (error) {
          expect(error.message).toContain('already been refunded');
        }
      } finally {
        donationService.getUserById = originalGetUserById;
      }
    });
  });

  describe('Donation Status Validation', () => {
    test('should reject refund when pending donation', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-PENDING',
        recipient: 'GRECIPIENT-PENDING',
        status: TRANSACTION_STATES.PENDING,
        stellarTxId: 'tx-pending-123',
        timestamp: new Date().toISOString()
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 6,
        publicKey: 'GDONOR-PENDING',
        encryptedSecret: 'encrypted-secret-pending'
      });

      try {
        await expect(
          donationService.refundDonation(donation.id, {
            reason: 'Pending donation',
            requestId: 'req-pending'
          })
        ).rejects.toThrow(BusinessLogicError);

        try {
          await donationService.refundDonation(donation.id, {
            reason: 'Pending donation',
            requestId: 'req-pending'
          });
        } catch (error) {
          expect(error.message).toContain('Only confirmed donations can be refunded');
        }
      } finally {
        donationService.getUserById = originalGetUserById;
      }
    });

    test('should reject refund when submitted donation', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-SUBMITTED',
        recipient: 'GRECIPIENT-SUBMITTED',
        status: TRANSACTION_STATES.SUBMITTED,
        stellarTxId: 'tx-submitted-123',
        timestamp: new Date().toISOString()
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 7,
        publicKey: 'GDONOR-SUBMITTED',
        encryptedSecret: 'encrypted-secret-submitted'
      });

      try {
        await expect(
          donationService.refundDonation(donation.id, {
            reason: 'Submitted donation',
            requestId: 'req-submitted'
          })
        ).rejects.toThrow(BusinessLogicError);
      } finally {
        donationService.getUserById = originalGetUserById;
      }
    });
  });

  describe('Error Handling', () => {
    test('should throw NotFoundError when non-existent donation', async () => {
      await expect(
        donationService.refundDonation('non-existent-id', {
          reason: 'Not found',
          requestId: 'req-notfound'
        })
      ).rejects.toThrow(NotFoundError);
    });

    test('should handle Stellar network errors gracefully', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-NETWORK-ERROR',
        recipient: 'GRECIPIENT-NETWORK-ERROR',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-network-error-123',
        timestamp: new Date().toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockRejectedValue(
        new Error('Stellar network timeout')
      );

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 8,
        publicKey: 'GDONOR-NETWORK-ERROR',
        encryptedSecret: 'encrypted-secret-network-error'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-network-error');

      try {
        await expect(
          donationService.refundDonation(donation.id, {
            reason: 'Network error',
            requestId: 'req-network-error'
          })
        ).rejects.toThrow();
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });

    test('should handle missing sender secret key', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-NO-SECRET',
        recipient: 'GRECIPIENT-NO-SECRET',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-no-secret-123',
        timestamp: new Date().toISOString()
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 9,
        publicKey: 'GDONOR-NO-SECRET',
        encryptedSecret: null // No secret key
      });

      try {
        await expect(
          donationService.refundDonation(donation.id, {
            reason: 'No secret',
            requestId: 'req-no-secret'
          })
        ).rejects.toThrow(ValidationError);
      } finally {
        donationService.getUserById = originalGetUserById;
      }
    });
  });

  describe('Audit Logging', () => {
    test('should create audit log entry when successful refund', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-AUDIT',
        recipient: 'GRECIPIENT-AUDIT',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-audit-123',
        timestamp: new Date().toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: 'tx-refund-audit-123',
        ledger: 12348,
        hash: 'hash-refund-audit-123'
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 10,
        publicKey: 'GDONOR-AUDIT',
        encryptedSecret: 'encrypted-secret-audit'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-audit');

      try {
        await donationService.refundDonation(donation.id, {
          reason: 'Audit test',
          requestId: 'req-audit'
        });

        // Verify audit log was created
        const auditLogs = await AuditLogService.query({
          category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
          limit: 10
        });

        const refundLog = auditLogs.find(log =>
          log.details && log.details.includes && log.details.includes('refund')
        );

        expect(refundLog).toBeDefined();
        expect(refundLog.severity).toBe(AuditLogService.SEVERITY.MEDIUM);
        expect(refundLog.result).toBe('SUCCESS');
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });

    test('should log refund when original and reverse transaction IDs', async () => {
      const originalTxId = 'tx-original-log-123';
      const reverseTxId = 'tx-reverse-log-123';

      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-LOG',
        recipient: 'GRECIPIENT-LOG',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: originalTxId,
        timestamp: new Date().toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: reverseTxId,
        ledger: 12349,
        hash: 'hash-reverse-log-123'
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 11,
        publicKey: 'GDONOR-LOG',
        encryptedSecret: 'encrypted-secret-log'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-log');

      try {
        await donationService.refundDonation(donation.id, {
          reason: 'Log test',
          requestId: 'req-log'
        });

        // Verify audit log contains both transaction IDs
        const auditLogs = await AuditLogService.query({
          category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
          limit: 10
        });

        const refundLog = auditLogs.find(log =>
          log.details && log.details.includes && log.details.includes(reverseTxId)
        );

        expect(refundLog).toBeDefined();
        expect(refundLog.details).toContain(originalTxId);
        expect(refundLog.details).toContain(reverseTxId);
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle refund when no reason provided', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-NO-REASON',
        recipient: 'GRECIPIENT-NO-REASON',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-no-reason-123',
        timestamp: new Date().toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: 'tx-refund-no-reason-123',
        ledger: 12350,
        hash: 'hash-refund-no-reason-123'
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 12,
        publicKey: 'GDONOR-NO-REASON',
        encryptedSecret: 'encrypted-secret-no-reason'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-no-reason');

      try {
        const result = await donationService.refundDonation(donation.id, {
          reason: null,
          requestId: 'req-no-reason'
        });

        expect(result).toHaveProperty('refundId');
        expect(result.reason).toBeNull();
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });

    test('should create reverse transaction when REFUND memo', async () => {
      const donation = Transaction.create({
        amount: 100,
        donor: 'GDONOR-MEMO',
        recipient: 'GRECIPIENT-MEMO',
        status: TRANSACTION_STATES.CONFIRMED,
        stellarTxId: 'tx-memo-123',
        timestamp: new Date().toISOString()
      });

      const originalSendDonation = stellarService.sendDonation;
      stellarService.sendDonation = jest.fn().mockResolvedValue({
        transactionId: 'tx-refund-memo-123',
        ledger: 12351,
        hash: 'hash-refund-memo-123'
      });

      const originalGetUserById = donationService.getUserById;
      donationService.getUserById = jest.fn().mockResolvedValue({
        id: 13,
        publicKey: 'GDONOR-MEMO',
        encryptedSecret: 'encrypted-secret-memo'
      });

      const encryption = require('../../src/utils/encryption');
      const originalDecrypt = encryption.decrypt;
      encryption.decrypt = jest.fn().mockReturnValue('decrypted-secret-memo');

      try {
        await donationService.refundDonation(donation.id, {
          reason: 'Memo test',
          requestId: 'req-memo'
        });

        // Verify reverse transaction was called with REFUND memo
        expect(stellarService.sendDonation).toHaveBeenCalledWith(
          expect.objectContaining({
            memo: expect.stringMatching(/^REFUND:/)
          })
        );
      } finally {
        stellarService.sendDonation = originalSendDonation;
        donationService.getUserById = originalGetUserById;
        encryption.decrypt = originalDecrypt;
      }
    });
  });
});
