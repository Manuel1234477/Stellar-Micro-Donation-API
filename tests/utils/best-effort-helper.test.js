'use strict';

/**
 * best-effort helper (#1946): failed best-effort operations are logged with
 * their call site and counted, and never propagate into the request path.
 */

jest.mock('../../src/utils/log', () => ({ warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() }));
jest.mock('../../src/utils/metrics', () => ({ recordBestEffortFailure: jest.fn() }));

const log = require('../../src/utils/log');
const { recordBestEffortFailure } = require('../../src/utils/metrics');
const { bestEffort, reportBestEffortFailure } = require('../../src/utils/bestEffort');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bestEffort()', () => {
  test('returns a handler that logs the failure with the call site and counts it', () => {
    const handler = bestEffort('routes/tiers.js:62', { walletId: 'w1' });
    handler(new Error('audit write failed'));

    expect(log.warn).toHaveBeenCalledWith(
      'BEST_EFFORT',
      'Best-effort operation failed',
      expect.objectContaining({ site: 'routes/tiers.js:62', error: 'audit write failed', walletId: 'w1' })
    );
    expect(recordBestEffortFailure).toHaveBeenCalledWith('routes/tiers.js:62');
  });

  test('handler returns undefined so it can sit in a .catch() chain', async () => {
    const result = await Promise.reject(new Error('boom')).catch(bestEffort('site'));
    expect(result).toBeUndefined();
  });

  test('never throws, even if logging itself throws', () => {
    log.warn.mockImplementationOnce(() => {
      throw new Error('logger down');
    });
    expect(() => reportBestEffortFailure('site', new Error('x'))).not.toThrow();
  });

  test('handles non-Error rejection values', () => {
    reportBestEffortFailure('site', 'plain string');
    expect(log.warn).toHaveBeenCalledWith(
      'BEST_EFFORT',
      'Best-effort operation failed',
      expect.objectContaining({ error: 'plain string' })
    );
  });
});
