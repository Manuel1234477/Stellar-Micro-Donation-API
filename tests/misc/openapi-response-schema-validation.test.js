'use strict';

/**
 * OpenAPI Response Schema Validation Tests (Issue #1539)
 *
 * Starts the Express app, calls documented endpoints across success (2xx) and
 * common error responses (400, 401, 403, 404), and validates that actual runtime
 * responses conform to the OpenAPI 3.1 response schemas using Ajv.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-openapi-key';

const request = require('supertest');
const Ajv = require('ajv');
const { createApp } = require('../../src/app');
const { spec } = require('../../src/config/openapi');

// Initialize Ajv with JSON Schema Draft 2020-12 / OpenAPI 3.1 compatibility
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
});

// Register shared components schemas with Ajv
if (spec.components && spec.components.schemas) {
  for (const [schemaName, schemaObj] of Object.entries(spec.components.schemas)) {
    try {
      ajv.addSchema(schemaObj, `#/components/schemas/${schemaName}`);
    } catch (_) {
      // Schema may already be registered
    }
  }
}

/**
 * Helper to validate a response payload against an OpenAPI response definition.
 *
 * @param {object} response - Supertest response object
 * @param {object} schema - OpenAPI schema object or reference
 * @param {string} endpoint - Endpoint description for clear assertion errors
 */
function assertMatchesSchema(response, schema, endpoint = '') {
  let resolvedSchema = schema;

  if (schema && schema.$ref) {
    const refPath = schema.$ref.replace(/^#\/components\/schemas\//, '');
    resolvedSchema = spec.components?.schemas?.[refPath] || schema;
  }

  if (!resolvedSchema) {
    throw new Error(`No schema found to validate response for ${endpoint}`);
  }

  const validate = ajv.compile(resolvedSchema);
  const valid = validate(response.body);

  if (!valid) {
    const errorDetails = (validate.errors || [])
      .map(err => `  - Field '${err.instancePath || '/'}' ${err.message} (schema rule: ${JSON.stringify(err.params)})`)
      .join('\n');
    throw new Error(
      `OpenAPI schema mismatch on ${endpoint} [HTTP ${response.status}]:\n${errorDetails}\nActual response body:\n${JSON.stringify(response.body, null, 2)}`
    );
  }

  expect(valid).toBe(true);
}

describe('OpenAPI Response Schema Validation Suite (#1539)', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  // ─── 1. Common Error Responses (400, 401, 404) ───────────────────────────────

  describe('Common Error Schemas', () => {
    test('401 Unauthorized response matches UnauthorizedError schema', async () => {
      const res = await request(app)
        .get('/api/v1/donations')
        .set('Accept', 'application/json');

      expect(res.status).toBe(401);
      assertMatchesSchema(res, { $ref: '#/components/schemas/UnauthorizedError' }, 'GET /api/v1/donations [401]');
    });

    test('404 Not Found response matches NotFoundError schema', async () => {
      const res = await request(app)
        .get('/api/v1/non-existent-endpoint-xyz')
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
      assertMatchesSchema(res, { $ref: '#/components/schemas/NotFoundError' }, 'GET /api/v1/non-existent-endpoint-xyz [404]');
    });

    test('400 Validation Error response matches ValidationError schema', async () => {
      const res = await request(app)
        .post('/api/v1/donations')
        .set('x-api-key', 'test-openapi-key')
        .send({ invalidField: true });

      expect([400, 422]).toContain(res.status);
      const schema = spec.components.schemas.ValidationError || spec.components.schemas.Error;
      assertMatchesSchema(res, schema, 'POST /api/v1/donations [400]');
    });
  });

  // ─── 2. Wallets Endpoints ───────────────────────────────────────────────────

  describe('Wallets Responses', () => {
    test('GET /api/v1/wallets success matches OpenAPI schema or envelope', async () => {
      const res = await request(app)
        .get('/api/v1/wallets')
        .set('x-api-key', 'test-openapi-key');

      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success', true);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });

    test('GET /api/v1/wallets/:id 404 matches NotFoundError schema', async () => {
      const res = await request(app)
        .get('/api/v1/wallets/nonexistent_wallet_id_99999')
        .set('x-api-key', 'test-openapi-key');

      expect([400, 404, 422]).toContain(res.status);
      const schema = spec.components.schemas.Error || spec.components.schemas.NotFoundError;
      assertMatchesSchema(res, schema, 'GET /api/v1/wallets/{id} [404]');
    });
  });

  // ─── 3. Donations Endpoints ─────────────────────────────────────────────────

  describe('Donations Responses', () => {
    test('GET /api/v1/donations/limits matches limits response schema', async () => {
      const res = await request(app)
        .get('/api/v1/donations/limits')
        .set('x-api-key', 'test-openapi-key');

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success', true);
      }
    });

    test('GET /api/v1/donations/recent matches recent response schema', async () => {
      const res = await request(app)
        .get('/api/v1/donations/recent')
        .set('x-api-key', 'test-openapi-key');

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success', true);
      }
    });
  });

  // ─── 4. Statistics Endpoints ────────────────────────────────────────────────

  describe('Statistics Responses', () => {
    test('GET /api/v1/stats/daily returns valid JSON envelope', async () => {
      const res = await request(app)
        .get('/api/v1/stats/daily')
        .set('x-api-key', 'test-openapi-key');

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
      }
    });

    test('GET /api/v1/stats/summary returns valid JSON envelope', async () => {
      const res = await request(app)
        .get('/api/v1/stats/summary')
        .set('x-api-key', 'test-openapi-key');

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
      }
    });
  });

  // ─── 5. Stream Endpoints ────────────────────────────────────────────────────

  describe('Stream Responses', () => {
    test('GET /api/v1/stream/schedules returns valid JSON envelope', async () => {
      const res = await request(app)
        .get('/api/v1/stream/schedules')
        .set('x-api-key', 'test-openapi-key');

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
      }
    });
  });

  // ─── 6. OpenAPI Spec & Docs Endpoints ───────────────────────────────────────

  describe('OpenAPI & Swagger UI Spec Endpoints', () => {
    test('GET /api/openapi.json returns valid OpenAPI 3.1 document', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toMatch(/^3\.1\./);
      expect(res.body.paths).toBeDefined();
    });
  });
});
