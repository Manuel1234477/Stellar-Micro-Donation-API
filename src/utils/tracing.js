/**
 * Distributed Tracing Utility - OpenTelemetry Integration
 *
 * RESPONSIBILITY: End-to-end distributed tracing for HTTP requests, database queries,
 *                 and Stellar network calls via OpenTelemetry SDK.
 * OWNER: Platform Team
 * DEPENDENCIES: @opentelemetry/api, optional SDK packages
 *
 * Provides automatic and manual instrumentation with graceful degradation when
 * the full SDK is not installed. Traces are exported to a configurable OTLP endpoint.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  - OTLP collector endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            - Service name reported in traces (default: stellar-donation-api)
 *   OTEL_ENABLED                 - Set to "false" to disable tracing entirely (default: true)
 *   OTEL_EXPORTER_OTLP_HEADERS  - Comma-separated key=value auth headers for the exporter
 */

'use strict';

const api = require('@opentelemetry/api');

// ─── Constants ────────────────────────────────────────────────────────────────

const TRACER_NAME = 'stellar-donation-api';
const TRACER_VERSION = '1.0.0';

/** W3C traceparent header name */
const TRACEPARENT_HEADER = 'traceparent';
/** W3C tracestate header name */
const TRACESTATE_HEADER = 'tracestate';

// ─── SDK Loader (graceful degradation) ────────────────────────────────────────

/**
 * Attempt to load and initialise the OpenTelemetry Node SDK.
 * Returns null when SDK packages are not installed so the application
 * continues to run without tracing rather than crashing.
 *
 * @param {Object} [options] - Initialisation options (see initTracing)
 * @returns {Object|null} SDK instance or null
 */
function _loadSdk(options = {}) {
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } =
      require('@opentelemetry/semantic-conventions');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

    const endpoint =
      options.endpoint ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318';

    const serviceName =
      options.serviceName ||
      process.env.OTEL_SERVICE_NAME ||
      'stellar-donation-api';

    const exporterHeaders = _parseExporterHeaders(
      options.exporterHeaders || process.env.OTEL_EXPORTER_OTLP_HEADERS
    );

    const exporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers: exporterHeaders,
    });

    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: serviceName,
        [SEMRESATTRS_SERVICE_VERSION]: TRACER_VERSION,
      }),
      traceExporter: exporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    return sdk;
  } catch (_err) {
    // SDK packages not installed — tracing disabled
    return null;
  }
}

/**
 * Parse OTLP exporter headers from a "key=value,key2=value2" string or object.
 *
 * @param {string|Object|undefined} raw - Raw header input
 * @returns {Object} Parsed headers object
 */
function _parseExporterHeaders(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  return raw.split(',').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      acc[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    return acc;
  }, {});
}

// ─── Module State ─────────────────────────────────────────────────────────────

let _sdk = null;
let _initialised = false;
let _enabled = true;

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise the OpenTelemetry SDK and register a global tracer provider.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param {Object} [options] - Configuration options
 * @param {string} [options.endpoint]       - OTLP collector base URL
 * @param {string} [options.serviceName]    - Service name for resource attributes
 * @param {string|Object} [options.exporterHeaders] - Auth headers for the exporter
 * @param {boolean} [options.enabled]       - Explicitly enable/disable tracing
 * @returns {boolean} True when tracing was successfully initialised
 */
function initTracing(options = {}) {
  if (_initialised) return _enabled;

  _enabled =
    options.enabled !== undefined
      ? Boolean(options.enabled)
      : process.env.OTEL_ENABLED !== 'false';

  _initialised = true;

  if (!_enabled) return false;

  _sdk = _loadSdk(options);

  if (_sdk) {
    try {
      _sdk.start();
    } catch (_err) {
      // Non-fatal — continue without exporting
    }
  }

  return _enabled;
}

/**
 * Shut down the SDK and flush pending spans.
 * Should be called during graceful shutdown.
 *
 * @returns {Promise<void>}
 */
async function shutdownTracing() {
  if (_sdk) {
    try {
      await _sdk.shutdown();
    } catch (_err) {
      // Ignore shutdown errors
    }
  }
  _initialised = false;
  _sdk = null;
}

// ─── Tracer Access ────────────────────────────────────────────────────────────

let _tracerOverride = null;

/**
 * Get the application tracer instance.
 * Returns the global no-op tracer when the SDK is not initialised.
 *
 * @returns {import('@opentelemetry/api').Tracer}
 */
function getTracer() {
  if (_tracerOverride) return _tracerOverride;
  return api.trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

/**
 * Override the tracer used by this module (for testing only).
 * Pass null to restore the default global tracer.
 *
 * @param {import('@opentelemetry/api').Tracer|null} tracer
 */
function _setTracerForTesting(tracer) {
  _tracerOverride = tracer;
}

// ─── Span Helpers ─────────────────────────────────────────────────────────────

/**
 * Execute a function inside a new span, automatically ending it on completion.
 * The span is set as the active span for the duration of the callback.
 *
 * @param {string} spanName - Human-readable span name
 * @param {Object} [attributes] - Initial span attributes
 * @param {Function} fn - Async or sync callback receiving the active span
 * @param {import('@opentelemetry/api').SpanOptions} [spanOptions] - Additional span options
 * @returns {Promise<*>} Result of fn
 */
async function withSpan(spanName, attributes, fn, spanOptions = {}) {
  if (typeof attributes === 'function') {
    fn = attributes;
    attributes = {};
  }

  const tracer = getTracer();
  const opts = { ...spanOptions, attributes: { ...attributes, ...(spanOptions.attributes || {}) } };

  return tracer.startActiveSpan(spanName, opts, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: api.SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a child span under the currently active span without replacing the
 * active context. Useful for fire-and-forget sub-operations.
 *
 * @param {string} spanName - Span name
 * @param {Object} [attributes] - Span attributes
 * @returns {import('@opentelemetry/api').Span} Started span (caller must call .end())
 */
function startSpan(spanName, attributes = {}) {
  const tracer = getTracer();
  return tracer.startSpan(spanName, { attributes });
}

// ─── HTTP Instrumentation ─────────────────────────────────────────────────────

/**
 * Express middleware that creates a root span for every inbound HTTP request
 * and injects the W3C traceparent header into the response.
 *
 * Attributes set on the span:
 *   http.method, http.route, http.url, http.host, http.scheme,
 *   net.peer.ip, http.request_id
 *
 * @returns {Function} Express middleware (req, res, next)
 */
function httpTracingMiddleware() {
  return function tracingMiddleware(req, res, next) {
    const tracer = getTracer();

    // Extract W3C trace context from inbound headers
    const parentContext = api.propagation.extract(api.context.active(), req.headers);

    const spanName = `${req.method} ${req.path}`;
    const span = tracer.startSpan(
      spanName,
      {
        kind: api.SpanKind.SERVER,
        attributes: {
          'http.method': req.method,
          'http.url': req.originalUrl || req.url,
          'http.route': req.path,
          'http.host': req.hostname,
          'http.scheme': req.protocol || 'http',
          'net.peer.ip': req.ip,
          'http.request_id': req.id || req.headers['x-request-id'] || '',
        },
      },
      parentContext
    );

    // Make span active for the duration of the request
    const ctx = api.trace.setSpan(parentContext, span);

    // Inject traceparent into response headers
    const carrier = {};
    api.propagation.inject(ctx, carrier);
    if (carrier[TRACEPARENT_HEADER]) {
      res.setHeader(TRACEPARENT_HEADER, carrier[TRACEPARENT_HEADER]);
    }
    if (carrier[TRACESTATE_HEADER]) {
      res.setHeader(TRACESTATE_HEADER, carrier[TRACESTATE_HEADER]);
    }

    // Attach span to request for downstream use
    req.span = span;
    req.traceContext = ctx;

    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: api.SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: api.SpanStatusCode.OK });
      }
      span.end();
    });

    api.context.with(ctx, next);
  };
}

// ─── Database Instrumentation ─────────────────────────────────────────────────

/**
 * Wrap a database query function to emit a child span with query details.
 *
 * @param {string} operation - SQL operation type (SELECT, INSERT, etc.)
 * @param {string} table - Target table name
 * @param {Function} queryFn - Async function that executes the query
 * @returns {Promise<*>} Query result
 */
async function traceDbQuery(operation, table, queryFn) {
  return withSpan(
    `db.${operation.toLowerCase()} ${table}`,
    {
      'db.system': 'sqlite',
      'db.operation': operation.toUpperCase(),
      'db.sql.table': table,
      'span.kind': 'client',
    },
    async (span) => {
      const result = await queryFn();
      span.setAttribute('db.rows_affected', result?.changes ?? result?.length ?? 0);
      return result;
    },
    { kind: api.SpanKind.CLIENT }
  );
}

// ─── Stellar Instrumentation ──────────────────────────────────────────────────

/**
 * Wrap a Stellar network operation to emit a child span with operation details.
 *
 * @param {string} operation - Stellar operation name (e.g. "sendDonation", "loadAccount")
 * @param {Object} [attributes] - Additional span attributes (network, horizon URL, etc.)
 * @param {Function} fn - Async function performing the Stellar call
 * @returns {Promise<*>} Operation result
 */
async function traceStellarCall(operation, attributes, fn) {
  if (typeof attributes === 'function') {
    fn = attributes;
    attributes = {};
  }

  return withSpan(
    `stellar.${operation}`,
    {
      'stellar.operation': operation,
      'peer.service': 'stellar-horizon',
      ...attributes,
    },
    fn,
    { kind: api.SpanKind.CLIENT }
  );
}

// ─── Context Propagation ──────────────────────────────────────────────────────

/**
 * Inject W3C traceparent/tracestate headers into an outbound headers object.
 * Mutates the provided headers object in place.
 *
 * @param {Object} headers - Mutable headers object for the outbound request
 * @returns {Object} The same headers object with trace context injected
 */
function injectTraceHeaders(headers) {
  api.propagation.inject(api.context.active(), headers);
  return headers;
}

/**
 * Extract trace context from inbound headers and return an active context.
 *
 * @param {Object} headers - Inbound request headers
 * @returns {import('@opentelemetry/api').Context} Active context with parent span
 */
function extractTraceContext(headers) {
  return api.propagation.extract(api.context.active(), headers);
}

/**
 * Build a W3C traceparent header value from the currently active span.
 * Returns null when there is no active span.
 *
 * @returns {string|null} traceparent header value or null
 */
function getCurrentTraceparent() {
  const span = api.trace.getActiveSpan();
  if (!span) return null;

  const ctx = span.spanContext();
  if (!api.isSpanContextValid(ctx)) return null;

  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Return the active span context, or null if none is active.
 *
 * @returns {import('@opentelemetry/api').SpanContext|null}
 */
function getActiveSpanContext() {
  const span = api.trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  return api.isSpanContextValid(ctx) ? ctx : null;
}

// ─── In-Memory Trace Store (issue #632) ──────────────────────────────────────

const MAX_STORED_TRACES = 1000;

/** @type {Map<string, {traceId: string, spans: Array, startedAt: string}>} */
const _traceStore = new Map();
/** Insertion-order queue for eviction */
const _traceQueue = [];

/**
 * Record a span into the in-memory trace store.
 * Evicts the oldest trace when the store exceeds MAX_STORED_TRACES.
 *
 * @param {string} traceId
 * @param {Object} spanData
 */
function recordSpan(traceId, spanData) {
  if (!traceId) return;

  if (!_traceStore.has(traceId)) {
    if (_traceQueue.length >= MAX_STORED_TRACES) {
      const oldest = _traceQueue.shift();
      _traceStore.delete(oldest);
    }
    _traceStore.set(traceId, { traceId, spans: [], startedAt: new Date().toISOString() });
    _traceQueue.push(traceId);
  }

  _traceStore.get(traceId).spans.push({ ...spanData, recordedAt: new Date().toISOString() });
}

/**
 * Retrieve a stored trace by ID.
 *
 * @param {string} traceId
 * @returns {{traceId: string, spans: Array, startedAt: string}|null}
 */
function getTrace(traceId) {
  return _traceStore.get(traceId) || null;
}

/** @returns {number} */
function getTraceCount() {
  return _traceStore.size;
}

/** Clear all stored traces (for testing). */
function _clearTraceStore() {
  _traceStore.clear();
  _traceQueue.length = 0;
}

// ─── Context-propagating span wrapper (issue #632) ────────────────────────────

/**
 * Run an async function inside a new span under the given OTel context.
 * Records the span in the in-memory trace store.
 *
 * @param {string} spanName
 * @param {import('@opentelemetry/api').Context} parentContext
 * @param {Object} [attributes]
 * @param {Function} fn
 * @returns {Promise<*>}
 */
async function withSpanInContext(spanName, parentContext, attributes, fn) {
  if (typeof attributes === 'function') {
    fn = attributes;
    attributes = {};
  }

  const tracer = getTracer();
  const ctx = parentContext || api.context.active();

  return api.context.with(ctx, () =>
    tracer.startActiveSpan(spanName, { attributes }, ctx, async (span) => {
      const spanCtx = span.spanContext();
      try {
        const result = await fn(span);
        span.setStatus({ code: api.SpanStatusCode.OK });
        recordSpan(spanCtx.traceId, { name: spanName, spanId: spanCtx.spanId, attributes, status: 'ok' });
        return result;
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
        recordSpan(spanCtx.traceId, { name: spanName, spanId: spanCtx.spanId, attributes, status: 'error', error: err.message });
        throw err;
      } finally {
        span.end();
      }
    })
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Lifecycle
  initTracing,
  shutdownTracing,

  // Tracer
  getTracer,
  _setTracerForTesting,

  // Span helpers
  withSpan,
  startSpan,
  withSpanInContext,

  // Middleware
  httpTracingMiddleware,

  // Domain-specific wrappers
  traceDbQuery,
  traceStellarCall,

  // Propagation
  injectTraceHeaders,
  extractTraceContext,
  getCurrentTraceparent,
  getActiveSpanContext,

  // In-memory trace store (issue #632)
  recordSpan,
  getTrace,
  getTraceCount,
  _clearTraceStore,

  // Constants (exported for tests)
  TRACEPARENT_HEADER,
  TRACESTATE_HEADER,
  TRACER_NAME,
};
