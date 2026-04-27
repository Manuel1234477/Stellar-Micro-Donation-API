let uuidv4;
try {
  const { randomUUID } = require('crypto');
  uuidv4 = () => randomUUID();
} catch (e) {
  try {
    uuidv4 = require('uuid').v4;
  } catch (err) {
    uuidv4 = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

const log = require('../utils/log');
const correlationUtils = require("../utils/correlation");

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requestIdMiddleware = (req, res, next) => {
  const clientId = req.get('X-Request-ID');
  const requestId = (clientId && UUID_V4_RE.test(clientId)) ? clientId : uuidv4();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  const inboundHeaders = correlationUtils.parseCorrelationHeaders
    ? correlationUtils.parseCorrelationHeaders(req.headers)
    : {};

  let context = null;

  try {
    if (correlationUtils.createCorrelationContext && correlationUtils.setCorrelationContext) {
      context = correlationUtils.createCorrelationContext({
        requestId,
        correlationId: inboundHeaders.correlationId || undefined,
        traceId: inboundHeaders.traceId || undefined,
        operationType: 'http_request',
        metadata: {
          method: req.method,
          path: req.path,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          initiatedAt: new Date().toISOString(),
        },
      });
      correlationUtils.setCorrelationContext(context);
    } else if (correlationUtils.initializeRequestContext) {
      context = correlationUtils.initializeRequestContext(requestId, {
        method: req.method,
        path: req.path,
      });
    }
  } catch (e) {
    // Correlation context creation failed — continue without it
  }

  req.correlationContext = context;

  if (context && context.correlationId) {
    res.setHeader('X-Correlation-ID', context.correlationId);
  }
  if (context && context.traceId) {
    res.setHeader('X-Trace-ID', context.traceId);
  }

  if (log.setContext) {
    log.setContext({
      requestId,
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      ...(context && { correlationId: context.correlationId, traceId: context.traceId }),
    });
  }

  next();
};

module.exports = requestIdMiddleware;
