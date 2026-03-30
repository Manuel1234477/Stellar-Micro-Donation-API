'use strict';

/**
 * Tests: Account Data Entries (Extended)
 * Covers: create, read, delete, length validation, missing key errors
 */

const MockStellarService = require('../src/services/MockStellarService');

let stellar;
let publicKey;
let secretKey;

beforeEach(async () => {
  stellar = new MockStellarService({ strictValidation: true });
  const kp = await stellar.createWallet();
  publicKey = kp.publicKey;
  secretKey = kp.secretKey;
  await stellar.fundTestnetWallet(publicKey);
});

// ── setDataEntry ──────────────────────────────────────────────────────────────

describe('setDataEntry', () => {
  test('creates a data entry', async () => {
    const result = await stellar.setDataEntry(secretKey, 'kyc_status', 'verified');
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('ledger');
  });

  test('updates an existing data entry', async () => {
    await stellar.setDataEntry(secretKey, 'tier', 'bronze');
    await stellar.setDataEntry(secretKey, 'tier', 'gold');
    const entries = await stellar.getDataEntries(publicKey);
    expect(entries['tier']).toBe('gold');
  });

  test('rejects key longer than 64 bytes', async () => {
    const longKey = 'k'.repeat(65);
    await expect(stellar.setDataEntry(secretKey, longKey, 'value')).rejects.toThrow(/64 bytes/);
  });

  test('rejects value longer than 64 bytes', async () => {
    const longValue = 'v'.repeat(65);
    await expect(stellar.setDataEntry(secretKey, 'key', longValue)).rejects.toThrow(/64 bytes/);
  });

  test('accepts key exactly 64 bytes', async () => {
    const key64 = 'k'.repeat(64);
    await expect(stellar.setDataEntry(secretKey, key64, 'ok')).resolves.toHaveProperty('hash');
  });

  test('accepts value exactly 64 bytes', async () => {
    const val64 = 'v'.repeat(64);
    await expect(stellar.setDataEntry(secretKey, 'mykey', val64)).resolves.toHaveProperty('hash');
  });

  test('rejects invalid secret key', async () => {
    await expect(stellar.setDataEntry('INVALID', 'key', 'val')).rejects.toThrow();
  });
});

// ── getDataEntries ────────────────────────────────────────────────────────────

describe('getDataEntries', () => {
  test('returns empty object when no entries', async () => {
    const entries = await stellar.getDataEntries(publicKey);
    expect(entries).toEqual({});
  });

  test('returns all current data entries as key-value map', async () => {
    await stellar.setDataEntry(secretKey, 'kyc', 'passed');
    await stellar.setDataEntry(secretKey, 'tier', 'silver');
    const entries = await stellar.getDataEntries(publicKey);
    expect(entries).toEqual({ kyc: 'passed', tier: 'silver' });
  });

  test('throws 404 for non-existent account', async () => {
    const fakeKey = 'G' + 'A'.repeat(55);
    await expect(stellar.getDataEntries(fakeKey)).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── deleteDataEntry ───────────────────────────────────────────────────────────

describe('deleteDataEntry', () => {
  test('deletes an existing data entry', async () => {
    await stellar.setDataEntry(secretKey, 'flag', 'active');
    await stellar.deleteDataEntry(secretKey, 'flag');
    const entries = await stellar.getDataEntries(publicKey);
    expect(entries).not.toHaveProperty('flag');
  });

  test('returns 404 when deleting a non-existent key', async () => {
    await expect(
      stellar.deleteDataEntry(secretKey, 'nonexistent_key')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('does not affect other entries when deleting one', async () => {
    await stellar.setDataEntry(secretKey, 'a', '1');
    await stellar.setDataEntry(secretKey, 'b', '2');
    await stellar.deleteDataEntry(secretKey, 'a');
    const entries = await stellar.getDataEntries(publicKey);
    expect(entries).toEqual({ b: '2' });
  });
});

// ── MockStellarService state tracking ────────────────────────────────────────

describe('MockStellarService data entry state', () => {
  test('data entries are isolated per account', async () => {
    const kp2 = await stellar.createWallet();
    await stellar.fundTestnetWallet(kp2.publicKey);

    await stellar.setDataEntry(secretKey, 'shared_key', 'account1');
    await stellar.setDataEntry(kp2.secretKey, 'shared_key', 'account2');

    const entries1 = await stellar.getDataEntries(publicKey);
    const entries2 = await stellar.getDataEntries(kp2.publicKey);

    expect(entries1['shared_key']).toBe('account1');
    expect(entries2['shared_key']).toBe('account2');
  });

  test('multiple entries can be set and retrieved', async () => {
    const keys = ['compliance', 'kyc_level', 'region', 'tier'];
    for (const k of keys) {
      await stellar.setDataEntry(secretKey, k, `value_${k}`);
    }
    const entries = await stellar.getDataEntries(publicKey);
    for (const k of keys) {
      expect(entries[k]).toBe(`value_${k}`);
    }
  });
});
