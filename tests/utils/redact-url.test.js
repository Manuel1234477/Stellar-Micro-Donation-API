'use strict';

/**
 * URL redaction for logs (#1942): API keys in query strings must not reach logs.
 */

const { redactUrl, REDACTED } = require('../../src/utils/redactUrl');

describe('redactUrl (#1942)', () => {
  it('redacts apiKey query values and keeps other parameters', () => {
    expect(redactUrl('/ws/balances?apiKey=secret-123&wallet=GA1'))
      .toBe(`/ws/balances?apiKey=${REDACTED}&wallet=GA1`);
  });

  it('matches parameter names case-insensitively', () => {
    expect(redactUrl('/x?APIKEY=abc')).toBe(`/x?APIKEY=${REDACTED}`);
  });

  it('leaves URLs without a query string unchanged', () => {
    expect(redactUrl('/api/v1/donations')).toBe('/api/v1/donations');
  });

  it('leaves unrelated query parameters unchanged', () => {
    expect(redactUrl('/x?page=2&sort=asc')).toBe('/x?page=2&sort=asc');
  });

  it('returns non-string input unchanged', () => {
    expect(redactUrl(undefined)).toBeUndefined();
    expect(redactUrl(null)).toBeNull();
  });
});
