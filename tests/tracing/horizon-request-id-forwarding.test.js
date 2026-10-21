/**
 * Horizon Outbound Request-ID Forwarding — Test Suite
 *
 * PURPOSE
 * ───────
 * Verifies that the correlation ID generated for an inbound HTTP request is
 * forwarded to outbound Horizon calls via the X-Request-ID header, so that
 * a Horizon-side error can be traced back to the originating API request.
 */

'use strict';

const {
  createCorrelationContext,
  withCorrelationContext,
  generateCorrelationHeaders,
  parseCorrelationHeaders,
} = require('../../src/utils/correlation');

describe('Horizon outbound request-id forwarding', () => {
  it('generateCorrelationHeaders includes X-Request-ID matching the request context', () => {
    const context = createCorrelationContext({ requestId: 'req-abc-123' });

    withCorrelationContext(context, () => {
      const headers = generateCorrelationHeaders();
      expect(headers['X-Request-ID']).toBe('req-abc-123');
      expect(headers['X-Correlation-ID']).toBe(context.correlationId);
    });
  });

  it('does not emit X-Request-ID when no requestId is set on the context', () => {
    const context = createCorrelationContext({});

    withCorrelationContext(context, () => {
      const headers = generateCorrelationHeaders();
      expect(headers['X-Request-ID']).toBeUndefined();
    });
  });

  it('honours a client-supplied X-Correlation-ID header as the correlation id for the request', () => {
    const inbound = parseCorrelationHeaders({ 'x-correlation-id': 'client-supplied-corr-id' });
    const context = createCorrelationContext({
      requestId: 'req-xyz',
      correlationId: inbound.correlationId,
    });

    expect(context.correlationId).toBe('client-supplied-corr-id');

    withCorrelationContext(context, () => {
      const headers = generateCorrelationHeaders();
      expect(headers['X-Correlation-ID']).toBe('client-supplied-corr-id');
      expect(headers['X-Request-ID']).toBe('req-xyz');
    });
  });
});
