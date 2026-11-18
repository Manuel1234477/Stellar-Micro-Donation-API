'use strict';

/**
 * Tests for leaderboard cache observability and freshness reporting (issue #1206).
 */

const StatsService = require('../src/services/LeaderboardStatsService');
const Transaction = require('../src/models/transaction');
const Cache = require('../src/utils/cache');
const { registry } = require('../src/utils/metrics');

const createTransaction = (data) => Transaction.create({
  id: data.id || `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  amount: 'amount' in data ? data.amount : 100,
  donor: 'donor' in data ? data.donor : 'GDONOR',
  recipient: 'recipient' in data ? data.recipient : 'GRECIPIENT',
  status: data.status || 'confirmed',
  timestamp: data.timestamp || new Date().toISOString(),
  memo: '',
  tags: [],
});

const clearState = () => {
  Transaction._clearAllData();
  StatsService.invalidateLeaderboardCache();
  Cache.clear();
};

async function getCounterValue(name, labels) {
  const metrics = await registry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === name);
  if (!metric) return 0;
  const match = metric.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val)
  );
  return match?.value || 0;
}

describe('Leaderboard cache metrics + freshness', () => {
  beforeEach(clearState);
  afterEach(clearState);

  test('a cache miss followed by a hit increments the right counters', async () => {
    createTransaction({ donor: 'GA', amount: 100 });

    const missesBefore = await getCounterValue('leaderboard_cache_lookups_total', { result: 'miss' });
    const hitsBefore = await getCounterValue('leaderboard_cache_lookups_total', { result: 'hit' });

    StatsService.getDonorLeaderboard('all', 10); // miss — computes and caches
    StatsService.getDonorLeaderboard('all', 10); // hit — served from cache

    const missesAfter = await getCounterValue('leaderboard_cache_lookups_total', { result: 'miss' });
    const hitsAfter = await getCounterValue('leaderboard_cache_lookups_total', { result: 'hit' });

    expect(missesAfter).toBe(missesBefore + 1);
    expect(hitsAfter).toBe(hitsBefore + 1);
  });

  test('compute duration histogram records a sample on cache miss', async () => {
    createTransaction({ donor: 'GA', amount: 100 });
    StatsService.getDonorLeaderboard('all', 10);

    const metrics = await registry.getMetricsAsJSON();
    const histogram = metrics.find((m) => m.name === 'leaderboard_compute_duration_seconds');
    const countSample = histogram.values.find((v) => v.metricName.endsWith('_count'));
    expect(countSample.value).toBeGreaterThan(0);
  });

  test('result carries a cachedAt timestamp that survives a cache hit', () => {
    createTransaction({ donor: 'GA', amount: 100 });

    const first = StatsService.getDonorLeaderboard('all', 10);
    expect(first.cachedAt).toBeDefined();
    expect(new Date(first.cachedAt).getTime()).not.toBeNaN();

    const second = StatsService.getDonorLeaderboard('all', 10);
    expect(second.cachedAt).toBe(first.cachedAt); // same computed-at, served from cache
  });

  test('cachedAt does not appear in JSON output (non-enumerable, backward compatible)', () => {
    createTransaction({ donor: 'GA', amount: 100 });
    const leaderboard = StatsService.getDonorLeaderboard('all', 10);

    expect(JSON.parse(JSON.stringify(leaderboard))).toEqual(leaderboard.map((e) => ({ ...e })));
  });

  test('exposes the cache TTL constant for consumers', () => {
    expect(StatsService.LEADERBOARD_CACHE_TTL_MS).toBe(60_000);
  });

  test('recipient leaderboard also records cachedAt and metrics', async () => {
    createTransaction({ recipient: 'GR', amount: 50 });

    const missesBefore = await getCounterValue('leaderboard_cache_lookups_total', { result: 'miss' });
    const leaderboard = StatsService.getRecipientLeaderboard('all', 10);
    const missesAfter = await getCounterValue('leaderboard_cache_lookups_total', { result: 'miss' });

    expect(leaderboard.cachedAt).toBeDefined();
    expect(missesAfter).toBe(missesBefore + 1);
  });
});
