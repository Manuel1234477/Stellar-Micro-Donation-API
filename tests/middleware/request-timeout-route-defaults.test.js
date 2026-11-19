'use strict';

/**
 * Global request timeout defaults (#1948).
 *
 * Non-submission routes must fall back to the general 15 s budget, while
 * Stellar submission routes keep the 30 s donation budget.
 */

const {
  resolveRouteTimeout,
  SUBMISSION_PATH_RE,
  TIMEOUTS,
} = require('../../src/middleware/requestTimeout');

describe('TIMEOUTS presets', () => {
  it('general fallback is 15 s and donation submission is 30 s', () => {
    expect(TIMEOUTS.default).toBe(15_000);
    expect(TIMEOUTS.donation).toBe(30_000);
  });
});

describe('resolveRouteTimeout — submission routes keep the donation budget', () => {
  const submissionPaths = [
    '/api/v1/donations',
    '/api/v1/donations/send',
    '/api/v1/donations/batch',
    '/api/v1/donations/bulk',
    '/api/v1/donations/cross-asset',
    '/api/v1/donations/abc123/refund',
    '/api/v1/channels/open',
    '/api/v1/channels/7/update',
    '/api/v1/channels/7/close',
    '/api/v1/channels/7/settle',
    '/api/v1/channels/7/dispute',
    '/donations/send',
  ];

  it.each(submissionPaths)('POST %s uses 30 s', (path) => {
    expect(resolveRouteTimeout('POST', path)).toBe(TIMEOUTS.donation);
  });
});

describe('resolveRouteTimeout — everything else uses the general fallback', () => {
  const generalCases = [
    ['GET', '/api/v1/donations/send'],       // read of a submission path is not a submission
    ['GET', '/api/v1/donations'],
    ['GET', '/api/v1/donations/abc123'],
    ['POST', '/api/v1/donations/abc123/notes'],
    ['GET', '/api/v1/wallets'],
    ['GET', '/api/v1/stats'],
    ['POST', '/api/v1/wallets'],
    ['GET', '/api/v1/channels'],
    ['POST', '/api/v1/donations-export'],
  ];

  it.each(generalCases)('%s %s uses the general fallback', (method, path) => {
    expect(resolveRouteTimeout(method, path)).toBe(TIMEOUTS.default);
  });

  it('honours a configured general fallback', () => {
    expect(resolveRouteTimeout('GET', '/api/v1/wallets', 8_000)).toBe(8_000);
  });

  it('submission routes ignore the configured general fallback', () => {
    expect(resolveRouteTimeout('POST', '/api/v1/donations/send', 8_000)).toBe(TIMEOUTS.donation);
  });
});

describe('SUBMISSION_PATH_RE', () => {
  it('does not match arbitrary sub-paths of the donations resource', () => {
    expect(SUBMISSION_PATH_RE.test('/api/v1/donations/send/extra')).toBe(false);
  });
});
