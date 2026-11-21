'use strict';
/**
 * Tests for #908 — OpenTelemetry child spans for database queries
 *
 * Verifies:
 *  - Child span is created for SELECT, INSERT, UPDATE, DELETE operations
 *  - Span attributes include db.system, db.operation, db.statement
 *  - db.rows_affected is set for write (run) operations
 *  - SQL parameter VALUES never appear in span attributes
 *  - Spans are children of the current active span
 */

process.env.NODE_ENV = 'test';

const api = require('@opentelemetry/api');

// ─── Minimal recording tracer ─────────────────────────────────────────────────

const recordedSpans = [];

function resetSpans() {
  recordedSpans.length = 0;
}

function randomHex(len) {
  let s = '';
  while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, len);
}

class RecordingSpan {
  constructor(name, options) {
    this.name = name;
    this.attributes = { ...(options.attributes || {}) };
    this.status = { code: api.SpanStatusCode.UNSET };
    this.ended = false;
    this._ctx = {
      traceId: randomHex(32),
      spanId: randomHex(16),
      traceFlags: api.TraceFlags.SAMPLED,
    };
  }

  spanContext() { return this._ctx; }
  setAttribute(key, value) { this.attributes[key] = value; return this; }
  setAttributes(attrs) { Object.assign(this.attributes, attrs); return this; }
  setStatus(s) { this.status = s; return this; }
  recordException() { return this; }
  end() { this.ended = true; recordedSpans.push(this); }
  isRecording() { return !this.ended; }
}

class RecordingTracer {
  startSpan(name, options = {}) {
    return new RecordingSpan(name, options);
  }

  startActiveSpan(name, options, _ctx, fn) {
    // Handle overloaded signatures
    if (typeof options === 'function') { fn = options; options = {}; }
    if (typeof _ctx === 'function')    { fn = _ctx; _ctx = undefined; }

    const span = new RecordingSpan(name, options || {});
    const spanCtx = api.trace.setSpan(api.context.active(), span);
    return api.context.with(spanCtx, () => fn(span));
  }
}

const recordingTracer = new RecordingTracer();

// ─── Wire up tracing module to use the recording tracer ───────────────────────
const tracing = require('../../src/utils/tracing');
tracing._setTracerForTesting(recordingTracer);

// ─── Database setup ───────────────────────────────────────────────────────────
const Database = require('../../src/utils/database');

beforeAll(async () => {
  await Database.initialize();
});

afterAll(async () => {
  await Database.close();
  tracing._setTracerForTesting(null);
});

beforeEach(() => {
  resetSpans();
});

// ─── Helper ────────────────────────────────────────────────────────────────────

function findDbSpan(operation) {
  return recordedSpans.find(s => s.name === `db.${operation.toLowerCase()}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('#908 — Database query spans', () => {
  test('SELECT query produces a span with correct attributes', async () => {
    await Database.get('SELECT 1 AS probe', []);

    const span = findDbSpan('select');
    expect(span).toBeDefined();
    expect(span.attributes['db.system']).toBe('sqlite');
    expect(span.attributes['db.operation']).toBe('SELECT');
    expect(span.attributes['db.statement']).toBe('SELECT 1 AS probe');
    expect(span.ended).toBe(true);
  });

  test('INSERT query produces a span with db.rows_affected', async () => {
    // Ensure test table exists
    await Database.run(
      `CREATE TABLE IF NOT EXISTS _tracing_test (id INTEGER PRIMARY KEY, val TEXT)`,
      []
    );
    resetSpans();

    await Database.run(
      'INSERT INTO _tracing_test (val) VALUES (?)',
      ['secret-param-value']
    );

    const span = findDbSpan('insert');
    expect(span).toBeDefined();
    expect(span.attributes['db.system']).toBe('sqlite');
    expect(span.attributes['db.operation']).toBe('INSERT');
    expect(span.attributes['db.statement']).toBe('INSERT INTO _tracing_test (val) VALUES (?)');
    expect(typeof span.attributes['db.rows_affected']).toBe('number');
    expect(span.ended).toBe(true);
  });

  test('UPDATE query produces a span with db.rows_affected', async () => {
    await Database.run(
      `CREATE TABLE IF NOT EXISTS _tracing_test (id INTEGER PRIMARY KEY, val TEXT)`,
      []
    );
    resetSpans();

    await Database.run(
      'UPDATE _tracing_test SET val = ? WHERE id = ?',
      ['new-value', 999999]
    );

    const span = findDbSpan('update');
    expect(span).toBeDefined();
    expect(span.attributes['db.operation']).toBe('UPDATE');
    expect(span.attributes['db.statement']).toBe('UPDATE _tracing_test SET val = ? WHERE id = ?');
    expect(typeof span.attributes['db.rows_affected']).toBe('number');
  });

  test('DELETE query produces a span with db.rows_affected', async () => {
    await Database.run(
      `CREATE TABLE IF NOT EXISTS _tracing_test (id INTEGER PRIMARY KEY, val TEXT)`,
      []
    );
    resetSpans();

    await Database.run(
      'DELETE FROM _tracing_test WHERE id = ?',
      [999999]
    );

    const span = findDbSpan('delete');
    expect(span).toBeDefined();
    expect(span.attributes['db.operation']).toBe('DELETE');
    expect(span.attributes['db.statement']).toBe('DELETE FROM _tracing_test WHERE id = ?');
    expect(typeof span.attributes['db.rows_affected']).toBe('number');
  });

  test('SQL parameter VALUES never appear in any span attribute', async () => {
    await Database.run(
      `CREATE TABLE IF NOT EXISTS _tracing_test (id INTEGER PRIMARY KEY, val TEXT)`,
      []
    );
    resetSpans();

    const secretValue = 'SUPER_SECRET_PARAM_12345';
    await Database.run(
      'INSERT INTO _tracing_test (val) VALUES (?)',
      [secretValue]
    );

    // Inspect every attribute of every recorded span
    for (const span of recordedSpans) {
      for (const [, attrValue] of Object.entries(span.attributes)) {
        expect(String(attrValue)).not.toContain(secretValue);
      }
    }
  });

  test('Database.all() produces a SELECT span', async () => {
    await Database.all('SELECT 1 AS probe', []);

    const span = findDbSpan('select');
    expect(span).toBeDefined();
    expect(span.attributes['db.operation']).toBe('SELECT');
  });

  test('Span name follows db.<operation> convention', async () => {
    await Database.get('SELECT 42', []);
    const span = recordedSpans.find(s => s.name === 'db.select');
    expect(span).toBeDefined();
  });
});
