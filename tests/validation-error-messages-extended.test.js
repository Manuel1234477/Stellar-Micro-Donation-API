/**
 * Tests for validationErrorFormatter and /docs/validation-errors endpoint
 */

const { formatError, buildErrorResponse, maskValue, isSensitive, ERROR_REGISTRY, SENSITIVE_FIELDS } =
  require('../src/utils/validationErrorFormatter');
const express = require('express');
const docsRoutes = require('../src/routes/docs');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/docs', docsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// maskValue
// ---------------------------------------------------------------------------
describe('maskValue', () => {
  test('masks value preserving first two chars', () => {
    expect(maskValue('SABCDEF')).toBe('SA***');
  });

  test('returns *** for values with 2 or fewer chars', () => {
    expect(maskValue('S')).toBe('***');
    expect(maskValue('SA')).toBe('***');
  });

  test('handles null/undefined', () => {
    expect(maskValue(null)).toBe('***');
    expect(maskValue(undefined)).toBe('***');
  });

  test('handles numbers', () => {
    expect(maskValue(12345)).toBe('12***');
  });
});

// ---------------------------------------------------------------------------
// isSensitive
// ---------------------------------------------------------------------------
describe('isSensitive', () => {
  test.each([
    ['secretKey', true],
    ['secret', true],
    ['password', true],
    ['privateKey', true],
    ['token', true],
    ['apiKey', true],
    ['sourceSecret', true],
    ['amount', false],
    ['recipient', false],
    ['publicKey', false],
  ])('field "%s" → sensitive: %s', (field, expected) => {
    expect(isSensitive(field)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------
describe('formatError', () => {
  test('returns all required fields', () => {
    const err = formatError('MISSING_AMOUNT', undefined);
    expect(err).toHaveProperty('code', 'MISSING_AMOUNT');
    expect(err).toHaveProperty('field', 'amount');
    expect(err).toHaveProperty('receivedValue');
    expect(err).toHaveProperty('expectedFormat');
    expect(err).toHaveProperty('docLink');
  });

  test('docLink contains the lowercased code', () => {
    const err = formatError('MISSING_AMOUNT', undefined);
    expect(err.docLink).toContain('missing_amount');
  });

  test('does NOT mask non-sensitive field values', () => {
    const err = formatError('MISSING_RECIPIENT', 'some-value');
    expect(err.receivedValue).toBe('some-value');
  });

  test('masks sensitive field values', () => {
    const err = formatError('MISSING_AMOUNT', 'SABCDEF', { field: 'secretKey' });
    expect(err.receivedValue).toBe('SA***');
  });

  test('overrides field and expectedFormat', () => {
    const err = formatError('MISSING_AMOUNT', 0, { field: 'customField', expectedFormat: 'custom format' });
    expect(err.field).toBe('customField');
    expect(err.expectedFormat).toBe('custom format');
  });

  test('handles unknown code gracefully', () => {
    const err = formatError('UNKNOWN_CODE', 'val');
    expect(err.code).toBe('UNKNOWN_CODE');
    expect(err.field).toBe('unknown');
  });

  test('receivedValue is null when not provided', () => {
    const err = formatError('MISSING_AMOUNT');
    expect(err.receivedValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildErrorResponse
// ---------------------------------------------------------------------------
describe('buildErrorResponse', () => {
  test('returns success:false', () => {
    const res = buildErrorResponse([{ code: 'MISSING_AMOUNT' }]);
    expect(res.success).toBe(false);
  });

  test('returns errors array with one entry per input', () => {
    const res = buildErrorResponse([
      { code: 'MISSING_AMOUNT' },
      { code: 'MISSING_RECIPIENT' },
    ]);
    expect(res.errors).toHaveLength(2);
  });

  test('each error has required fields', () => {
    const res = buildErrorResponse([{ code: 'MISSING_AMOUNT', receivedValue: null }]);
    const err = res.errors[0];
    expect(err).toHaveProperty('code');
    expect(err).toHaveProperty('field');
    expect(err).toHaveProperty('receivedValue');
    expect(err).toHaveProperty('expectedFormat');
    expect(err).toHaveProperty('docLink');
  });

  test('masks sensitive values in bulk response', () => {
    const res = buildErrorResponse([{ code: 'MISSING_AMOUNT', receivedValue: 'SABCDEF', overrides: { field: 'secretKey' } }]);
    expect(res.errors[0].receivedValue).toBe('SA***');
  });
});

// ---------------------------------------------------------------------------
// ERROR_REGISTRY completeness
// ---------------------------------------------------------------------------
describe('ERROR_REGISTRY', () => {
  test('every entry has field, expectedFormat, description', () => {
    for (const [code, meta] of Object.entries(ERROR_REGISTRY)) {
      expect(meta).toHaveProperty('field', expect.any(String));
      expect(meta).toHaveProperty('expectedFormat', expect.any(String));
      expect(meta).toHaveProperty('description', expect.any(String));
      expect(code.length).toBeGreaterThan(0);
    }
  });

  test('contains all expected codes', () => {
    const expected = [
      'MISSING_AMOUNT', 'INVALID_AMOUNT_TYPE', 'AMOUNT_TOO_LOW',
      'AMOUNT_BELOW_MINIMUM', 'AMOUNT_EXCEEDS_MAXIMUM', 'DAILY_LIMIT_EXCEEDED',
      'MISSING_RECIPIENT', 'SAME_SENDER_RECIPIENT', 'MISSING_IDEMPOTENCY_KEY',
      'MISSING_ADDRESS', 'MISSING_STATUS', 'INVALID_STATUS',
      'MISSING_PUBLIC_KEY', 'INVALID_LIMIT', 'INVALID_OFFSET',
      'MISSING_TRANSACTION_HASH', 'MISSING_WALLET_FIELD',
    ];
    for (const code of expected) {
      expect(ERROR_REGISTRY).toHaveProperty(code);
    }
  });
});

// ---------------------------------------------------------------------------
// SENSITIVE_FIELDS
// ---------------------------------------------------------------------------
describe('SENSITIVE_FIELDS', () => {
  test('is a Set', () => {
    expect(SENSITIVE_FIELDS).toBeInstanceOf(Set);
  });

  test('contains expected sensitive field names', () => {
    ['secretKey', 'secret', 'password', 'privateKey', 'token', 'apiKey'].forEach(f => {
      expect(SENSITIVE_FIELDS.has(f)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /docs/validation-errors
// ---------------------------------------------------------------------------
describe('GET /docs/validation-errors', () => {
  const app = makeApp();

  test('returns 200', async () => {
    const res = await request(app).get('/docs/validation-errors');
    expect(res.status).toBe(200);
  });

  test('response contains errors array', async () => {
    const res = await request(app).get('/docs/validation-errors');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test('response contains totalCodes matching registry size', async () => {
    const res = await request(app).get('/docs/validation-errors');
    expect(res.body.totalCodes).toBe(Object.keys(ERROR_REGISTRY).length);
  });

  test('each error entry has code, field, expectedFormat, description, docLink', async () => {
    const res = await request(app).get('/docs/validation-errors');
    for (const entry of res.body.errors) {
      expect(entry).toHaveProperty('code');
      expect(entry).toHaveProperty('field');
      expect(entry).toHaveProperty('expectedFormat');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('docLink');
    }
  });

  test('response includes sensitiveFields list', async () => {
    const res = await request(app).get('/docs/validation-errors');
    expect(Array.isArray(res.body.sensitiveFields)).toBe(true);
    expect(res.body.sensitiveFields).toContain('secretKey');
  });

  test('docLinks are lowercase and anchored', async () => {
    const res = await request(app).get('/docs/validation-errors');
    for (const entry of res.body.errors) {
      expect(entry.docLink).toMatch(/^\/docs\/validation-errors#[a-z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Format consistency across error codes
// ---------------------------------------------------------------------------
describe('Format consistency', () => {
  test('all registry codes produce valid formatError output', () => {
    for (const code of Object.keys(ERROR_REGISTRY)) {
      const err = formatError(code, 'test-value');
      expect(err.code).toBe(code);
      expect(typeof err.field).toBe('string');
      expect(typeof err.expectedFormat).toBe('string');
      expect(err.docLink).toContain(code.toLowerCase());
    }
  });

  test('sensitive field masking is consistent across all sensitive fields', () => {
    for (const field of SENSITIVE_FIELDS) {
      const err = formatError('MISSING_AMOUNT', 'SABCDEF123', { field });
      expect(err.receivedValue).toBe('SA***');
    }
  });
});
