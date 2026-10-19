'use strict';

/**
 * Tests for DonationService custodial donation handling.
 *
 * Extracted from tests/issues/issues-1311-1312-1313-1314.test.js to follow
 * docs/TEST_NAMING_CONVENTION.md. Issue numbers are preserved in describe
 * titles for traceability.
 */

jest.mock('../../src/services/DonationService', () => {
  const actual = jest.requireActual('../../src/services/DonationService');
  return actual;
});

const DonationService = require('../../src/services/DonationService');

describe('DonationService custodial donations', () => {
  let service;
  let mockDonorWallet;
  let mockRecipientWallet;
  let mockStellarService;
  let mockDonationModel;

  beforeEach(() => {
    mockDonorWallet = {
      publicKey: 'GDONOR1234567890',
      secretKey: 'SDONOR1234567890',
      getPublicKey: jest.fn().mockReturnValue('GDONOR1234567890'),
    };

    mockRecipientWallet = {
      publicKey: 'GRECIPIENT1234567890',
      getPublicKey: jest.fn().mockReturnValue('GRECIPIENT1234567890'),
    };

    mockStellarService = {
      accountExists: jest.fn().mockResolvedValue(true),
      sendPayment: jest.fn().mockResolvedValue({ hash: 'txhash123' }),
      loadAccount: jest.fn().mockResolvedValue({ id: 'GRECIPIENT1234567890' }),
    };

    mockDonationModel = {
      create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 1, ...data })),
      findById: jest.fn(),
    };

    service = new DonationService({
      stellarService: mockStellarService,
      donationModel: mockDonationModel,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('#1311 self-donation rejection', () => {
    it('rejects a custodial donation when donor and recipient are the same account', async () => {
      const donorPublicKey = 'GSAMEACCOUNT1234567890';
      const recipientPublicKey = 'GSAMEACCOUNT1234567890';

      mockDonorWallet.getPublicKey.mockReturnValue(donorPublicKey);
      mockRecipientWallet.getPublicKey.mockReturnValue(recipientPublicKey);

      await expect(
        service.sendCustodialDonation({
          donorWallet: mockDonorWallet,
          recipientWallet: mockRecipientWallet,
          amount: '10',
          asset: 'XLM',
        })
      ).rejects.toThrow(/self/i);

      expect(mockStellarService.sendPayment).not.toHaveBeenCalled();
      expect(mockDonationModel.create).not.toHaveBeenCalled();
    });

    it('rejects a custodial donation when donor and recipient public keys match', async () => {
      const sharedKey = 'GSHAREDKEY1234567890';

      await expect(
        service.sendCustodialDonation({
          donorPublicKey: sharedKey,
          recipientPublicKey: sharedKey,
          amount: '5',
          asset: 'XLM',
        })
      ).rejects.toThrow(/self/i);

      expect(mockStellarService.sendPayment).not.toHaveBeenCalled();
    });

    it('allows a custodial donation when donor and recipient differ', async () => {
      const result = await service.sendCustodialDonation({
        donorWallet: mockDonorWallet,
        recipientWallet: mockRecipientWallet,
        amount: '10',
        asset: 'XLM',
      });

      expect(mockStellarService.sendPayment).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('#1312 recipient account existence caching', () => {
    it('caches the recipient account existence check across donations', async () => {
      mockStellarService.accountExists.mockResolvedValue(true);

      await service.sendCustodialDonation({
        donorWallet: mockDonorWallet,
        recipientWallet: mockRecipientWallet,
        amount: '10',
        asset: 'XLM',
      });

      await service.sendCustodialDonation({
        donorWallet: mockDonorWallet,
        recipientWallet: mockRecipientWallet,
        amount: '20',
        asset: 'XLM',
      });

      expect(mockStellarService.accountExists).toHaveBeenCalledTimes(1);
      expect(mockStellarService.accountExists).toHaveBeenCalledWith('GRECIPIENT1234567890');
    });

    it('rejects a custodial donation when the recipient account does not exist', async () => {
      mockStellarService.accountExists.mockResolvedValue(false);

      await expect(
        service.sendCustodialDonation({
          donorWallet: mockDonorWallet,
          recipientWallet: mockRecipientWallet,
          amount: '10',
          asset: 'XLM',
        })
      ).rejects.toThrow(/recipient/i);

      expect(mockStellarService.sendPayment).not.toHaveBeenCalled();
    });

    it('does not cache a negative existence result indefinitely', async () => {
      mockStellarService.accountExists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(
        service.sendCustodialDonation({
          donorWallet: mockDonorWallet,
          recipientWallet: mockRecipientWallet,
          amount: '10',
          asset: 'XLM',
        })
      ).rejects.toThrow(/recipient/i);

      const result = await service.sendCustodialDonation({
        donorWallet: mockDonorWallet,
        recipientWallet: mockRecipientWallet,
        amount: '10',
        asset: 'XLM',
      });

      expect(mockStellarService.accountExists).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });
  });
});