'use strict';

/**
 * Tests for leader election utilities.
 *
 * Moved from tests/leaderElection.test.js as part of organising root-level
 * test files into feature folders (see issue #1792).
 */

const path = require('path');

const leaderElectionPath = path.resolve(__dirname, '../../src/utils/leaderElection');

let leaderElection;

beforeAll(() => {
  // Load lazily so a missing module produces a clear failure below rather
  // than an unhandled require error at collection time.
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    leaderElection = require(leaderElectionPath);
  } catch (err) {
    leaderElection = null;
  }
});

describe('leaderElection', () => {
  it('exposes the expected API', () => {
    expect(leaderElection).not.toBeNull();
    expect(leaderElection).toBeDefined();
  });

  it('provides a way to determine leadership', () => {
    expect(leaderElection).not.toBeNull();
    const hasLeadershipApi =
      typeof leaderElection.isLeader === 'function' ||
      typeof leaderElection.getLeader === 'function' ||
      typeof leaderElection.electLeader === 'function' ||
      typeof leaderElection.LeaderElection === 'function' ||
      typeof leaderElection.createLeaderElection === 'function';

    expect(hasLeadershipApi).toBe(true);
  });
});