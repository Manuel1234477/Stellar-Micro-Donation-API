'use strict';

/**
 * Tests for recurring_donations_skipped_total metric (#906)
 *
 * Covers:
 *  - counter increments with reason "in_progress" when a schedule is already executing
 *  - counter does NOT increment when all due schedules are new
 *  - counter increments per-skipped (not a single bump per tick)
 */

jest.mock('../../src/utils/database');
jest.mock('../../src/services/WebhookService');
jest.mock('../../src/services/ApiKeyExpirationNotifier');
jest.mock('../../src/models/apiKeys', () => ({ revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0) }));
jest.mock('../../src/services/RetentionService', () => ({ runAll: jest.fn().mockResolvedValue() }), { virtual: true });
jest.mock('../../src/graphql/pubsub', () => ({
  publish: jest.fn(),
  TOPICS: { RECURRING_DONATION_EXECUTED: 'test' },
}));

const Database = require('../../src/utils/database');

// Access the metrics registry directly so we can read counter values
let metrics;
// RecurringDonationScheduler is re-required per test (after jest.resetModules) so that
// the scheduler instance uses the same metrics module instance the tests will inspect.
let RecurringDonationScheduler;

const MOCK_SCHEDULE = {
  id: 1,
  donorId: 1,
  recipientId: 2,
  amount: '10',
  frequency: 'daily',
  nextExecutionDate: new Date(Date.now() - 1000).toISOString(),
  executionCount: 0,
  lastExecutionDate: null,
  maxExecutions: null,
  customIntervalDays: null,
  webhookUrl: null,
  failureCount: 0,
  donorPublicKey: 'GABC',
  recipientPublicKey: 'GXYZ',
};

function buildScheduler() {
  const stellarService = { sendPayment: jest.fn().mockResolvedValue({ hash: 'testhash' }) };
  return new RecurringDonationScheduler(stellarService);
}

function setupDbMocks(dueSchedules = [MOCK_SCHEDULE]) {
  Database.query.mockImplementation((sql) => {
    if (sql.includes('recurring_donations rd')) return Promise.resolve(dueSchedules);
    if (sql.includes('recurring_donation_logs')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  Database.get.mockImplementation((sql) => {
    if (sql.includes('COUNT(*)')) return Promise.resolve({ count: 0 });
    if (sql.includes('SELECT id FROM transactions')) return Promise.resolve(null);
    if (sql.includes('SELECT status FROM recurring_donations')) return Promise.resolve({ status: 'active' });
    return Promise.resolve(null);
  });
  Database.run.mockResolvedValue({ id: 1 });
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Re-require metrics AND the scheduler after reset so both use the same module
  // instance — the scheduler must increment the exact counter object the tests inspect.
  metrics = require('../../src/utils/metrics');
  ({ RecurringDonationScheduler } = require('../../src/services/RecurringDonationScheduler'));
});

describe('#906 recurring_donations_skipped_total metric', () => {
  test('counter increments with reason "in_progress" when schedule is already executing', async () => {
    setupDbMocks([MOCK_SCHEDULE]);

    const scheduler = buildScheduler();

    // Pre-mark schedule 1 as in-progress
    scheduler.executingSchedules.add(MOCK_SCHEDULE.id);
    scheduler.isRunning = true;

    await scheduler.processSchedules();

    // Read counter value for label "in_progress"
    const counterData = await metrics.recurringDonationsSkippedTotal.get();
    const inProgressValue = counterData.values.find(
      v => v.labels && v.labels.reason === 'in_progress'
    );
    expect(inProgressValue).toBeDefined();
    expect(inProgressValue.value).toBeGreaterThanOrEqual(1);
  });

  test('counter does NOT increment when no schedules are skipped', async () => {
    setupDbMocks([]);

    const scheduler = buildScheduler();
    scheduler.isRunning = true;

    const before = await metrics.recurringDonationsSkippedTotal.get();
    const beforeVal = (before.values.find(v => v.labels?.reason === 'in_progress') || {}).value || 0;

    await scheduler.processSchedules();

    const after = await metrics.recurringDonationsSkippedTotal.get();
    const afterVal = (after.values.find(v => v.labels?.reason === 'in_progress') || {}).value || 0;

    expect(afterVal).toBe(beforeVal);
  });

  test('counter increments by the number of skipped schedules (not 1)', async () => {
    const schedules = [
      { ...MOCK_SCHEDULE, id: 10 },
      { ...MOCK_SCHEDULE, id: 11 },
      { ...MOCK_SCHEDULE, id: 12 },
    ];
    setupDbMocks(schedules);

    const scheduler = buildScheduler();
    // Mark 2 of 3 as in-progress
    scheduler.executingSchedules.add(10);
    scheduler.executingSchedules.add(11);
    scheduler.isRunning = true;

    const before = await metrics.recurringDonationsSkippedTotal.get();
    const beforeVal = (before.values.find(v => v.labels?.reason === 'in_progress') || {}).value || 0;

    await scheduler.processSchedules();

    const after = await metrics.recurringDonationsSkippedTotal.get();
    const afterVal = (after.values.find(v => v.labels?.reason === 'in_progress') || {}).value || 0;

    expect(afterVal - beforeVal).toBe(2);
  });
});
