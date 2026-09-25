'use strict';

/**
 * Canonical Stellar service interface.
 *
 * Both the real `StellarService` (src/services/stellar) and the
 * `MockStellarService` (src/services/mock) must expose the same flat public
 * method set described here. The mock is the default in development and CI
 * (ADR-002), so any divergence between the two implementations causes routes
 * that work against one to crash against the other.
 *
 * This module is intentionally dependency-free: it only declares the contract
 * (method names + arity) so it can be used by implementations and by contract
 * tests without pulling in either service.
 */

/**
 * Flat public method names every Stellar service implementation must expose.
 * Keep this list in sync with the delegating methods on the service facades.
 */
const STELLAR_SERVICE_METHODS = Object.freeze([
  // Accounts
  'createAccount',
  'getAccount',
  'getAccountBalances',

  // Payments
  'sendPayment',
  'pathPaymentStrictSend',
  'pathPaymentStrictReceive',
  'mergeAccount',

  // Offers / DEX
  'createOffer',
  'getOrderBook',
  'cancelOffer',
  'getOffers',

  // Claimable balances
  'createClaimableBalance',
  'claimClaimableBalance',
  'getClaimableBalances',

  // Soroban contracts
  'invokeContract',

  // Transactions
  'getTransaction',
  'submitTransaction',
]);

/**
 * Assert that a service instance exposes the full flat public API.
 *
 * @param {object} service - a StellarService or MockStellarService instance
 * @param {string} [label] - optional label used in error messages
 * @returns {string[]} the list of missing method names (empty when conformant)
 */
function findMissingStellarServiceMethods(service, label = 'StellarService') {
  if (!service || typeof service !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }

  return STELLAR_SERVICE_METHODS.filter(
    (method) => typeof service[method] !== 'function'
  );
}

/**
 * Throw when a service instance does not implement the canonical interface.
 *
 * @param {object} service - a StellarService or MockStellarService instance
 * @param {string} [label] - optional label used in error messages
 * @returns {object} the validated service
 */
function assertStellarServiceInterface(service, label = 'StellarService') {
  const missing = findMissingStellarServiceMethods(service, label);

  if (missing.length > 0) {
    throw new Error(
      `${label} is missing required methods: ${missing.join(', ')}`
    );
  }

  return service;
}

module.exports = {
  STELLAR_SERVICE_METHODS,
  findMissingStellarServiceMethods,
  assertStellarServiceInterface,
};
