const express = require('express');
const request = require('supertest');
const { validateSchema } = require('../../src/middleware/schemaValidation');
const schemaRegistry = require('../../src/middleware/schemaRegistry');
const { ERROR_CODES } = require('../../src/utils/errors');

describe('Request Body Schema Versioning', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Clear registry before each test if possible, or just use unique keys
    schemaRegistry.registry.clear();
  });

  const v1 = {
    body: {
      fields: {
        amount: { type: 'number', required: true },
        recipient: { type: 'string', required: true }
      }
    }
  };

  const v2 = {
    body: {
      fields: {
        amount: { type: 'number', required: true },
        recipient: { type: 'string', required: true },
        currency: { type: 'string', required: true, enum: ['XLM', 'USDC'] }
      }
    }
  };

  test('uses latest version by default', async () => {
    app.post('/test-default', validateSchema('testSchema', { '1.0.0': v1, '2.0.0': v2 }), (req, res) => {
      res.status(200).json({ success: true, version: res.get('X-Schema-Version') });
    });

    const response = await request(app)
      .post('/test-default')
      .send({ amount: 10, recipient: 'ALICE', currency: 'XLM' });

    expect(response.status).toBe(200);
    expect(response.get('X-Schema-Version')).toBe('2.0.0');
    expect(response.get('X-Schema-Version-Supported')).toBe('2.0.0, 1.0.0');
  });

  test('uses requested version via X-Schema-Version', async () => {
    app.post('/test-version', validateSchema('testSchema', { '1.0.0': v1, '2.0.0': v2 }), (req, res) => {
      res.status(200).json({ success: true, version: res.get('X-Schema-Version') });
    });

    const response = await request(app)
      .post('/test-version')
      .set('X-Schema-Version', '1.0.0')
      .send({ amount: 10, recipient: 'ALICE' });

    expect(response.status).toBe(200);
    expect(response.get('X-Schema-Version')).toBe('1.0.0');
    // Version 1.0.0 shouldn't require currency
  });

  test('rejects unsupported version with 400', async () => {
    app.post('/test-unsupported', validateSchema('testSchema', { '1.0.0': v1 }), (req, res) => {
      res.status(200).json({ success: true });
    });

    const response = await request(app)
      .post('/test-unsupported')
      .set('X-Schema-Version', '3.0.0')
      .send({ amount: 10, recipient: 'ALICE' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.INVALID_SCHEMA_VERSION.code);
    expect(response.body.error.supportedVersions).toContain('1.0.0');
    expect(response.body.error.migrationGuide).toBeDefined();
  });

  test('provides deprecation warnings for old versions', async () => {
    const migrationGuide = 'Upgrade to 2.0.0 for currency support';
    app.post('/test-deprecated', 
      validateSchema('testSchema', 
        { '1.0.0': v1, '2.0.0': v2 }, 
        { deprecated: ['1.0.0'], migrationGuides: { '1.0.0': migrationGuide } }
      ), 
      (req, res) => {
        res.status(200).json({ success: true });
    });

    const response = await request(app)
      .post('/test-deprecated')
      .set('X-Schema-Version', '1.0.0')
      .send({ amount: 10, recipient: 'ALICE' });

    expect(response.status).toBe(200);
    expect(response.get('X-Schema-Deprecated')).toBe('true');
    expect(response.get('X-Schema-Migration-Guide')).toBe(migrationGuide);
    expect(response.get('Warning')).toContain(migrationGuide);
  });

  test('includes migration guide in validation error for deprecated versions', async () => {
    const migrationGuide = 'Upgrade to 2.0.0 for currency support';
    app.post('/test-deprecated-error', 
      validateSchema('testSchema', 
        { '1.0.0': v1, '2.0.0': v2 }, 
        { deprecated: ['1.0.0'], migrationGuides: { '1.0.0': migrationGuide } }
      ), 
      (req, res) => {
        res.status(200).json({ success: true });
    });

    // Send invalid payload for version 1.0.0
    const response = await request(app)
      .post('/test-deprecated-error')
      .set('X-Schema-Version', '1.0.0')
      .send({ amount: 'invalid' }); // recipient missing and amount wrong type

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR.code);
    expect(response.body.error.migrationGuide).toBe(migrationGuide);
    expect(response.get('X-Schema-Deprecated')).toBe('true');
  });

  test('maintains backward compatibility with legacy single schema objects', async () => {
    app.post('/legacy', validateSchema(v1), (req, res) => {
      res.status(200).json({ success: true });
    });

    const response = await request(app)
      .post('/legacy')
      .send({ amount: 10, recipient: 'ALICE' });

    expect(response.status).toBe(200);
    expect(response.get('X-Schema-Version')).toBeUndefined();
  });

  test('handles edge case: empty registry key', async () => {
    app.post('/edge-case', validateSchema('nonExistent'), (req, res) => {
      res.status(200).json({ success: true });
    });

    const response = await request(app)
      .post('/edge-case')
      .send({ amount: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(ERROR_CODES.INVALID_SCHEMA_VERSION.code);
  });
});
