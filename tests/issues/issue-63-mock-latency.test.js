'use strict';

/**
 * Tests for issue #63: configurable simulated latency in MockStellarService
 */

const MockStellarService = require('../../src/services/MockStellarService');

describe('MockStellarService - configurable latency (#63)', () => {
  let service;

  beforeEach(() => {
    MockStellarService.resetLatency();
    service = new MockStellarService({ network: 'testnet' });
    // Seed a wallet so async methods can run
    service.wallets.set('GTEST', {
      publicKey: 'GTEST',
      secretKey: 'STEST',
      balance: '1000.0000000',
      assetBalances: { native: '1000.0000000' },
      sequence: 1,
    });
  });

  afterEach(() => {
    MockStellarService.resetLatency();
    delete process.env.MOCK_STELLAR_LATENCY_MS;
  });

  it('default latency is 0ms (no delay)', async () => {
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('setLatency(ms) adds fixed delay to async methods', async () => {
    MockStellarService.setLatency(100);
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  });

  it('setLatency(0) disables delay', async () => {
    MockStellarService.setLatency(0);
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('setLatencyRange(min, max) produces delay within range', async () => {
    MockStellarService.setLatencyRange(50, 150);
    const start = Date.now();
    await service._simulateNetworkDelay();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(300);
  });

  it('resetLatency() clears fixed latency', async () => {
    MockStellarService.setLatency(200);
    MockStellarService.resetLatency();
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('resetLatency() clears range latency', async () => {
    MockStellarService.setLatencyRange(100, 200);
    MockStellarService.resetLatency();
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('MOCK_STELLAR_LATENCY_MS env var sets latency', async () => {
    process.env.MOCK_STELLAR_LATENCY_MS = '80';
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeGreaterThanOrEqual(60);
  });

  it('static setLatency overrides env var', async () => {
    process.env.MOCK_STELLAR_LATENCY_MS = '500';
    MockStellarService.setLatency(0);
    const start = Date.now();
    await service._simulateNetworkDelay();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('latency uses await Promise/setTimeout (proper async)', async () => {
    MockStellarService.setLatency(50);
    const promise = service._simulateNetworkDelay();
    expect(promise).toBeInstanceOf(Promise);
    await promise;
  });
});
