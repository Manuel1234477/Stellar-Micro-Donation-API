/**
 * ServiceAccountBalanceMonitor
 * Uses a mock Horizon client (via a stub stellarService.getBalance) to simulate
 * low-balance conditions without hitting a real Horizon instance.
 */

jest.mock('../../src/services/WebhookService', () => ({
  deliver: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/utils/timerRegistry', () => ({
  createInterval: jest.fn(() => ({ unref: jest.fn(), clear: jest.fn() })),
}));

const WebhookService = require('../../src/services/WebhookService');
const ServiceAccountBalanceMonitor = require('../../src/services/ServiceAccountBalanceMonitor');

function makeMockStellar(balance) {
  return { getBalance: jest.fn().mockResolvedValue({ balance: String(balance) }) };
}

function makeMockScheduler() {
  let paused = false;
  return {
    pause: jest.fn(() => { paused = true; }),
    resume: jest.fn(() => { paused = false; }),
    isPaused: jest.fn(() => paused),
  };
}

describe('ServiceAccountBalanceMonitor', () => {
  const accountId = 'GABC123';

  beforeEach(() => jest.clearAllMocks());

  it('does not alert when balance is above thresholds', async () => {
    const stellar = makeMockStellar(50);
    const monitor = new ServiceAccountBalanceMonitor(stellar, makeMockScheduler(), { accountId });

    const status = await monitor.checkBalance();

    expect(WebhookService.deliver).not.toHaveBeenCalled();
    expect(status.alertActive).toBe(false);
    expect(status.criticalActive).toBe(false);
    expect(status.balance).toBe(50);
  });

  it('fires an account.balance_low webhook below the alert threshold', async () => {
    const stellar = makeMockStellar(8);
    const monitor = new ServiceAccountBalanceMonitor(stellar, makeMockScheduler(), {
      accountId,
      alertThresholdXlm: 10,
      criticalThresholdXlm: 2,
    });

    const status = await monitor.checkBalance();

    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'account.balance_low',
      expect.objectContaining({ accountId, balance: 8, threshold: 10 })
    );
    expect(status.alertActive).toBe(true);
    expect(status.criticalActive).toBe(false);
  });

  it('pauses the scheduler at the critical threshold', async () => {
    const stellar = makeMockStellar(1);
    const scheduler = makeMockScheduler();
    const monitor = new ServiceAccountBalanceMonitor(stellar, scheduler, {
      accountId,
      alertThresholdXlm: 10,
      criticalThresholdXlm: 2,
    });

    const status = await monitor.checkBalance();

    expect(scheduler.pause).toHaveBeenCalledTimes(1);
    expect(status.criticalActive).toBe(true);
    expect(status.schedulerPausedByMonitor).toBe(true);
  });

  it('resumes the scheduler once the balance recovers above the critical threshold', async () => {
    const scheduler = makeMockScheduler();
    const monitor = new ServiceAccountBalanceMonitor(makeMockStellar(1), scheduler, {
      accountId,
      alertThresholdXlm: 10,
      criticalThresholdXlm: 2,
    });

    await monitor.checkBalance(); // critical -> paused
    expect(scheduler.pause).toHaveBeenCalledTimes(1);

    monitor._stellar = makeMockStellar(15); // simulate top-up
    const status = await monitor.checkBalance();

    expect(scheduler.resume).toHaveBeenCalledTimes(1);
    expect(status.criticalActive).toBe(false);
    expect(status.schedulerPausedByMonitor).toBe(false);
  });

  it('does not re-fire the webhook on consecutive checks while still below threshold', async () => {
    const stellar = makeMockStellar(5);
    const monitor = new ServiceAccountBalanceMonitor(stellar, makeMockScheduler(), {
      accountId,
      alertThresholdXlm: 10,
      criticalThresholdXlm: 2,
    });

    await monitor.checkBalance();
    await monitor.checkBalance();

    expect(WebhookService.deliver).toHaveBeenCalledTimes(1);
  });

  it('records an error and skips alerts when the Horizon call fails', async () => {
    const stellar = { getBalance: jest.fn().mockRejectedValue(new Error('Horizon unreachable')) };
    const monitor = new ServiceAccountBalanceMonitor(stellar, makeMockScheduler(), { accountId });

    const status = await monitor.checkBalance();

    expect(status.error).toMatch('Horizon unreachable');
    expect(WebhookService.deliver).not.toHaveBeenCalled();
  });
});
