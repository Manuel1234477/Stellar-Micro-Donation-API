/**
 * Validation Middleware
 */

function validateDateRange(req, res, next) {
  const { startDate, endDate } = req.query;

  if (startDate && isNaN(Date.parse(startDate))) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid startDate' } });
  }

  if (endDate && isNaN(Date.parse(endDate))) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid endDate' } });
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_DATE_RANGE', message: 'startDate must be before endDate' } });
  }

  next();
}

// Allowed fields per route pattern and method
const ROUTE_ALLOWED_FIELDS = [
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/donations\/send$/, fields: ['senderId', 'receiverId', 'amount', 'memo', 'idempotencyKey', 'campaign_id'] },
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/donations\/verify$/, fields: ['transactionHash', 'stellarTxId'] },
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/donations$/, fields: ['donor', 'recipient', 'amount', 'memo', 'currency', 'memoType', 'notes', 'tags', 'sourceAsset', 'sourceAmount', 'idempotencyKey'] },
  { methods: ['PATCH'], pattern: /^(\/api\/v1)?\/donations\/[^/]+\/status$/, fields: ['status', 'stellarTxId', 'ledger', 'notes', 'tags'] },
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/wallets$/, fields: ['address', 'label', 'ownerName'] },
  { methods: ['PATCH'], pattern: /^(\/api\/v1)?\/wallets\/[^/]+$/, fields: ['label', 'ownerName'] },
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/transactions\/sync$/, fields: ['publicKey'] },
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/api-keys\/cleanup$/, fields: ['retentionDays'] },
  { methods: ['POST'], pattern: /^(\/api\/v1)?\/api-keys$/, fields: ['name', 'role', 'expiresInDays', 'metadata'] },
];

function validatePayloadFields(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (!req.body || typeof req.body !== 'object') return next();

  const route = ROUTE_ALLOWED_FIELDS.find(
    r => r.methods.includes(req.method) && r.pattern.test(req.path)
  );
  if (!route) return next();

  const bodyKeys = Object.keys(req.body);
  const unknownFields = bodyKeys.filter(k => !route.fields.includes(k));

  if (unknownFields.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'UNKNOWN_FIELDS',
        message: `Unknown fields in request: ${unknownFields.join(', ')}`,
        unknownFields,
        allowedFields: route.fields,
      },
    });
  }

  next();
}

module.exports = { validateDateRange, validatePayloadFields };
