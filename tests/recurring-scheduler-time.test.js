const RecurringDonationScheduler = require('../src/services/RecurringDonationScheduler');

jest.mock('../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/utils/correlation', () => ({
  withBackgroundContext: (_task, fn) => fn(),
  withAsyncContext: (_task, fn) => fn(),
  getCorrelationSummary: () => ({
    correlationId: 'corr-test',
    traceId: 'trace-test',
  }),
}));

describe('RecurringDonationScheduler - Time Based Behavior', () => {
  let scheduler;
  const sampleSchedule = {
    id: 42,
    donorId: 1,
    recipientId: 2,
    amount: '10.50',
    frequency: 'daily',
    donorPublicKey: 'GDONOR',
    recipientPublicKey: 'GRECIPIENT',
    lastExecutionDate: null,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-26T10:00:00.000Z'));

    scheduler = new RecurringDonationScheduler({
      sendPayment: jest.fn(),
    });
  });

  afterEach(() => {
    scheduler.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('runs immediately on start and then on each interval tick', () => {
    scheduler.processSchedules = jest.fn();
    scheduler.checkInterval = 60_000;

    scheduler.start();
    expect(scheduler.processSchedules).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(180_000);
    expect(scheduler.processSchedules).toHaveBeenCalledTimes(4);

    scheduler.stop();
    jest.advanceTimersByTime(60_000);
    expect(scheduler.processSchedules).toHaveBeenCalledTimes(4);
  });

  test('retries with controlled delay sequence before succeeding', async () => {
    scheduler.executeSchedule = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary-1'))
      .mockRejectedValueOnce(new Error('temporary-2'))
      .mockResolvedValueOnce();
    scheduler.calculateBackoff = jest
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000);
    scheduler.sleep = jest.fn().mockResolvedValue();

    await scheduler.executeScheduleWithRetry(sampleSchedule);

    expect(scheduler.executeSchedule).toHaveBeenCalledTimes(3);
    expect(scheduler.calculateBackoff).toHaveBeenNthCalledWith(1, 1);
    expect(scheduler.calculateBackoff).toHaveBeenNthCalledWith(2, 2);
    expect(scheduler.sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(scheduler.sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  test('sleep resolves only after mocked time has advanced', async () => {
    let done = false;
    scheduler.sleep(5_000).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);

    jest.advanceTimersByTime(4_999);
    await Promise.resolve();
    expect(done).toBe(false);

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  test('recent execution window is deterministic at the 5-minute boundary', async () => {
    const almostFiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000 - 1)).toISOString();
    const overFiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000 + 1)).toISOString();

    const isRecent = await scheduler.wasRecentlyExecuted({
      ...sampleSchedule,
      lastExecutionDate: almostFiveMinutesAgo,
    });
    const isNotRecent = await scheduler.wasRecentlyExecuted({
      ...sampleSchedule,
      lastExecutionDate: overFiveMinutesAgo,
    });

    expect(isRecent).toBe(true);
    expect(isNotRecent).toBe(false);
  });
});
