/**
 * MockStellarServiceStub — Thin test stub for StellarServiceInterface
 *
 * RESPONSIBILITY: Provide a minimal, configurable stub for unit tests that
 *   need a StellarService without any real blockchain or complex state logic.
 *
 * USAGE:
 *   const stub = new MockStellarServiceStub();
 *   stub._setResponse('loadAccount', { id: 'G...', sequence: '1' });
 *   stub._setError('submitTransaction', new Error('network timeout'));
 *
 * All methods return configurable responses or throw configurable errors.
 * No internal state is maintained between calls unless explicitly set.
 *
 * For tests that need wallet state, balance tracking, or transaction history,
 * use the full MockStellarService instead.
 */

'use strict';

const crypto = require('crypto');
const StellarServiceInterface = require('./interfaces/StellarServiceInterface');

const _mockHash = () => `mock_hash_${crypto.randomBytes(8).toString('hex')}`;
const _mockTxId = () => `mock_tx_${crypto.randomBytes(8).toString('hex')}`;
const _mockLedger = () => Math.floor(Math.random() * 1_000_000) + 1;

class MockStellarServiceStub extends StellarServiceInterface {
  constructor(config = {}) {
    super();
    this._responses = {};
    this._errors = {};
    this._calls = {};
    this.network = config.network || 'testnet';
    this.horizonUrl = config.horizonUrl || 'https://horizon-testnet.stellar.org';
  }

  /** Configure a successful return value for a method. */
  _setResponse(method, value) {
    this._responses[method] = value;
    delete this._errors[method];
  }

  /** Configure a method to throw an error. */
  _setError(method, error) {
    this._errors[method] = error;
    delete this._responses[method];
  }

  /** Reset all configured responses and errors. */
  _reset() {
    this._responses = {};
    this._errors = {};
    this._calls = {};
  }

  /** Return call history for a method. */
  _getCalls(method) {
    return this._calls[method] || [];
  }

  async _dispatch(method, args) {
    this._calls[method] = this._calls[method] || [];
    this._calls[method].push(args);
    if (this._errors[method]) throw this._errors[method];
    if (method in this._responses) return this._responses[method];
    return this._defaults(method);
  }

  _defaults(method) {
    const txResult = { transactionId: _mockTxId(), hash: _mockHash(), ledger: _mockLedger() };
    const defaults = {
      loadAccount: { id: 'GABC', sequence: '100', balances: [{ asset_type: 'native', balance: '1000.0000000' }] },
      submitTransaction: txResult,
      buildPaymentTransaction: { envelope: 'mock_envelope', fee: '100' },
      getAccountSequence: '100',
      buildTransaction: { envelope: 'mock_envelope' },
      signTransaction: 'mock_signed_envelope',
      getAccountBalances: [{ asset_type: 'native', balance: '1000.0000000' }],
      getTransaction: { hash: _mockHash(), ledger: _mockLedger(), successful: true },
      submitSignedTransaction: txResult,
      buildAndSubmitFeeBumpTransaction: txResult,
      bumpSequence: { hash: _mockHash(), ledger: _mockLedger(), newSequence: '101' },
      isValidAddress: true,
      discoverBestPath: { path: [], sourceAmount: '1.0' },
      pathPayment: txResult,
      stroopsToXlm: '0.0000100',
      xlmToStroops: '100',
      getNetwork: this.network,
      getHorizonUrl: this.horizonUrl,
      estimateFee: { baseFee: 100, recommendedFee: 100 },
      setInflationDestination: { hash: _mockHash(), ledger: _mockLedger() },
      getInflationDestination: null,
      setAccountData: { hash: _mockHash(), ledger: _mockLedger() },
      deleteAccountData: { hash: _mockHash(), ledger: _mockLedger() },
      setOptions: { hash: _mockHash(), ledger: _mockLedger() },
      clawback: { hash: _mockHash(), ledger: _mockLedger() },
      addTrustline: { hash: _mockHash(), ledger: _mockLedger() },
      removeTrustline: { hash: _mockHash(), ledger: _mockLedger() },
      getTrustlines: [],
      pathPaymentStrictSend: txResult,
      pathPaymentStrictReceive: txResult,
      findPaymentPaths: [],
    };
    return defaults[method] !== undefined ? defaults[method] : null;
  }

  // ── StellarServiceInterface implementation ──────────────────────────────────

  async loadAccount(publicKey) { return this._dispatch('loadAccount', [publicKey]); }
  async submitTransaction(tx) { return this._dispatch('submitTransaction', [tx]); }
  async buildPaymentTransaction(src, dest, amount, opts) { return this._dispatch('buildPaymentTransaction', [src, dest, amount, opts]); }
  async getAccountSequence(pk) { return this._dispatch('getAccountSequence', [pk]); }
  async buildTransaction(src, ops, opts) { return this._dispatch('buildTransaction', [src, ops, opts]); }
  async signTransaction(tx, secret) { return this._dispatch('signTransaction', [tx, secret]); }
  async getAccountBalances(pk) { return this._dispatch('getAccountBalances', [pk]); }
  async getTransaction(hash) { return this._dispatch('getTransaction', [hash]); }
  async submitSignedTransaction(xdr) { return this._dispatch('submitSignedTransaction', [xdr]); }
  async buildAndSubmitFeeBumpTransaction(xdr, fee, secret) { return this._dispatch('buildAndSubmitFeeBumpTransaction', [xdr, fee, secret]); }
  async bumpSequence(secret, bumpTo) { return this._dispatch('bumpSequence', [secret, bumpTo]); }
  isValidAddress(addr) { this._calls.isValidAddress = (this._calls.isValidAddress || []); this._calls.isValidAddress.push([addr]); if (this._errors.isValidAddress) throw this._errors.isValidAddress; return 'isValidAddress' in this._responses ? this._responses.isValidAddress : true; }
  async discoverBestPath(params) { return this._dispatch('discoverBestPath', [params]); }
  async pathPayment(sA, sAmt, dA, dAmt, path, opts) { return this._dispatch('pathPayment', [sA, sAmt, dA, dAmt, path, opts]); }
  stroopsToXlm(s) { return 'stroopsToXlm' in this._responses ? this._responses.stroopsToXlm : String(Number(s) / 1e7); }
  xlmToStroops(x) { return 'xlmToStroops' in this._responses ? this._responses.xlmToStroops : String(Math.round(Number(x) * 1e7)); }
  getNetwork() { return this._responses.getNetwork || this.network; }
  getHorizonUrl() { return this._responses.getHorizonUrl || this.horizonUrl; }
  async estimateFee(n) { return this._dispatch('estimateFee', [n]); }
  async setInflationDestination(s, d) { return this._dispatch('setInflationDestination', [s, d]); }
  async getInflationDestination(pk) { return this._dispatch('getInflationDestination', [pk]); }
  async setAccountData(s, k, v) { return this._dispatch('setAccountData', [s, k, v]); }
  async deleteAccountData(s, k) { return this._dispatch('deleteAccountData', [s, k]); }
  async setOptions(s, opts) { return this._dispatch('setOptions', [s, opts]); }
  async clawback(issuer, from, code, amt) { return this._dispatch('clawback', [issuer, from, code, amt]); }
  async addTrustline(pk, asset) { return this._dispatch('addTrustline', [pk, asset]); }
  async removeTrustline(pk, asset) { return this._dispatch('removeTrustline', [pk, asset]); }
  async getTrustlines(pk) { return this._dispatch('getTrustlines', [pk]); }
  async pathPaymentStrictSend(s, sA, sAmt, d, dA, min, opts) { return this._dispatch('pathPaymentStrictSend', [s, sA, sAmt, d, dA, min, opts]); }
  async pathPaymentStrictReceive(s, sA, max, d, dA, dAmt, opts) { return this._dispatch('pathPaymentStrictReceive', [s, sA, max, d, dA, dAmt, opts]); }
  async findPaymentPaths(src, dest, dA, dAmt) { return this._dispatch('findPaymentPaths', [src, dest, dA, dAmt]); }
}

module.exports = MockStellarServiceStub;
