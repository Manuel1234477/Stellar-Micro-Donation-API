/**
 * Tests: Distributed Tracing with OpenTelemetry
 *
 * Covers:
 *  - initTracing / shutdownTracing lifecycle
 *  - withSpan: success, error, nested spans
 *  - startSpan: manual span management
 *  - httpTracingMiddleware: root span attributes, traceparent header, status codes
 *  - traceDbQuery: child span attributes
 *  - traceStellarCall: child span attributes
 *  - injectTraceHeaders / extractTraceContext propagation
 *  - getCurrentTraceparent / getActiveSpanContext
 *  - Edge cases: disabled tracing, missing SDK, invalid contexts
 *
 * Uses a hand-rolled in-memory TracerProvider so no SDK packages beyond
 * @opentelemetry/api are required.
 */

'use strict';

const api = require('@opentelemetry/api');

// ─── In-memory span recorder ──────────────────────────────────────────────────
// We build a minimal TracerProvider that records finished spans in an array.
// This avoids any dependency on @opentelemetry/sdk-trace-base.

const finishedSpans = [];

function resetSpans() {
  finishedSpans.length = 0;
}

function getFinishedSpans() {
  return [...finishedSpans];
}

function _randomHex(len) {
  let s = '';
  while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, len);
}

/** Minimal span implementation — compatible with @opentelemetry/api context propagation */
class RecordingSpan {
  constructor(name, options, parentSpanId, traceId) {
    this.name = name;
    this.kind = options.kind !== undefined ? options.kind : api.SpanKind.INTERNAL;
    this.attributes = { ...(options.attributes || {}) };
    this.events = [];
    this.status = { code: api.SpanStatusCode.UNSET };
    this.endTime = null;
    this._traceId = traceId || _randomHex(32);
    this._spanId = _randomHex(16);
    this.parentSpanId = parentSpanId || undefined;
    // Pre-build the SpanContext so the same object is returned every time
    // (required for api.trace.setSpan / getActiveSpan to work correctly)
    this._spanContext = {
      traceId: this._traceId,
      spanId: this._spanId,
      traceFlags: api.TraceFlags.SAMPLED,
      isRemote: false,
    };
  }

  setAttribute(key, value) { this.attributes[key] = value; return this; }
  setAttributes(attrs) { Object.assign(this.attributes, attrs); return this; }
  addEvent(name, attrs) { this.events.push({ name, attributes: attrs || {} }); return this; }
  setStatus(status) { this.status = status; return this; }
  recordException(err) {
    this.addEvent('exception', {
      'exception.message': err && err.message ? err.message : String(err),
      'exception.type': err && err.name ? err.name : 'Error',
    });
  }
  end() {
    this.endTime = Date.now();
    finishedSpans.push(this);
  }
  spanContext() { return this._spanContext; }
  isRecording() { return this.endTime === null; }
}

/** Minimal tracer */
class RecordingTracer {
  startSpan(name, options = {}, context) {
    // Prefer the explicitly passed context, then fall back to the active context
    const resolvedCtx = context !== undefined ? context : api.context.active();
    const parentSpan = api.trace.getSpan(resolvedCtx);
    const parentCtx = parentSpan ? parentSpan.spanContext() : null;
    // Only inherit traceId from a valid (non-remote-invalid) parent
    const traceId = (parentCtx && parentCtx.traceId && parentCtx.traceId !== '0'.repeat(32))
      ? parentCtx.traceId
      : _randomHex(32);
    const parentSpanId = parentCtx ? parentCtx.spanId : undefined;
    return new RecordingSpan(name, options, parentSpanId, traceId);
  }

  startActiveSpan(name, options, context, fn) {
    // Normalise overloaded signatures: (name, fn) | (name, opts, fn) | (name, opts, ctx, fn)
    if (typeof options === 'function') { fn = options; options = {}; context = undefined; }
    else if (typeof context === 'function') { fn = context; context = undefined; }

    const parentContext = context !== undefined ? context : api.context.active();
    const span = this.startSpan(name, options, parentContext);
    const ctx = api.trace.setSpan(parentContext, span);
    return api.context.with(ctx, fn, undefined, span);
  }
}

/** Minimal provider */
class RecordingTracerProvider {
  getTracer() { return new RecordingTracer(); }
}

// ─── Minimal AsyncLocalStorage context manager ───────────────────────────────
// The OTel API falls back to NoopContextManager when no SDK is installed,
// which means api.context.with() doesn't propagate context. We register a
// real AsyncLocalStorage-based manager so spans are properly nested.

const { AsyncLocalStorage } = require('async_hooks');
const { ROOT_CONTEXT } = api;

class AsyncContextManager {
  constructor() {
    this._storage = new AsyncLocalStorage();
  }
  active() {
    return this._storage.getStore() || ROOT_CONTEXT;
  }
  with(context, fn, thisArg, ...args) {
    return this._storage.run(context, fn.bind(thisArg), ...args);
  }
  bind(context, fn) {
    const self = this;
    return function (...args) {
      return self._storage.run(context, fn, this, ...args);
    };
  }
  enable() { return this; }
  disable() { this._storage.disable(); return this; }
}

// Register once — subsequent calls are silently ignored by registerGlobal
api.context.setGlobalContextManager(new AsyncContextManager());

// Also register the W3C propagator so traceparent injection/extraction works.
class MinimalW3CPropagator {
  inject(context, carrier) {
    const span = api.trace.getSpan(context);
    if (!span) return;
    const sc = span.spanContext();
    if (!api.isSpanContextValid(sc)) return;
    const flags = (sc.traceFlags || 0).toString(16).padStart(2, '0');
    carrier['traceparent'] = `00-${sc.traceId}-${sc.spanId}-${flags}`;
  }
  extract(context, carrier) {
    const header = carrier['traceparent'] || carrier['Traceparent'];
    if (!header) return context;
    const parts = header.split('-');
    if (parts.length < 4 || parts[0] !== '00') return context;
    const [, traceId, spanId, flagsHex] = parts;
    if (!traceId || !spanId) return context;
    const traceFlags = parseInt(flagsHex, 16) || 0;
    const spanContext = { traceId, spanId, traceFlags, isRemote: true };
    const remoteSpan = api.trace.wrapSpanContext(spanContext);
    return api.trace.setSpan(context, remoteSpan);
  }
  fields() { return ['traceparent', 'tracestate']; }
}
api.propagation.setGlobalPropagator(new MinimalW3CPropagator());

// ─── Module under test ────────────────────────────────────────────────────────
jest.resetModules();
const tracing = require('../src/utils/tracing');

// Inject our recording tracer so withSpan / startSpan use it directly
// This avoids relying on the global provider registration which is one-time-only.
const recordingTracer = new RecordingTracer();
tracing._setTracerForTesting(recordingTracer);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReqRes(overrides = {}) {
  const req = {
    method: 'GET',
    path: '/donations',
    originalUrl: '/donations?page=1',
    hostname: 'localhost',
    protocol: 'http',
    ip: '127.0.0.1',
    id: 'req-abc',
    headers: {},
    ...overrides,
  };
  const resHeaders = {};
  const res = {
    statusCode: 200,
    setHeader: (k, v) => { resHeaders[k] = v; },
    headers: resHeaders,
    on: (event, cb) => { res[`_${event}`] = cb; },
    finish: () => res._finish && res._finish(),
  };
  return { req, res, resHeaders };
}

beforeEach(() => resetSpans());

// ─── 1. initTracing / shutdownTracing ─────────────────────────────────────────

describe('initTracing', () => {
  test('returns true when enabled', () => {
    jest.resetModules();
    const t = require('../src/utils/tracing');
    t._setTracerForTesting(new RecordingTracer());
    expect(t.initTracing({ enabled: true })).toBe(true);
  });

  test('returns false when explicitly disabled', () => {
    jest.resetModules();
    const t = require('../src/utils/tracing');
    t._setTracerForTesting(new RecordingTracer());
    expect(t.initTracing({ enabled: false })).toBe(false);
  });

  test('respects OTEL_ENABLED=false env var', () => {
    process.env.OTEL_ENABLED = 'false';
    jest.resetModules();
    const t = require('../src/utils/tracing');
    t._setTracerForTesting(new RecordingTracer());
    expect(t.initTracing()).toBe(false);
    delete process.env.OTEL_ENABLED;
  });

  test('is idempotent — second call is a no-op', () => {
    jest.resetModules();
    const t = require('../src/utils/tracing');
    t._setTracerForTesting(new RecordingTracer());
    const first = t.initTracing({ enabled: true });
    const second = t.initTracing({ enabled: false }); // ignored
    expect(first).toBe(second);
  });

  test('shutdownTracing resolves without error', async () => {
    jest.resetModules();
    const t = require('../src/utils/tracing');
    t._setTracerForTesting(new RecordingTracer());
    await expect(t.shutdownTracing()).resolves.toBeUndefined();
  });

  test('shutdownTracing can be called multiple times safely', async () => {
    jest.resetModules();
    const t = require('../src/utils/tracing');
    t._setTracerForTesting(new RecordingTracer());
    await t.shutdownTracing();
    await expect(t.shutdownTracing()).resolves.toBeUndefined();
  });
});

// ─── 2. getTracer ─────────────────────────────────────────────────────────────

describe('getTracer', () => {
  test('returns an object with startSpan and startActiveSpan', () => {
    const t = tracing.getTracer();
    expect(typeof t.startSpan).toBe('function');
    expect(typeof t.startActiveSpan).toBe('function');
  });
});

// ─── 3. withSpan ─────────────────────────────────────────────────────────────

describe('withSpan', () => {
  test('returns the callback result', async () => {
    const result = await tracing.withSpan('test.op', { 'custom.attr': 'hello' }, async () => 42);
    expect(result).toBe(42);
  });

  test('creates a finished span with correct name and attributes', async () => {
    await tracing.withSpan('my.span', { 'foo': 'bar' }, async () => {});
    const span = getFinishedSpans().find(s => s.name === 'my.span');
    expect(span).toBeDefined();
    expect(span.attributes['foo']).toBe('bar');
  });

  test('sets OK status on success', async () => {
    await tracing.withSpan('ok.span', async () => {});
    const span = getFinishedSpans().find(s => s.name === 'ok.span');
    expect(span.status.code).toBe(api.SpanStatusCode.OK);
  });

  test('records exception and sets ERROR status on throw', async () => {
    await expect(
      tracing.withSpan('err.span', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    const span = getFinishedSpans().find(s => s.name === 'err.span');
    expect(span.status.code).toBe(api.SpanStatusCode.ERROR);
    expect(span.status.message).toBe('boom');
    expect(span.events.some(e => e.name === 'exception')).toBe(true);
  });

  test('span is ended even when callback throws', async () => {
    await expect(
      tracing.withSpan('ended.throw', async () => { throw new Error('x'); })
    ).rejects.toThrow();
    const span = getFinishedSpans().find(s => s.name === 'ended.throw');
    expect(span.endTime).not.toBeNull();
  });

  test('works without explicit attributes argument', async () => {
    const result = await tracing.withSpan('no.attrs', async () => 'ok');
    expect(result).toBe('ok');
    expect(getFinishedSpans().find(s => s.name === 'no.attrs')).toBeDefined();
  });

  test('nested spans share the same traceId', async () => {
    await tracing.withSpan('parent.span', async () => {
      await tracing.withSpan('child.span', async () => {});
    });

    const spans = getFinishedSpans();
    const parent = spans.find(s => s.name === 'parent.span');
    const child = spans.find(s => s.name === 'child.span');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(child.parentSpanId).toBe(parent.spanContext().spanId);
  });

  test('propagates non-Error throws', async () => {
    await expect(
      tracing.withSpan('str.throw', async () => { throw 'string error'; }) // eslint-disable-line no-throw-literal
    ).rejects.toBe('string error');
  });
});

// ─── 4. startSpan ─────────────────────────────────────────────────────────────

describe('startSpan', () => {
  test('creates a span that must be ended manually', () => {
    const span = tracing.startSpan('manual.span', { 'db.system': 'sqlite' });
    expect(typeof span.end).toBe('function');
    span.end();
    const finished = getFinishedSpans().find(s => s.name === 'manual.span');
    expect(finished).toBeDefined();
    expect(finished.attributes['db.system']).toBe('sqlite');
  });

  test('works without attributes', () => {
    const span = tracing.startSpan('bare.span');
    span.end();
    expect(getFinishedSpans().find(s => s.name === 'bare.span')).toBeDefined();
  });
});

// ─── 5. httpTracingMiddleware ─────────────────────────────────────────────────

describe('httpTracingMiddleware', () => {
  test('calls next()', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes();
    const next = jest.fn();
    mw(req, res, next);
    res.finish();
    expect(next).toHaveBeenCalled();
  });

  test('creates a SERVER span with correct HTTP attributes', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes({ method: 'POST', path: '/donations' });
    mw(req, res, jest.fn());
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'POST /donations');
    expect(span).toBeDefined();
    expect(span.attributes['http.method']).toBe('POST');
    expect(span.attributes['http.route']).toBe('/donations');
    expect(span.attributes['net.peer.ip']).toBe('127.0.0.1');
    expect(span.kind).toBe(api.SpanKind.SERVER);
  });

  test('sets http.status_code on finish', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes();
    mw(req, res, jest.fn());
    res.statusCode = 201;
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /donations');
    expect(span.attributes['http.status_code']).toBe(201);
  });

  test('sets ERROR status for 5xx', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes();
    mw(req, res, jest.fn());
    res.statusCode = 503;
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /donations');
    expect(span.status.code).toBe(api.SpanStatusCode.ERROR);
  });

  test('sets OK status for 2xx', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes();
    mw(req, res, jest.fn());
    res.statusCode = 200;
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /donations');
    expect(span.status.code).toBe(api.SpanStatusCode.OK);
  });

  test('sets OK status for 4xx (client error, not server error)', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes();
    mw(req, res, jest.fn());
    res.statusCode = 404;
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /donations');
    expect(span.status.code).toBe(api.SpanStatusCode.OK);
  });

  test('attaches span and traceContext to req', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes();
    mw(req, res, jest.fn());
    expect(req.span).toBeDefined();
    expect(req.traceContext).toBeDefined();
    res.finish();
  });

  test('injects traceparent into response headers', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res, resHeaders } = makeReqRes();
    mw(req, res, jest.fn());
    res.finish();
    // Our propagator injects traceparent
    expect(resHeaders['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  test('extracts traceparent from inbound headers and continues the trace', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes({
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    });
    mw(req, res, jest.fn());
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /donations');
    expect(span.spanContext().traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  test('handles missing request id gracefully', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes({ id: undefined, headers: {} });
    expect(() => mw(req, res, jest.fn())).not.toThrow();
    res.finish();
  });

  test('handles missing originalUrl gracefully', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes({ originalUrl: undefined });
    expect(() => mw(req, res, jest.fn())).not.toThrow();
    res.finish();
  });

  test('records http.request_id attribute', () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes({ id: 'my-request-id' });
    mw(req, res, jest.fn());
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /donations');
    expect(span.attributes['http.request_id']).toBe('my-request-id');
  });
});

// ─── 6. traceDbQuery ─────────────────────────────────────────────────────────

describe('traceDbQuery', () => {
  test('creates a CLIENT span with db attributes', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const result = await tracing.traceDbQuery('SELECT', 'donations', async () => rows);

    expect(result).toEqual(rows);
    const span = getFinishedSpans().find(s => s.name === 'db.select donations');
    expect(span).toBeDefined();
    expect(span.attributes['db.system']).toBe('sqlite');
    expect(span.attributes['db.operation']).toBe('SELECT');
    expect(span.attributes['db.sql.table']).toBe('donations');
    expect(span.kind).toBe(api.SpanKind.CLIENT);
  });

  test('records rows_affected for INSERT (changes property)', async () => {
    await tracing.traceDbQuery('INSERT', 'users', async () => ({ changes: 3 }));
    const span = getFinishedSpans().find(s => s.name === 'db.insert users');
    expect(span.attributes['db.rows_affected']).toBe(3);
  });

  test('records rows_affected for SELECT (array length)', async () => {
    await tracing.traceDbQuery('SELECT', 'wallets', async () => [1, 2, 3]);
    const span = getFinishedSpans().find(s => s.name === 'db.select wallets');
    expect(span.attributes['db.rows_affected']).toBe(3);
  });

  test('records 0 rows_affected for undefined result', async () => {
    await tracing.traceDbQuery('UPDATE', 'config', async () => undefined);
    const span = getFinishedSpans().find(s => s.name === 'db.update config');
    expect(span.attributes['db.rows_affected']).toBe(0);
  });

  test('sets ERROR status when query throws', async () => {
    await expect(
      tracing.traceDbQuery('SELECT', 'bad_table', async () => { throw new Error('no such table'); })
    ).rejects.toThrow('no such table');

    const span = getFinishedSpans().find(s => s.name === 'db.select bad_table');
    expect(span.status.code).toBe(api.SpanStatusCode.ERROR);
  });

  test('operation name is lowercased in span name', async () => {
    await tracing.traceDbQuery('DELETE', 'sessions', async () => ({ changes: 0 }));
    expect(getFinishedSpans().find(s => s.name === 'db.delete sessions')).toBeDefined();
  });

  test('db.operation attribute is uppercased', async () => {
    await tracing.traceDbQuery('select', 'logs', async () => []);
    const span = getFinishedSpans().find(s => s.name === 'db.select logs');
    expect(span.attributes['db.operation']).toBe('SELECT');
  });
});

// ─── 7. traceStellarCall ──────────────────────────────────────────────────────

describe('traceStellarCall', () => {
  test('creates a CLIENT span with stellar attributes', async () => {
    const mockResult = { hash: 'abc123', ledger: 42 };
    const result = await tracing.traceStellarCall(
      'sendDonation',
      { 'stellar.network': 'testnet', 'stellar.horizon_url': 'https://horizon-testnet.stellar.org' },
      async () => mockResult
    );

    expect(result).toEqual(mockResult);
    const span = getFinishedSpans().find(s => s.name === 'stellar.sendDonation');
    expect(span).toBeDefined();
    expect(span.attributes['stellar.operation']).toBe('sendDonation');
    expect(span.attributes['peer.service']).toBe('stellar-horizon');
    expect(span.attributes['stellar.network']).toBe('testnet');
    expect(span.kind).toBe(api.SpanKind.CLIENT);
  });

  test('works without extra attributes (fn as second arg)', async () => {
    await tracing.traceStellarCall('loadAccount', async () => ({ id: 'G123' }));
    const span = getFinishedSpans().find(s => s.name === 'stellar.loadAccount');
    expect(span).toBeDefined();
    expect(span.attributes['stellar.operation']).toBe('loadAccount');
  });

  test('sets ERROR status when Stellar call throws', async () => {
    await expect(
      tracing.traceStellarCall('submitTransaction', async () => {
        throw new Error('horizon unavailable');
      })
    ).rejects.toThrow('horizon unavailable');

    const span = getFinishedSpans().find(s => s.name === 'stellar.submitTransaction');
    expect(span.status.code).toBe(api.SpanStatusCode.ERROR);
    expect(span.events.some(e => e.name === 'exception')).toBe(true);
  });

  test('MockStellarService operations can be wrapped', async () => {
    const MockStellarService = require('../src/services/MockStellarService');
    const svc = new MockStellarService();
    const wallet = await svc.createWallet();

    const result = await tracing.traceStellarCall(
      'getBalance',
      { 'stellar.network': 'testnet' },
      () => svc.getBalance(wallet.publicKey)
    );

    expect(result).toBeDefined();
    const span = getFinishedSpans().find(s => s.name === 'stellar.getBalance');
    expect(span).toBeDefined();
    expect(span.status.code).toBe(api.SpanStatusCode.OK);
  });

  test('peer.service is always stellar-horizon', async () => {
    await tracing.traceStellarCall('getTransaction', async () => ({}));
    const span = getFinishedSpans().find(s => s.name === 'stellar.getTransaction');
    expect(span.attributes['peer.service']).toBe('stellar-horizon');
  });
});

// ─── 8. injectTraceHeaders / extractTraceContext ──────────────────────────────

describe('injectTraceHeaders', () => {
  test('returns the same headers object', async () => {
    let h;
    await tracing.withSpan('inject.test', async () => {
      const input = { 'x-custom': 'val' };
      h = tracing.injectTraceHeaders(input);
      expect(h).toBe(input);
    });
  });

  test('adds traceparent when inside an active span', async () => {
    let headers;
    await tracing.withSpan('inject.active', async () => {
      headers = tracing.injectTraceHeaders({});
    });
    expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  test('does not crash outside any span', () => {
    const headers = tracing.injectTraceHeaders({ 'x-custom': 'value' });
    expect(headers['x-custom']).toBe('value');
  });

  test('traceparent contains the active span traceId', async () => {
    let headers;
    let spanTraceId;
    await tracing.withSpan('trace.id.check', async (span) => {
      spanTraceId = span.spanContext().traceId;
      headers = tracing.injectTraceHeaders({});
    });
    expect(headers['traceparent']).toContain(spanTraceId);
  });
});

describe('extractTraceContext', () => {
  test('returns a context object', () => {
    const ctx = tracing.extractTraceContext({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(ctx).toBeDefined();
  });

  test('round-trip: inject then extract preserves traceId', async () => {
    let injected;
    let originalTraceId;
    await tracing.withSpan('round.trip', async (span) => {
      originalTraceId = span.spanContext().traceId;
      injected = tracing.injectTraceHeaders({});
    });

    const ctx = tracing.extractTraceContext(injected);
    const extractedSpan = api.trace.getSpan(ctx);
    expect(extractedSpan).toBeDefined();
    expect(extractedSpan.spanContext().traceId).toBe(originalTraceId);
  });

  test('returns active context unchanged when no traceparent header', () => {
    const ctx = tracing.extractTraceContext({});
    expect(ctx).toBeDefined();
  });
});

// ─── 9. getCurrentTraceparent / getActiveSpanContext ─────────────────────────

describe('getCurrentTraceparent', () => {
  test('returns null when no active span', () => {
    expect(tracing.getCurrentTraceparent()).toBeNull();
  });

  test('returns a valid W3C traceparent string inside a span', async () => {
    let tp;
    await tracing.withSpan('tp.test', async () => {
      tp = tracing.getCurrentTraceparent();
    });
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  test('version byte is always 00', async () => {
    let tp;
    await tracing.withSpan('version.check', async () => {
      tp = tracing.getCurrentTraceparent();
    });
    expect(tp.startsWith('00-')).toBe(true);
  });

  test('traceparent traceId matches active span traceId', async () => {
    let tp;
    let spanTraceId;
    await tracing.withSpan('match.check', async (span) => {
      spanTraceId = span.spanContext().traceId;
      tp = tracing.getCurrentTraceparent();
    });
    expect(tp.split('-')[1]).toBe(spanTraceId);
  });
});

describe('getActiveSpanContext', () => {
  test('returns null when no active span', () => {
    expect(tracing.getActiveSpanContext()).toBeNull();
  });

  test('returns span context with valid traceId and spanId', async () => {
    let ctx;
    await tracing.withSpan('ctx.test', async () => {
      ctx = tracing.getActiveSpanContext();
    });
    expect(ctx).not.toBeNull();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─── 10. Constants ────────────────────────────────────────────────────────────

describe('Exported constants', () => {
  test('TRACER_NAME is stellar-donation-api', () => {
    expect(tracing.TRACER_NAME).toBe('stellar-donation-api');
  });

  test('TRACEPARENT_HEADER is traceparent', () => {
    expect(tracing.TRACEPARENT_HEADER).toBe('traceparent');
  });

  test('TRACESTATE_HEADER is tracestate', () => {
    expect(tracing.TRACESTATE_HEADER).toBe('tracestate');
  });
});

// ─── 11. Edge cases ───────────────────────────────────────────────────────────

describe('Edge cases', () => {
  test('multiple concurrent spans do not interfere', async () => {
    await Promise.all([
      tracing.withSpan('concurrent.a', async () => 'a'),
      tracing.withSpan('concurrent.b', async () => 'b'),
      tracing.withSpan('concurrent.c', async () => 'c'),
    ]);

    const spans = getFinishedSpans();
    expect(spans.find(s => s.name === 'concurrent.a')).toBeDefined();
    expect(spans.find(s => s.name === 'concurrent.b')).toBeDefined();
    expect(spans.find(s => s.name === 'concurrent.c')).toBeDefined();
  });

  test('deeply nested spans all share the root traceId', async () => {
    await tracing.withSpan('root', async () => {
      await tracing.withSpan('level1', async () => {
        await tracing.withSpan('level2', async () => {});
      });
    });

    const spans = getFinishedSpans();
    const root = spans.find(s => s.name === 'root');
    const l1 = spans.find(s => s.name === 'level1');
    const l2 = spans.find(s => s.name === 'level2');
    const traceId = root.spanContext().traceId;
    expect(l1.spanContext().traceId).toBe(traceId);
    expect(l2.spanContext().traceId).toBe(traceId);
  });

  test('traceDbQuery with empty array result records 0 rows', async () => {
    await tracing.traceDbQuery('SELECT', 'empty_table', async () => []);
    const span = getFinishedSpans().find(s => s.name === 'db.select empty_table');
    expect(span.attributes['db.rows_affected']).toBe(0);
  });
});

// ─── 12. Integration: HTTP → DB → Stellar trace chain ────────────────────────

describe('Integration: full trace chain', () => {
  test('DB and Stellar spans share traceId with HTTP root span', async () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res } = makeReqRes({ method: 'POST', path: '/donations' });

    await new Promise((resolve) => {
      mw(req, res, async () => {
        await api.context.with(req.traceContext, async () => {
          await tracing.traceDbQuery('INSERT', 'donations', async () => ({ changes: 1 }));
          await tracing.traceStellarCall('sendDonation', { 'stellar.network': 'testnet' }, async () => ({
            hash: 'txhash123',
          }));
        });
        res.statusCode = 201;
        res.finish();
        resolve();
      });
    });

    const spans = getFinishedSpans();
    const httpSpan = spans.find(s => s.name === 'POST /donations');
    const dbSpan = spans.find(s => s.name === 'db.insert donations');
    const stellarSpan = spans.find(s => s.name === 'stellar.sendDonation');

    expect(httpSpan).toBeDefined();
    expect(dbSpan).toBeDefined();
    expect(stellarSpan).toBeDefined();

    const traceId = httpSpan.spanContext().traceId;
    expect(dbSpan.spanContext().traceId).toBe(traceId);
    expect(stellarSpan.spanContext().traceId).toBe(traceId);
  });

  test('traceparent in response matches the root span traceId', async () => {
    const mw = tracing.httpTracingMiddleware();
    const { req, res, resHeaders } = makeReqRes({ method: 'GET', path: '/wallets' });
    mw(req, res, jest.fn());
    res.finish();

    const span = getFinishedSpans().find(s => s.name === 'GET /wallets');
    const tp = resHeaders['traceparent'];
    expect(tp).toBeDefined();
    expect(tp.split('-')[1]).toBe(span.spanContext().traceId);
  });
});
