'use strict';

/**
 * Tests for inflation destination handling in MockStellarService.
 *
 * Moved from tests/inflation-destination.test.js as part of the test
 * reorganisation (issue #1792).
 */

const MockStellarService = require('../../src/services/MockStellarService');

describe('MockStellarService - inflation destination', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  describe('setInflationDestination', () => {
    it('sets the inflation destination for a valid account', async () => {
      const source = await service.createAccount({});
      const destination = await service.createAccount({});

      const result = await service.setInflationDestination(
        source.publicKey,
        destination.publicKey
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('throws when the source account does not exist', async () => {
      const destination = await service.createAccount({});

      await expect(
        service.setInflationDestination('GUNKNOWN', destination.publicKey)
      ).rejects.toThrow();
    });

    it('throws when the destination account does not exist', async () => {
      const source = await service.createAccount({});

      await expect(
        service.setInflationDestination(source.publicKey, 'GUNKNOWN')
      ).rejects.toThrow();
    });

    it('throws when the source account is not funded', async () => {
      const source = await service.createAccount({});
      const destination = await service.createAccount({});

      // Drain the source account balance to simulate an unfunded account.
      const account = service.accounts.get(source.publicKey);
      if (account) {
        account.balance = '0';
      }

      await expect(
        service.setInflationDestination(source.publicKey, destination.publicKey)
      ).rejects.toThrow();
    });
  });

  describe('getInflationDestination', () => {
    it('returns the configured inflation destination', async () => {
      const source = await service.createAccount({});
      const destination = await service.createAccount({});

      await service.setInflationDestination(
        source.publicKey,
        destination.publicKey
      );

      const result = await service.getInflationDestination(source.publicKey);

      expect(result).toBeDefined();
      expect(result.destination).toBe(destination.publicKey);
    });

    it('returns null when no inflation destination is set', async () => {
      const source = await service.createAccount({});

      const result = await service.getInflationDestination(source.publicKey);

      expect(result).toBeDefined();
      expect(result.destination).toBeNull();
    });

    it('throws when the account does not exist', async () => {
      await expect(
        service.getInflationDestination('GUNKNOWN')
      ).rejects.toThrow();
    });
  });

  describe('clearInflationDestination', () => {
    it('clears a previously set inflation destination', async () => {
      const source = await service.createAccount({});
      const destination = await service.createAccount({});

      await service.setInflationDestination(
        source.publicKey,
        destination.publicKey
      );

      const cleared = await service.clearInflationDestination(source.publicKey);
      expect(cleared).toBeDefined();
      expect(cleared.success).toBe(true);

      const result = await service.getInflationDestination(source.publicKey);
      expect(result.destination).toBeNull();
    });

    it('throws when the account does not exist', async () => {
      await expect(
        service.clearInflationDestination('GUNKNOWN')
      ).rejects.toThrow();
    });
  });
});