'use strict';

/**
 * acquireLease() behaviour against a scheduler_locks table (issue #1862).
 *
 * The database is replaced with a small in-memory lock table that applies the
 * same upsert rules as the real query: insert when absent, take over when the
 * existing lease has expired or is already ours, and leave a live foreign lease
 * untouched.
 */

const LOCK_NAME = 'recurring_donation_scheduler';

const mockLocks = new Map();

jest.mock('../../src/utils/database', () => ({
  run: jest.fn(async (sql, params) => {
    const [name, holder, acquiredAt, expiresAt, now] = params;
    const row = mockLocks.get(name);
    if (!row) {
      mockLocks.set(name, { name, holder_id: holder, acquired_at: acquiredAt, expires_at: expiresAt });
      return {};
    }
    if (row.expires_at < now || row.holder_id === holder) {
      mockLocks.set(name, { name, holder_id: holder, acquired_at: acquiredAt, expires_at: expiresAt });
    }
    return {};
  }),
  get: jest.fn(async (sql, params) => {
    const row = mockLocks.get(params[0]);
    return row ? { holder_id: row.holder_id } : undefined;
  }),
}));

jest.mock('../../src/utils/metrics', () => ({
  recordSchedulerLockAcquisition: jest.fn(),
  recordSchedulerLockRelease: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { LeaderElection } = require('../../src/utils/leaderElection');
const metrics = require('../../src/utils/metrics');
const log = require('../../src/utils/log');

const TTL_MS = 60_000;

beforeEach(() => {
  mockLocks.clear();
  jest.clearAllMocks();
});

describe('LeaderElection.acquireLease', () => {
  it('returns true for a single instance against a fresh lock table', async () => {
    const election = new LeaderElection({ instanceId: 'node-a' });

    await expect(election.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(true);
    expect(metrics.recordSchedulerLockAcquisition).toHaveBeenCalledWith('acquired');
  });

  it('returns false for a second instance while the first lease is live', async () => {
    const leader = new LeaderElection({ instanceId: 'node-a' });
    const standby = new LeaderElection({ instanceId: 'node-b' });

    await expect(leader.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(true);
    await expect(standby.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(false);
    expect(metrics.recordSchedulerLockAcquisition).toHaveBeenCalledWith('contested');
    expect(log.info).toHaveBeenCalledWith(
      'LEADER_ELECTION',
      expect.any(String),
      expect.objectContaining({ holder: 'node-a', ourId: 'node-b' })
    );
  });

  it('takes over a lease whose TTL has expired', async () => {
    const leader = new LeaderElection({ instanceId: 'node-a' });
    const successor = new LeaderElection({ instanceId: 'node-b' });

    await leader.acquireLease(LOCK_NAME, TTL_MS);
    // Force the stored lease into the past so it counts as expired.
    mockLocks.get(LOCK_NAME).expires_at = Date.now() - 1;

    await expect(successor.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(true);
    expect(mockLocks.get(LOCK_NAME).holder_id).toBe('node-b');
  });

  it('renews its own lease on repeat calls', async () => {
    const election = new LeaderElection({ instanceId: 'node-a' });

    await expect(election.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(true);
    await expect(election.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(true);
  });

  it('keeps the lease result when metric recording throws', async () => {
    metrics.recordSchedulerLockAcquisition.mockImplementation(() => {
      throw new Error('metrics backend down');
    });
    const election = new LeaderElection({ instanceId: 'node-a' });

    await expect(election.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      'LEADER_ELECTION',
      'Failed to record scheduler lock metric',
      expect.objectContaining({ error: 'metrics backend down' })
    );
  });

  it('returns false for a standby even when metric recording throws', async () => {
    const leader = new LeaderElection({ instanceId: 'node-a' });
    const standby = new LeaderElection({ instanceId: 'node-b' });
    await leader.acquireLease(LOCK_NAME, TTL_MS);

    metrics.recordSchedulerLockAcquisition.mockImplementation(() => {
      throw new Error('metrics backend down');
    });

    await expect(standby.acquireLease(LOCK_NAME, TTL_MS)).resolves.toBe(false);
  });
});
