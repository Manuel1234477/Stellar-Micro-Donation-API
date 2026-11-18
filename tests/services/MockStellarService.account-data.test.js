'use strict';

/**
 * Merged account-data-entries coverage.
 *
 * This suite consolidates the former root-level
 * `tests/account-data-entries-extended.test.js` together with the base
 * account-data-entries coverage, now living under `tests/services/`.
 */

const MockStellarService = require('../../src/services/MockStellarService');

describe('MockStellarService - account data entries', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  afterEach(() => {
    if (service && typeof service.reset === 'function') {
      service.reset();
    }
  });

  describe('getAccountDataEntries', () => {
    it('returns an empty array for an account with no data entries', async () => {
      const publicKey = await service.createAccount();

      const entries = await service.getAccountDataEntries(publicKey);

      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(0);
    });

    it('returns an empty array for an unknown account', async () => {
      const entries = await service.getAccountDataEntries(
        'GUNKNOWNACCOUNT0000000000000000000000000000000000000000'
      );

      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(0);
    });

    it('returns entries that were previously set', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'name', 'alice');
      await service.setAccountData(publicKey, 'email', 'alice@example.com');

      const entries = await service.getAccountDataEntries(publicKey);

      expect(entries).toHaveLength(2);

      const byName = entries.reduce((acc, entry) => {
        acc[entry.name] = entry;
        return acc;
      }, {});

      expect(byName.name).toBeDefined();
      expect(byName.name.value).toBe('alice');
      expect(byName.email).toBeDefined();
      expect(byName.email.value).toBe('alice@example.com');
    });

    it('returns entries with base64-encoded values', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'greeting', 'hello');

      const entries = await service.getAccountDataEntries(publicKey);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('greeting');
      expect(entries[0].value).toBe(
        Buffer.from('hello', 'utf8').toString('base64')
      );
    });
  });

  describe('setAccountData', () => {
    it('creates a new data entry', async () => {
      const publicKey = await service.createAccount();

      const result = await service.setAccountData(publicKey, 'key1', 'value1');

      expect(result).toBeDefined();

      const entries = await service.getAccountDataEntries(publicKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('key1');
    });

    it('overwrites an existing data entry with the same name', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'key1', 'first');
      await service.setAccountData(publicKey, 'key1', 'second');

      const entries = await service.getAccountDataEntries(publicKey);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('key1');
      expect(entries[0].value).toBe(
        Buffer.from('second', 'utf8').toString('base64')
      );
    });

    it('supports multiple distinct keys', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'a', '1');
      await service.setAccountData(publicKey, 'b', '2');
      await service.setAccountData(publicKey, 'c', '3');

      const entries = await service.getAccountDataEntries(publicKey);

      expect(entries).toHaveLength(3);
      const names = entries.map((entry) => entry.name).sort();
      expect(names).toEqual(['a', 'b', 'c']);
    });

    it('throws when the account does not exist', async () => {
      await expect(
        service.setAccountData(
          'GUNKNOWNACCOUNT0000000000000000000000000000000000000000',
          'key',
          'value'
        )
      ).rejects.toThrow();
    });

    it('throws when the key name is empty', async () => {
      const publicKey = await service.createAccount();

      await expect(
        service.setAccountData(publicKey, '', 'value')
      ).rejects.toThrow();
    });

    it('throws when the key name exceeds the maximum length', async () => {
      const publicKey = await service.createAccount();
      const longKey = 'k'.repeat(65);

      await expect(
        service.setAccountData(publicKey, longKey, 'value')
      ).rejects.toThrow();
    });

    it('throws when the value exceeds the maximum size', async () => {
      const publicKey = await service.createAccount();
      const largeValue = 'v'.repeat(65);

      await expect(
        service.setAccountData(publicKey, 'key', largeValue)
      ).rejects.toThrow();
    });
  });

  describe('deleteAccountData', () => {
    it('removes an existing data entry', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'key1', 'value1');
      await service.deleteAccountData(publicKey, 'key1');

      const entries = await service.getAccountDataEntries(publicKey);
      expect(entries).toHaveLength(0);
    });

    it('is a no-op when the entry does not exist', async () => {
      const publicKey = await service.createAccount();

      await expect(
        service.deleteAccountData(publicKey, 'missing')
      ).resolves.not.toThrow();

      const entries = await service.getAccountDataEntries(publicKey);
      expect(entries).toHaveLength(0);
    });

    it('only removes the targeted entry', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'keep', 'yes');
      await service.setAccountData(publicKey, 'remove', 'no');

      await service.deleteAccountData(publicKey, 'remove');

      const entries = await service.getAccountDataEntries(publicKey);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('keep');
    });

    it('throws when the account does not exist', async () => {
      await expect(
        service.deleteAccountData(
          'GUNKNOWNACCOUNT0000000000000000000000000000000000000000',
          'key'
        )
      ).rejects.toThrow();
    });
  });

  describe('account data isolation', () => {
    it('keeps data entries separate between accounts', async () => {
      const accountA = await service.createAccount();
      const accountB = await service.createAccount();

      await service.setAccountData(accountA, 'shared', 'from-a');
      await service.setAccountData(accountB, 'shared', 'from-b');

      const entriesA = await service.getAccountDataEntries(accountA);
      const entriesB = await service.getAccountDataEntries(accountB);

      expect(entriesA).toHaveLength(1);
      expect(entriesB).toHaveLength(1);
      expect(entriesA[0].value).toBe(
        Buffer.from('from-a', 'utf8').toString('base64')
      );
      expect(entriesB[0].value).toBe(
        Buffer.from('from-b', 'utf8').toString('base64')
      );
    });

    it('does not leak entries after an account is removed', async () => {
      const publicKey = await service.createAccount();

      await service.setAccountData(publicKey, 'key', 'value');

      if (typeof service.removeAccount === 'function') {
        await service.removeAccount(publicKey);
      }

      const entries = await service.getAccountDataEntries(publicKey);
      expect(entries).toHaveLength(0);
    });
  });
});