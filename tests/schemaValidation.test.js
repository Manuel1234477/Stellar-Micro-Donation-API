const express = require('express');
const request = require('supertest');
const { validateSchema } = require('../src/middleware/schemaValidation');

describe('Strict Schema Validation', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.post(
      '/strict-donation',
      validateSchema({
        body: {
          fields: {
            amount: { type: 'number', required: true, min: 0.0000001 },
            recipient: { type: 'string', required: true, minLength: 1 },
          },
        },
      }),
      (req, res) => {
        res.status(201).json({ success: true });
      },
    );

    app.get(
      '/strict-query',
      validateSchema({
        query: {
          fields: {
            limit: { type: 'integerString', required: false },
          },
        },
      }),
      (req, res) => {
        res.status(200).json({ success: true });
      },
    );
  });

  test('rejects unknown body fields', async () => {
    const response = await request(app)
      .post('/strict-donation')
      .send({
        amount: 10,
        recipient: 'GALICE',
        unexpected: 'field',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Schema validation failed');
    expect(response.body.error.details[0].message).toContain('Unknown field');
  });

  test('rejects implicit type coercion for body numbers', async () => {
    const response = await request(app)
      .post('/strict-donation')
      .send({
        amount: '10',
        recipient: 'GALICE',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].path).toBe('body.amount');
  });

  test('accepts valid strict payload', async () => {
    const response = await request(app)
      .post('/strict-donation')
      .send({
        amount: 10,
        recipient: 'GALICE',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });

  test('rejects unknown query fields', async () => {
    const response = await request(app)
      .get('/strict-query')
      .query({ limit: '10', extra: 'x' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].message).toContain('Unknown field');
  });
});
