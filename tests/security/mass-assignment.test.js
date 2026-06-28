'use strict';

/**
 * Mass-Assignment Protection Tests
 *
 * Verifies that protected fields (status, role, apiKeyId, createdAt, verified, publicKey)
 * cannot be injected into persisted records through PATCH/PUT endpoints.
 *
 * Two layers of protection are tested:
 *   1. validatePayloadFields (global middleware) — REJECTS unknown fields with 400 for
 *      routes registered in ROUTE_ALLOWED_FIELDS.
 *   2. validateSchema (per-route middleware) — STRIPS unknown fields from req.body before
 *      the handler sees them, so they are never passed to the database layer.
 */

const request = require('supertest');
const express = require('express');
const { validatePayloadFields } = require('../../src/middleware/validation');
const { validateSchema } = require('../../src/middleware/schemaValidation');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app that:
 *   1. Applies the provided schema middleware (which strips unknown fields).
 *   2. Echoes req.body back so tests can inspect what reached the handler.
 */
function buildSchemaApp(method, path, schemaMiddleware) {
  const app = express();
  app.use(express.json());
  app[method](path, schemaMiddleware, (req, res) => {
    res.json({ success: true, received: req.body });
  });
  return app;
}

/**
 * Build a minimal Express app that applies the global validatePayloadFields
 * middleware (which rejects unknown fields with 400 for registered routes).
 */
function buildPayloadFieldApp() {
  const app = express();
  app.use(express.json());
  app.use(validatePayloadFields);

  app.patch('/api/v1/wallets/:id', (req, res) => res.json({ success: true }));
  app.patch('/api/v1/donations/:id/status', (req, res) => res.json({ success: true }));
  app.post('/api/v1/wallets', (req, res) => res.status(201).json({ success: true }));
  app.post('/api/v1/donations', (req, res) => res.status(201).json({ success: true }));
  app.post('/api/v1/api-keys', (req, res) => res.status(201).json({ success: true }));

  return app;
}

// ─── Protected field sets ──────────────────────────────────────────────────────

const PROTECTED_FIELDS = {
  status: 'verified',
  role: 'admin',
  apiKeyId: 'key-999',
  createdAt: '2000-01-01T00:00:00.000Z',
  verified: true,
  publicKey: 'GMALICIOUS0000000000000000000000000000000000000000000000',
};

// ─── Layer 1: validatePayloadFields (REJECTION) ────────────────────────────────

describe('Mass-Assignment — validatePayloadFields (reject unknown fields)', () => {
  let app;

  beforeAll(() => {
    app = buildPayloadFieldApp();
  });

  describe('PATCH /wallets/:id', () => {
    const allowed = { label: 'Legit Label', ownerName: 'Alice' };

    it('accepts a valid wallet update payload', async () => {
      const res = await request(app).patch('/api/v1/wallets/1').send(allowed);
      expect(res.status).toBe(200);
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'rejects payload containing protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/api/v1/wallets/1')
          .send({ ...allowed, [field]: value });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('UNKNOWN_FIELDS');
        expect(res.body.error.unknownFields).toContain(field);
      }
    );
  });

  describe('PATCH /donations/:id/status', () => {
    const allowed = { status: 'confirmed', stellarTxId: 'abc', ledger: 1000, notes: 'ok', tags: [] };

    it('accepts a valid donation status update payload', async () => {
      const res = await request(app).patch('/api/v1/donations/1/status').send(allowed);
      expect(res.status).toBe(200);
    });

    it.each([['role', 'admin'], ['apiKeyId', 'k1'], ['createdAt', '2000-01-01'], ['verified', true]])(
      'rejects payload containing protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/api/v1/donations/1/status')
          .send({ status: 'confirmed', [field]: value });

        expect(res.status).toBe(400);
        expect(res.body.error.unknownFields).toContain(field);
      }
    );
  });

  describe('POST /wallets', () => {
    it('rejects payload containing protected field "role"', async () => {
      const res = await request(app)
        .post('/api/v1/wallets')
        .send({ address: 'GXXX', label: 'Test', role: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.unknownFields).toContain('role');
    });
  });

  describe('POST /api-keys', () => {
    it('rejects payload containing protected field "apiKeyId"', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .send({ name: 'Key', role: 'user', apiKeyId: 'injected' });

      expect(res.status).toBe(400);
      expect(res.body.error.unknownFields).toContain('apiKeyId');
    });
  });
});

// ─── Layer 2: validateSchema (strip unknown fields) ───────────────────────────

describe('Mass-Assignment — validateSchema (strip unknown fields)', () => {

  describe('PATCH /wallets/:id — updateWalletSchema', () => {
    const updateWalletSchema = validateSchema({
      body: {
        fields: {
          label: { type: 'string', required: false, nullable: true, maxLength: 100 },
          ownerName: { type: 'string', required: false, nullable: true, maxLength: 200 },
        }
      }
    });
    const app = buildSchemaApp('patch', '/wallets/:id', updateWalletSchema);

    it('allows declared fields through to the handler', async () => {
      const res = await request(app)
        .patch('/wallets/1')
        .send({ label: 'New Label', ownerName: 'Bob' });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ label: 'New Label', ownerName: 'Bob' });
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s" before it reaches the handler',
      async (field, value) => {
        const res = await request(app)
          .patch('/wallets/1')
          .send({ label: 'New Label', [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
        expect(res.body.received.label).toBe('New Label');
      }
    );
  });

  describe('PATCH /wallets/:id/label — updateWalletLabelSchema', () => {
    const updateWalletLabelSchema = validateSchema({
      body: {
        fields: {
          label: { type: 'string', required: false, nullable: true, maxLength: 100 },
        }
      }
    });
    const app = buildSchemaApp('patch', '/wallets/:id/label', updateWalletLabelSchema);

    it('allows the label field through', async () => {
      const res = await request(app).patch('/wallets/1/label').send({ label: 'My Label' });
      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ label: 'My Label' });
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/wallets/1/label')
          .send({ label: 'Safe', [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
      }
    );
  });

  describe('PATCH /wallets/:id/limits — updateWalletLimitsSchema', () => {
    const updateWalletLimitsSchema = validateSchema({
      body: {
        fields: {
          daily_limit: { type: 'number', required: false, nullable: true },
          monthly_limit: { type: 'number', required: false, nullable: true },
          per_transaction_limit: { type: 'number', required: false, nullable: true },
        }
      }
    });
    const app = buildSchemaApp('patch', '/wallets/:id/limits', updateWalletLimitsSchema);

    it('allows limit fields through', async () => {
      const res = await request(app)
        .patch('/wallets/1/limits')
        .send({ daily_limit: 100, monthly_limit: 1000 });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ daily_limit: 100, monthly_limit: 1000 });
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/wallets/1/limits')
          .send({ daily_limit: 50, [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
        expect(res.body.received.daily_limit).toBe(50);
      }
    );
  });

  describe('PATCH /wallets/:id/leaderboard-visibility — updateLeaderboardVisibilitySchema', () => {
    const updateLeaderboardVisibilitySchema = validateSchema({
      body: {
        fields: {
          visible: { type: 'boolean', required: true },
        }
      }
    });
    const app = buildSchemaApp('patch', '/wallets/:id/leaderboard-visibility', updateLeaderboardVisibilitySchema);

    it('allows the visible field through', async () => {
      const res = await request(app)
        .patch('/wallets/1/leaderboard-visibility')
        .send({ visible: true });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ visible: true });
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/wallets/1/leaderboard-visibility')
          .send({ visible: false, [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
      }
    );
  });

  describe('PATCH /stream/schedules/:id — updateScheduleSchema', () => {
    const updateScheduleSchema = validateSchema({
      body: {
        fields: {
          amount: { types: ['number', 'numberString'], required: false },
          frequency: { type: 'string', required: false, enum: ['daily', 'weekly', 'monthly'] },
        }
      }
    });
    const app = buildSchemaApp('patch', '/stream/schedules/:id', updateScheduleSchema);

    it('allows amount and frequency through', async () => {
      const res = await request(app)
        .patch('/stream/schedules/1')
        .send({ amount: 10, frequency: 'weekly' });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ amount: 10, frequency: 'weekly' });
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/stream/schedules/1')
          .send({ amount: 5, [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
        expect(res.body.received.amount).toBe(5);
      }
    );
  });

  describe('PATCH /admin/webhooks/:id — updateWebhookStatusSchema', () => {
    const updateWebhookStatusSchema = validateSchema({
      body: {
        fields: {
          status: { type: 'string', required: true, enum: ['active', 'disabled'] },
        }
      }
    });
    const app = buildSchemaApp('patch', '/admin/webhooks/:id', updateWebhookStatusSchema);

    it('allows the status field through', async () => {
      const res = await request(app)
        .patch('/admin/webhooks/1')
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ status: 'active' });
    });

    it.each([['role', 'admin'], ['apiKeyId', 'k1'], ['createdAt', '2000-01-01'], ['verified', true]])(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/admin/webhooks/1')
          .send({ status: 'disabled', [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
      }
    );

    it('rejects an invalid status value', async () => {
      const res = await request(app)
        .patch('/admin/webhooks/1')
        .send({ status: 'superadmin' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /admin/geo-rules/:id — updateGeoRuleSchema', () => {
    const updateGeoRuleSchema = validateSchema({
      body: {
        fields: {
          active: { type: 'boolean', required: false },
          description: { type: 'string', required: false, nullable: true },
        }
      }
    });
    const app = buildSchemaApp('patch', '/admin/geo-rules/:id', updateGeoRuleSchema);

    it('allows active and description through', async () => {
      const res = await request(app)
        .patch('/admin/geo-rules/1')
        .send({ active: false, description: 'Updated rule' });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ active: false, description: 'Updated rule' });
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/admin/geo-rules/1')
          .send({ active: true, [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
      }
    );
  });

  describe('PATCH /admin/pledges/:id/cancel — cancelPledgeSchema', () => {
    const cancelPledgeSchema = validateSchema({
      body: {
        fields: {
          reason: { type: 'string', required: false, nullable: true },
        }
      }
    });
    const app = buildSchemaApp('patch', '/admin/pledges/:id/cancel', cancelPledgeSchema);

    it('allows an optional reason through', async () => {
      const res = await request(app)
        .patch('/admin/pledges/1/cancel')
        .send({ reason: 'Duplicate pledge' });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ reason: 'Duplicate pledge' });
    });

    it('accepts empty body (reason is optional)', async () => {
      const res = await request(app)
        .patch('/admin/pledges/1/cancel')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({});
    });

    it.each(Object.entries(PROTECTED_FIELDS))(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/admin/pledges/1/cancel')
          .send({ reason: 'Cancelled', [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
      }
    );
  });

  describe('Corporate matching status — updateStatusSchema', () => {
    const updateStatusSchema = validateSchema({
      body: {
        fields: {
          status: { type: 'string', required: true, enum: ['active', 'paused', 'exhausted'] }
        }
      }
    });
    const app = buildSchemaApp('patch', '/admin/corporate-matching/:id/status', updateStatusSchema);

    it('allows the status field through', async () => {
      const res = await request(app)
        .patch('/admin/corporate-matching/1/status')
        .send({ status: 'paused' });

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ status: 'paused' });
    });

    it.each([['role', 'admin'], ['apiKeyId', 'k1'], ['createdAt', '2000-01-01']])(
      'strips protected field "%s"',
      async (field, value) => {
        const res = await request(app)
          .patch('/admin/corporate-matching/1/status')
          .send({ status: 'active', [field]: value });

        expect(res.status).toBe(200);
        expect(res.body.received).not.toHaveProperty(field);
      }
    );
  });
});
