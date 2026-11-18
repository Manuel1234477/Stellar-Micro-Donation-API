'use strict';

const express = require('express');
const request = require('supertest');
const { validateSchema } = require('../../src/middleware/schemaValidation');
const schemaRegistry = require('../../src/middleware/schemaRegistry');
const schemaVersionMiddleware = require('../../src/middleware/schemaVersion');
const {
  normaliseSchemaVersion,
  transformRequestBody,
  SCHEMA_TRANSFORMATIONS,
  CURRENT_SCHEMA_VERSION
} = require('../../src/middleware/schemaVersion');
const { applyTransformations, TRANSFORMATION_TABLE } = require('../../src/middleware/schemaRegistry');
const { ERROR_CODES } = require('../../src/utils/errors');

// ─── Shared schema fixtures ───────────────────────────────────────────────────

const v1 = {
  body: {
    fields: {
      amount:    { type: 'number', required: true },
      recipient: { type: 'string', required: true }
    }
  }
};

const v2 = {
  body: {
    fields: {
      amount:    { type: 'number', required: true },
      recipient: { type: 'string', required: true },
      currency:  { type: 'string', required: true, enum: ['XLM', 'USDC'] }
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. transformRequestBody — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('transformRequestBody', () => {
  test('renames donor_name to donorName (v1.0.0 → v2.0.0)', () => {
    const body = { donor_name: 'Alice', amount: 10, recipient: 'GXXX' };
    const result = transformRequestBody(body, '1.0.0', '2.0.0');
    expect(result.donorName).toBe('Alice');
    expect(result).not.toHaveProperty('donor_name');
  });

  test('renames recipient_address to recipient (v1.0.0 → v2.0.0)', () => {
    const body = { recipient_address: 'GABC', amount: 5 };
    const result = transformRequestBody(body, '1.0.0', '2.0.0');
    expect(result.recipient).toBe('GABC');
    expect(result).not.toHaveProperty('recipient_address');
  });

  test('renames amount_xlm to amount (v1.0.0 → v2.0.0)', () => {
    const body = { amount_xlm: 25, recipient: 'GXXX' };
    const result = transformRequestBody(body, '1.0.0', '2.0.0');
    expect(result.amount).toBe(25);
    expect(result).not.toHaveProperty('amount_xlm');
  });

  test('adds default currency XLM when missing (v1.0.0 → v2.0.0)', () => {
    const body = { amount: 10, recipient: 'GXXX' };
    const result = transformRequestBody(body, '1.0.0', '2.0.0');
    expect(result.currency).toBe('XLM');
  });

  test('does NOT overwrite existing currency (v1.0.0 → v2.0.0)', () => {
    const body = { amount: 10, recipient: 'GXXX', currency: 'USDC' };
    const result = transformRequestBody(body, '1.0.0', '2.0.0');
    expect(result.currency).toBe('USDC');
  });

  test('identity transform returns body unchanged (same version)', () => {
    const body = { amount: 10, recipient: 'GXXX', currency: 'XLM' };
    const result = transformRequestBody(body, '2.0.0', '2.0.0');
    expect(result).toEqual(body);
    // Should return the exact same reference for an identity transform
    expect(result).toBe(body);
  });

  test('unknown version pair returns body unchanged', () => {
    const body = { amount: 10, recipient: 'GXXX' };
    const result = transformRequestBody(body, '9.9.9', '10.0.0');
    expect(result).toEqual(body);
    expect(result).toBe(body);
  });

  test('does not mutate the original body', () => {
    const body = { donor_name: 'Bob', amount: 5 };
    const original = Object.assign({}, body);
    transformRequestBody(body, '1.0.0', '2.0.0');
    expect(body).toEqual(original);
  });

  test('handles null body gracefully', () => {
    expect(transformRequestBody(null, '1.0.0', '2.0.0')).toBeNull();
  });

  test('handles non-object body gracefully', () => {
    expect(transformRequestBody('string', '1.0.0', '2.0.0')).toBe('string');
  });

  test('applies v1.1.0 → v2.0.0 normalisation rules', () => {
    const body = { donor_name: 'Carol', amount_xlm: 50 };
    const result = transformRequestBody(body, '1.1.0', '2.0.0');
    expect(result.donorName).toBe('Carol');
    expect(result.amount).toBe(50);
    expect(result.currency).toBe('XLM');
    expect(result).not.toHaveProperty('donor_name');
    expect(result).not.toHaveProperty('amount_xlm');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SCHEMA_TRANSFORMATIONS — structure tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SCHEMA_TRANSFORMATIONS', () => {
  test('is correctly defined as an object', () => {
    expect(typeof SCHEMA_TRANSFORMATIONS).toBe('object');
    expect(SCHEMA_TRANSFORMATIONS).not.toBeNull();
  });

  test('contains a 1.0.0:2.0.0 key', () => {
    expect(SCHEMA_TRANSFORMATIONS).toHaveProperty('1.0.0:2.0.0');
    expect(Array.isArray(SCHEMA_TRANSFORMATIONS['1.0.0:2.0.0'])).toBe(true);
  });

  test('1.0.0:2.0.0 includes donor_name rename rule', () => {
    const rules = SCHEMA_TRANSFORMATIONS['1.0.0:2.0.0'];
    const rule = rules.find(r => r.field === 'donor_name');
    expect(rule).toBeDefined();
    expect(rule.action).toBe('rename');
    expect(rule.newField).toBe('donorName');
  });

  test('1.0.0:2.0.0 includes recipient_address rename rule', () => {
    const rules = SCHEMA_TRANSFORMATIONS['1.0.0:2.0.0'];
    const rule = rules.find(r => r.field === 'recipient_address');
    expect(rule).toBeDefined();
    expect(rule.action).toBe('rename');
    expect(rule.newField).toBe('recipient');
  });

  test('1.0.0:2.0.0 includes amount_xlm rename rule', () => {
    const rules = SCHEMA_TRANSFORMATIONS['1.0.0:2.0.0'];
    const rule = rules.find(r => r.field === 'amount_xlm');
    expect(rule).toBeDefined();
    expect(rule.action).toBe('rename');
    expect(rule.newField).toBe('amount');
  });

  test('1.0.0:2.0.0 includes currency default rule', () => {
    const rules = SCHEMA_TRANSFORMATIONS['1.0.0:2.0.0'];
    const rule = rules.find(r => r.field === 'currency' && r.action === 'default');
    expect(rule).toBeDefined();
    expect(rule.defaultValue).toBe('XLM');
  });

  test('contains a 1.1.0:2.0.0 key', () => {
    expect(SCHEMA_TRANSFORMATIONS).toHaveProperty('1.1.0:2.0.0');
    expect(Array.isArray(SCHEMA_TRANSFORMATIONS['1.1.0:2.0.0'])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CURRENT_SCHEMA_VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe('CURRENT_SCHEMA_VERSION', () => {
  test("is '2.0.0'", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('2.0.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. schemaVersionMiddleware — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('schemaVersionMiddleware', () => {
  function buildApp(extraMiddleware) {
    const app = express();
    app.use(express.json());
    app.use(schemaVersionMiddleware);
    if (extraMiddleware) app.use(extraMiddleware);
    app.post('/test', (req, res) => {
      res.json({
        schemaVersion:   req.schemaVersion,
        transformedBody: req.transformedBody || null
      });
    });
    return app;
  }

  test('sets req.schemaVersion from X-Schema-Version header', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/test')
      .set('X-Schema-Version', '1.0.0')
      .send({ amount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe('1.0.0');
  });

  test('defaults to 1.0.0 when header is absent', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/test')
      .send({ amount: 10 });

    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe('1.0.0');
  });

  test('sets req.transformedBody when version differs from current', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/test')
      .set('X-Schema-Version', '1.0.0')
      .send({ donor_name: 'Alice', amount_xlm: 15, recipient_address: 'GXXX' });

    expect(res.status).toBe(200);
    expect(res.body.transformedBody).not.toBeNull();
    expect(res.body.transformedBody.donorName).toBe('Alice');
    expect(res.body.transformedBody.amount).toBe(15);
    expect(res.body.transformedBody.recipient).toBe('GXXX');
    expect(res.body.transformedBody.currency).toBe('XLM');
  });

  test('does NOT set req.transformedBody when version equals current', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/test')
      .set('X-Schema-Version', '2.0.0')
      .send({ amount: 10, recipient: 'GXXX', currency: 'XLM' });

    expect(res.status).toBe(200);
    expect(res.body.transformedBody).toBeNull();
  });

  test('normalises integer version "1" to "1.0.0"', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/test')
      .set('X-Schema-Version', '1')
      .send({});

    expect(res.body.schemaVersion).toBe('1.0.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. applyTransformations (schemaRegistry)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyTransformations (schemaRegistry)', () => {
  test('renames public_key to publicKey for createWallet v1→v2', () => {
    const body = { public_key: 'GABCD', memo: 'my wallet' };
    const result = applyTransformations(body, '1.0.0', '2.0.0', 'createWallet');
    expect(result.publicKey).toBe('GABCD');
    expect(result).not.toHaveProperty('public_key');
    expect(result.memo).toBe('my wallet');
  });

  test('identity: returns body unchanged when versions are equal', () => {
    const body = { publicKey: 'GABCD', memo: 'test' };
    const result = applyTransformations(body, '2.0.0', '2.0.0', 'createWallet');
    expect(result).toBe(body);
  });

  test('returns body unchanged when no table entry exists', () => {
    const body = { amount: 10 };
    const result = applyTransformations(body, '9.0.0', '10.0.0', 'createDonation');
    expect(result).toBe(body);
  });

  test('does not mutate the original body', () => {
    const body = { public_key: 'GABCD' };
    const original = Object.assign({}, body);
    applyTransformations(body, '1.0.0', '2.0.0', 'createWallet');
    expect(body).toEqual(original);
  });

  test('handles null body gracefully', () => {
    expect(applyTransformations(null, '1.0.0', '2.0.0', 'createWallet')).toBeNull();
  });

  test('applies createDonation rename rules from table', () => {
    const body = { donor_name: 'Dave', amount_xlm: 7, recipient_address: 'GYYY' };
    const result = applyTransformations(body, '1.0.0', '2.0.0', 'createDonation');
    expect(result.donorName).toBe('Dave');
    expect(result.amount).toBe(7);
    expect(result.recipient).toBe('GYYY');
    expect(result.currency).toBe('XLM');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TRANSFORMATION_TABLE (schemaRegistry) — structure tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TRANSFORMATION_TABLE', () => {
  test('is correctly defined as an object', () => {
    expect(typeof TRANSFORMATION_TABLE).toBe('object');
    expect(TRANSFORMATION_TABLE).not.toBeNull();
  });

  test('contains createDonation:1.0.0:2.0.0 entry', () => {
    expect(TRANSFORMATION_TABLE).toHaveProperty('createDonation:1.0.0:2.0.0');
    const entry = TRANSFORMATION_TABLE['createDonation:1.0.0:2.0.0'];
    expect(entry.from).toBe('1.0.0');
    expect(entry.to).toBe('2.0.0');
    expect(Array.isArray(entry.transforms)).toBe(true);
  });

  test('contains createWallet:1.0.0:2.0.0 entry', () => {
    expect(TRANSFORMATION_TABLE).toHaveProperty('createWallet:1.0.0:2.0.0');
    const entry = TRANSFORMATION_TABLE['createWallet:1.0.0:2.0.0'];
    expect(entry.from).toBe('1.0.0');
    expect(entry.to).toBe('2.0.0');
    expect(Array.isArray(entry.transforms)).toBe(true);
  });

  test('createWallet entry has public_key→publicKey rename rule', () => {
    const { transforms } = TRANSFORMATION_TABLE['createWallet:1.0.0:2.0.0'];
    const rule = transforms.find(r => r.field === 'public_key');
    expect(rule).toBeDefined();
    expect(rule.action).toBe('rename');
    expect(rule.newField).toBe('publicKey');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. X-Schema-Version response header (via validateSchema / schemaRegistry)
// ─────────────────────────────────────────────────────────────────────────────

describe('X-Schema-Version response header', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    schemaRegistry.registry.clear();
  });

  test('response includes X-Schema-Version header equal to resolved version', async () => {
    app.post('/hdr', validateSchema('hdrSchema', { '1.0.0': v1, '2.0.0': v2 }), (req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app)
      .post('/hdr')
      .set('X-Schema-Version', '1.0.0')
      .send({ amount: 10, recipient: 'ALICE' });

    expect(res.status).toBe(200);
    expect(res.get('X-Schema-Version')).toBe('1.0.0');
  });

  test('response X-Schema-Version defaults to latest when header omitted', async () => {
    app.post('/hdr-default', validateSchema('hdrDefaultSchema', { '1.0.0': v1, '2.0.0': v2 }), (req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app)
      .post('/hdr-default')
      .send({ amount: 10, recipient: 'ALICE', currency: 'XLM' });

    expect(res.status).toBe(200);
    expect(res.get('X-Schema-Version')).toBe('2.0.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Backward-compatibility tests (preserved from original test suite)
// ─────────────────────────────────────────────────────────────────────────────

describe('Request Body Schema Versioning (backward compatibility)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    schemaRegistry.registry.clear();
  });

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
