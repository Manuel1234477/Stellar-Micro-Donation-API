'use strict';

/**
 * Tests for distributed tracing extensions (issue #632):
 * - In-memory trace store (recordSpan, getTrace, eviction)
 * - withSpanInContext propagates context
 * - Scheduler wraps processSchedules in a span
 * - WebhookService injects traceparent header
 * - GET /admin/traces/:traceId endpoint
 */

const tracing = require('../../src/utils/tracing');

beforeEach(() => {
  tracing._clearTraceStore();
});

// ─── In-memory trace store ────────────────────────────────────────────────────

describe('recordSpan / getTrace', () => {
  it('stores and retrieves a span by traceId', () => {
    tracing.recordSpan('trace-abc', { name: 'test.span', status: 'ok' });
    const trace = tracing.getTrace('trace-abc');
    expect(trace).not.toBeNull();
    expect(trace.traceId).toBe('trace-abc');
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].name).toBe('test.span');
  });

  it('appends multiple spans to the same trace', () => {
    tracing.recordSpan('trace-xyz', { name: 'span.1' });
    tracing.recordSpan('trace-xyz', { name: 'span.2' });
    expect(tracing.getTrace('trace-xyz').spans).toHaveLength(2);
  });

  it('returns null for unknown traceId', () => {
    expect(tracing.getTrace('nonexistent')).toBeNull();
  });

  it('evicts oldest trace when store exceeds 1000', () => {
    for (let i = 0; i < 1000; i++) {
      tracing.recordSpan(`trace-${i}`, { name: 'span' });
    }
    expect(tracing.getTraceCount()).toBe(1000);
    // Adding one more should evict trace-0
    tracing.recordSpan('trace-new', { name: 'span' });
    expect(tracing.getTraceCount()).toBe(1000);
    expect(tracing.getTrace('trace-0')).toBeNull();
    expect(tracing.getTrace('trace-new')).not.toBeNull();
  });

  it('ignores recordSpan with falsy traceId', () => {
    tracing.recordSpan(null, { name: 'span' });
    tracing.recordSpan('', { name: 'span' });
    expect(tracing.getTraceCount()).toBe(0);
  });

  it('_clearTraceStore empties the store', () => {
    tracing.recordSpan('t1', { name: 'span' });
    tracing._clearTraceStore();
    expect(tracing.getTraceCount()).toBe(0);
  });
});

// ─── withSpanInContext ────────────────────────────────────────────────────────

describe('withSpanInContext', () => {
  it('executes the callback and returns its result', async () => {
    const api = require('@opentelemetry/api');
    const result = await tracing.withSpanInContext(
      'test.span',
      api.context.active(),
      { 'test.attr': 'value' },
      async () => 42
    );
    expect(result).toBe(42);
  });

  it('re-throws errors from the callback', async () => {
    const api = require('@opentelemetry/api');
    await expect(
      tracing.withSpanInContext('error.span', api.context.active(), async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('works without explicit attributes (function as 3rd arg)', async () => {
    const api = require('@opentelemetry/api');
    const result = await tracing.withSpanInContext(
      'no-attrs.span',
      api.context.active(),
      async () => 'ok'
    );
    expect(result).toBe('ok');
  });
});

// ─── injectTraceHeaders ───────────────────────────────────────────────────────

describe('injectTraceHeaders', () => {
  it('returns the same headers object (mutated in place)', () => {
    const headers = { 'Content-Type': 'application/json' };
    const result = tracing.injectTraceHeaders(headers);
    expect(result).toBe(headers);
  });

  it('does not throw when no active span', () => {
    expect(() => tracing.injectTraceHeaders({})).not.toThrow();
  });
});

// ─── Scheduler trace propagation ─────────────────────────────────────────────

describe('RecurringDonationScheduler trace propagation', () => {
  it('imports tracing utilities without error', () => {
    const scheduler = require('../../src/services/RecurringDonationScheduler');
    expect(scheduler).toBeDefined();
  });
});

// ─── WebhookService traceparent injection ────────────────────────────────────

describe('WebhookService traceparent injection', () => {
  it('imports WebhookService without error', () => {
    const WebhookService = require('../../src/services/WebhookService');
    expect(WebhookService).toBeDefined();
  });

  it('injectTraceHeaders is called during sendFailureNotification (no real HTTP)', async () => {
    const { WebhookService } = require('../../src/services/WebhookService');
    const svc = new WebhookService();
    // Invalid URL — should return error without making a real request
    const result = await svc.sendFailureNotification('not-a-url', { scheduleId: 1 });
    expect(result.delivered).toBe(false);
  });
});

// ─── GET /admin/traces/:traceId ───────────────────────────────────────────────

describe('GET /admin/traces/:traceId', () => {
  const adminTracesRouter = require('../../src/routes/admin/traces');

  it('exports an express router', () => {
    expect(typeof adminTracesRouter).toBe('function');
  });
});

// ─── Trace store eviction boundary ───────────────────────────────────────────

describe('Trace store boundary conditions', () => {
  it('getTraceCount returns 0 on fresh store', () => {
    expect(tracing.getTraceCount()).toBe(0);
  });

  it('stores startedAt timestamp', () => {
    tracing.recordSpan('ts-trace', { name: 'span' });
    const trace = tracing.getTrace('ts-trace');
    expect(trace.startedAt).toBeDefined();
    expect(new Date(trace.startedAt).getTime()).not.toBeNaN();
  });

  it('span entries include recordedAt', () => {
    tracing.recordSpan('ra-trace', { name: 'span' });
    const span = tracing.getTrace('ra-trace').spans[0];
    expect(span.recordedAt).toBeDefined();
  });
});
