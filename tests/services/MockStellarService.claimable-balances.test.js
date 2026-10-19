'use strict';

/**
 * Merged claimable-balances coverage for MockStellarService.
 *
 * This suite consolidates the former root-level
 * `tests/claimable-balances-extended.test.js` (and any base suite that
 * previously lived beside it) into the services feature folder.
 */

const MockStellarService = require('../../src/services/MockStellarService');

describe('MockStellarService - claimable balances', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  describe('createClaimableBalance', () => {
    test('creates a claimable balance and returns its id', async () => {
      const result = await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '100',
        claimants: [{ destination: 'GCLAIMANT', predicate: null }],
      });

      expect(result).toBeDefined();
      expect(result.balanceId).toBeDefined();
      expect(typeof result.balanceId).toBe('string');
    });

    test('stores the created balance for later retrieval', async () => {
      const { balanceId } = await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '250',
        claimants: [{ destination: 'GCLAIMANT', predicate: null }],
      });

      const balances = await service.getClaimableBalances('GCLAIMANT');
      expect(Array.isArray(balances)).toBe(true);
      expect(balances.some((b) => b.balanceId === balanceId)).toBe(true);
    });

    test('rejects a claimable balance with no claimants', async () => {
      await expect(
        service.createClaimableBalance({
          sourceAccount: 'GSOURCE',
          asset: 'XLM',
          amount: '10',
          claimants: [],
        })
      ).rejects.toThrow();
    });

    test('rejects a claimable balance with a non-positive amount', async () => {
      await expect(
        service.createClaimableBalance({
          sourceAccount: 'GSOURCE',
          asset: 'XLM',
          amount: '0',
          claimants: [{ destination: 'GCLAIMANT', predicate: null }],
        })
      ).rejects.toThrow();
    });
  });

  describe('getClaimableBalances', () => {
    test('returns an empty array when the account has no balances', async () => {
      const balances = await service.getClaimableBalances('GNOBALANCES');
      expect(balances).toEqual([]);
    });

    test('returns only balances for the requested claimant', async () => {
      await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '5',
        claimants: [{ destination: 'GALICE', predicate: null }],
      });
      await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '7',
        claimants: [{ destination: 'GBOB', predicate: null }],
      });

      const aliceBalances = await service.getClaimableBalances('GALICE');
      expect(aliceBalances).toHaveLength(1);
      expect(aliceBalances[0].amount).toBe('5');
    });
  });

  describe('claimClaimableBalance', () => {
    test('claims an existing balance', async () => {
      const { balanceId } = await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '42',
        claimants: [{ destination: 'GCLAIMANT', predicate: null }],
      });

      const result = await service.claimClaimableBalance({
        balanceId,
        claimant: 'GCLAIMANT',
      });

      expect(result).toBeDefined();
      expect(result.balanceId).toBe(balanceId);
    });

    test('removes the balance from the claimant list after claiming', async () => {
      const { balanceId } = await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '42',
        claimants: [{ destination: 'GCLAIMANT', predicate: null }],
      });

      await service.claimClaimableBalance({
        balanceId,
        claimant: 'GCLAIMANT',
      });

      const balances = await service.getClaimableBalances('GCLAIMANT');
      expect(balances.some((b) => b.balanceId === balanceId)).toBe(false);
    });

    test('rejects claiming a non-existent balance', async () => {
      await expect(
        service.claimClaimableBalance({
          balanceId: 'DOES_NOT_EXIST',
          claimant: 'GCLAIMANT',
        })
      ).rejects.toThrow();
    });

    test('rejects claiming by a non-claimant', async () => {
      const { balanceId } = await service.createClaimableBalance({
        sourceAccount: 'GSOURCE',
        asset: 'XLM',
        amount: '42',
        claimants: [{ destination: 'GCLAIMANT', predicate: null }],
      });

      await expect(
        service.claimClaimableBalance({
          balanceId,
          claimant: 'GSTRANGER',
        })
      ).rejects.toThrow();
    });
  });
});