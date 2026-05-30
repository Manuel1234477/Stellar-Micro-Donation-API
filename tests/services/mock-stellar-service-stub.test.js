/**
 * Tests for MockStellarServiceStub (#756)
 *
 * Verifies the thin stub implements the StellarServiceInterface contract
 * and supports configurable responses / error simulation.
 */

const MockStellarServiceStub = require('../../src/services/MockStellarServiceStub');
const StellarServiceInterface = require('../../src/services/interfaces/StellarServiceInterface');

describe('MockStellarServiceStub (#756)', () => {
  let stub;

  beforeEach(() => {
    stub = new MockStellarServiceStub();
  });

  it('extends StellarServiceInterface', () => {
    expect(stub).toBeInstanceOf(StellarServiceInterface);
  });

  it('is under 200 lines', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/services/MockStellarServiceStub.js'),
      'utf8'
    );
    const lines = src.split('\n').length;
    expect(lines).toBeLessThanOrEqual(200);
  });

  describe('default responses', () => {
    it('loadAccount returns a mock account', async () => {
      const result = await stub.loadAccount('GABC');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('sequence');
    });

    it('submitTransaction returns transactionId, hash, ledger', async () => {
      const result = await stub.submitTransaction({});
      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('ledger');
    });

    it('isValidAddress returns true by default', () => {
      expect(stub.isValidAddress('GABC')).toBe(true);
    });

    it('getNetwork returns testnet by default', () => {
      expect(stub.getNetwork()).toBe('testnet');
    });

    it('getTrustlines returns empty array by default', async () => {
      const result = await stub.getTrustlines('GABC');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('configurable responses', () => {
    it('_setResponse overrides default return value', async () => {
      stub._setResponse('loadAccount', { id: 'GCUSTOM', sequence: '999' });
      const result = await stub.loadAccount('GABC');
      expect(result.id).toBe('GCUSTOM');
      expect(result.sequence).toBe('999');
    });

    it('_setError makes method throw', async () => {
      stub._setError('submitTransaction', new Error('network timeout'));
      await expect(stub.submitTransaction({})).rejects.toThrow('network timeout');
    });

    it('_setError on isValidAddress makes it throw', () => {
      stub._setError('isValidAddress', new Error('invalid'));
      expect(() => stub.isValidAddress('bad')).toThrow('invalid');
    });

    it('_reset clears all configured responses and errors', async () => {
      stub._setResponse('loadAccount', { id: 'CUSTOM' });
      stub._reset();
      const result = await stub.loadAccount('GABC');
      expect(result.id).not.toBe('CUSTOM');
    });
  });

  describe('call tracking', () => {
    it('records calls to methods', async () => {
      await stub.loadAccount('GABC');
      await stub.loadAccount('GXYZ');
      expect(stub._getCalls('loadAccount')).toHaveLength(2);
      expect(stub._getCalls('loadAccount')[0]).toEqual(['GABC']);
    });

    it('returns empty array for uncalled methods', () => {
      expect(stub._getCalls('submitTransaction')).toEqual([]);
    });
  });

  describe('error simulation', () => {
    it('simulates insufficient balance error', async () => {
      stub._setError('submitTransaction', new Error('Insufficient balance'));
      await expect(stub.submitTransaction({})).rejects.toThrow('Insufficient balance');
    });

    it('simulates network timeout', async () => {
      stub._setError('loadAccount', new Error('Request timeout'));
      await expect(stub.loadAccount('GABC')).rejects.toThrow('Request timeout');
    });
  });

  describe('interface completeness', () => {
    const methods = [
      'loadAccount', 'submitTransaction', 'buildPaymentTransaction',
      'getAccountSequence', 'buildTransaction', 'signTransaction',
      'getAccountBalances', 'getTransaction', 'submitSignedTransaction',
      'buildAndSubmitFeeBumpTransaction', 'bumpSequence', 'isValidAddress',
      'discoverBestPath', 'pathPayment', 'stroopsToXlm', 'xlmToStroops',
      'getNetwork', 'getHorizonUrl', 'estimateFee', 'setInflationDestination',
      'getInflationDestination', 'setAccountData', 'deleteAccountData',
      'setOptions', 'clawback', 'addTrustline', 'removeTrustline',
      'getTrustlines', 'pathPaymentStrictSend', 'pathPaymentStrictReceive',
      'findPaymentPaths',
    ];

    for (const method of methods) {
      it(`implements ${method}()`, () => {
        expect(typeof stub[method]).toBe('function');
      });
    }
  });
});
