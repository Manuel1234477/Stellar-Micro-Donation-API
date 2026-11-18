/**
 * Tests for DonationService batch processing.
 *
 * Extracted from tests/issues/issues-1311-1312-1313-1314.test.js.
 * Issue numbers are preserved in describe titles for traceability.
 */

'use strict';

const DonationService = require('../../src/services/DonationService');

describe('DonationService batch processing', () => {
  let service;
  let mockDonationRepository;
  let mockCampaignRepository;
  let mockMatchingRepository;
  let mockLogger;

  beforeEach(() => {
    mockDonationRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      findByStatus: jest.fn(),
    };

    mockCampaignRepository = {
      findById: jest.fn(),
      update: jest.fn(),
      incrementRaised: jest.fn(),
    };

    mockMatchingRepository = {
      findActiveMatches: jest.fn(),
      createMatch: jest.fn(),
      updateMatch: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    service = new DonationService({
      donationRepository: mockDonationRepository,
      campaignRepository: mockCampaignRepository,
      matchingRepository: mockMatchingRepository,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('#1313 batch processing is all-or-nothing on failure', () => {
    it('processes all donations successfully when no errors occur', async () => {
      const donations = [
        { id: 'd1', amount: 10, campaignId: 'c1' },
        { id: 'd2', amount: 20, campaignId: 'c1' },
        { id: 'd3', amount: 30, campaignId: 'c2' },
      ];

      mockDonationRepository.create.mockImplementation(async (donation) => ({
        ...donation,
        status: 'completed',
      }));
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.success).toBe(true);
      expect(result.processed).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(mockDonationRepository.create).toHaveBeenCalledTimes(3);
    });

    it('rolls back all donations when any donation fails', async () => {
      const donations = [
        { id: 'd1', amount: 10, campaignId: 'c1' },
        { id: 'd2', amount: 20, campaignId: 'c1' },
        { id: 'd3', amount: 30, campaignId: 'c2' },
      ];

      mockDonationRepository.create
        .mockResolvedValueOnce({ id: 'd1', status: 'completed' })
        .mockRejectedValueOnce(new Error('Database failure'))
        .mockResolvedValueOnce({ id: 'd3', status: 'completed' });

      mockDonationRepository.update.mockResolvedValue({ success: true });
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.success).toBe(false);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe('d2');
      expect(mockDonationRepository.update).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ status: 'rolled_back' })
      );
    });

    it('does not partially commit campaign totals when batch fails', async () => {
      const donations = [
        { id: 'd1', amount: 10, campaignId: 'c1' },
        { id: 'd2', amount: 20, campaignId: 'c1' },
      ];

      mockDonationRepository.create
        .mockResolvedValueOnce({ id: 'd1', status: 'completed' })
        .mockRejectedValueOnce(new Error('Insert failed'));
      mockDonationRepository.update.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.success).toBe(false);
      expect(mockCampaignRepository.incrementRaised).not.toHaveBeenCalled();
    });

    it('returns an empty result for an empty batch', async () => {
      const result = await service.processBatch([]);

      expect(result.success).toBe(true);
      expect(result.processed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(mockDonationRepository.create).not.toHaveBeenCalled();
    });

    it('logs an error when a batch fails', async () => {
      const donations = [{ id: 'd1', amount: 10, campaignId: 'c1' }];

      mockDonationRepository.create.mockRejectedValue(new Error('boom'));

      await service.processBatch(donations);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('#1314 batch campaign and matching processing', () => {
    it('updates campaign totals for each successful donation', async () => {
      const donations = [
        { id: 'd1', amount: 10, campaignId: 'c1' },
        { id: 'd2', amount: 20, campaignId: 'c1' },
        { id: 'd3', amount: 30, campaignId: 'c2' },
      ];

      mockDonationRepository.create.mockImplementation(async (donation) => ({
        ...donation,
        status: 'completed',
      }));
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.success).toBe(true);
      expect(mockCampaignRepository.incrementRaised).toHaveBeenCalledWith('c1', 30);
      expect(mockCampaignRepository.incrementRaised).toHaveBeenCalledWith('c2', 30);
    });

    it('applies matching donations for eligible campaigns', async () => {
      const donations = [
        { id: 'd1', amount: 100, campaignId: 'c1' },
        { id: 'd2', amount: 50, campaignId: 'c1' },
      ];

      mockDonationRepository.create.mockImplementation(async (donation) => ({
        ...donation,
        status: 'completed',
      }));
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });
      mockMatchingRepository.findActiveMatches.mockResolvedValue([
        { id: 'm1', campaignId: 'c1', ratio: 1, remaining: 1000 },
      ]);
      mockMatchingRepository.createMatch.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.success).toBe(true);
      expect(mockMatchingRepository.findActiveMatches).toHaveBeenCalledWith('c1');
      expect(mockMatchingRepository.createMatch).toHaveBeenCalledTimes(2);
    });

    it('skips matching when no active matches exist', async () => {
      const donations = [{ id: 'd1', amount: 100, campaignId: 'c1' }];

      mockDonationRepository.create.mockImplementation(async (donation) => ({
        ...donation,
        status: 'completed',
      }));
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });
      mockMatchingRepository.findActiveMatches.mockResolvedValue([]);

      const result = await service.processBatch(donations);

      expect(result.success).toBe(true);
      expect(mockMatchingRepository.createMatch).not.toHaveBeenCalled();
    });

    it('aggregates campaign totals across multiple donations to the same campaign', async () => {
      const donations = [
        { id: 'd1', amount: 25, campaignId: 'c1' },
        { id: 'd2', amount: 75, campaignId: 'c1' },
      ];

      mockDonationRepository.create.mockImplementation(async (donation) => ({
        ...donation,
        status: 'completed',
      }));
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.success).toBe(true);
      expect(mockCampaignRepository.incrementRaised).toHaveBeenCalledTimes(1);
      expect(mockCampaignRepository.incrementRaised).toHaveBeenCalledWith('c1', 100);
    });

    it('reports processed donations with their campaign association', async () => {
      const donations = [
        { id: 'd1', amount: 10, campaignId: 'c1' },
        { id: 'd2', amount: 20, campaignId: 'c2' },
      ];

      mockDonationRepository.create.mockImplementation(async (donation) => ({
        ...donation,
        status: 'completed',
      }));
      mockCampaignRepository.incrementRaised.mockResolvedValue({ success: true });

      const result = await service.processBatch(donations);

      expect(result.processed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'd1', campaignId: 'c1' }),
          expect.objectContaining({ id: 'd2', campaignId: 'c2' }),
        ])
      );
    });
  });
});