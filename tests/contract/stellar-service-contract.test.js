'use strict';

/**
 * Contract test for the Stellar service interface (issue #1709).
 *
 * Both the real StellarService and the MockStellarService must expose the
 * same flat public method set. This guards against the mock losing its flat
 * API after being split into sub-modules under src/services/mock/*.
 */

const MockStellarService = require('../../src/services/MockStellarService');
const StellarService = require('../../src/services/stellar/StellarService');

// Canonical flat public API that both implementations must expose.
const REQUIRED_METHODS = [
  'createAccount',
  'getAccount',
  'getBalance',
  'sendPayment',
  'pathPaymentStrictSend',
  'pathPaymentStrictReceive',
  'mergeAccount',
  'createOffer',
  'getOrderBook',
  'createClaimableBalance',
  'claimClaimableBalance',
  'getClaimableBalances',
  'invokeContract',
];

function collectMethodNames(instance) {
  const names = new Set();
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      if (typeof instance[name] === 'function') names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return names;
}

describe('Stellar service contract (#1709)', () => {
  let mock;
  let real;

  beforeAll(() => {
    mock = new MockStellarService();
    real = new StellarService();
  });

  it('MockStellarService exposes the canonical flat public API', () => {
    const methods = collectMethodNames(mock);
    for (const name of REQUIRED_METHODS) {
      expect(typeof mock[name]).toBe('function');
      expect(methods.has(name)).toBe(true);
    }
  });

  it('StellarService exposes the canonical flat public API', () => {
    const methods = collectMethodNames(real);
    for (const name of REQUIRED_METHODS) {
      expect(typeof real[name]).toBe('function');
      expect(methods.has(name)).toBe(true);
    }
  });

  it('mock and real services expose the same public method set', () => {
    const mockMethods = collectMethodNames(mock);
    const realMethods = collectMethodNames(real);

    const missingOnMock = [...realMethods].filter((m) => !mockMethods.has(m));
    const missingOnReal = [...mockMethods].filter((m) => !realMethods.has(m));

    expect(missingOnMock).toEqual([]);
    expect(missingOnReal).toEqual([]);
  });
});
