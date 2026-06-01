'use strict';

const express = require('express');
const request = require('supertest');
const { validateSchema } = require('../../src/middleware/schemaValidation');

function makeApp(schema) {
  const app = express();
  app.use(express.json());
  app.post('/test', validateSchema(schema), (req, res) => {
    res.json({ body: req.body });
  });
  return app;
}

const baseSchema = {
  body: {
    fields: {
      name: { type: 'string', required: true },
      amount: { type: 'number', required: true },
    },
  },
};

describe('schemaValidation - unknown field stripping', () => {
  test('strips unknown fields from req.body after validation', async () => {
    const app = makeApp(baseSchema);
    const res = await request(app)
      .post('/test')
      .send({ name: 'Alice', amount: 10, role: 'admin', extra: 'bad' });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'Alice', amount: 10 });
    expect(res.body.body).not.toHaveProperty('role');
    expect(res.body.body).not.toHaveProperty('extra');
  });

  test('preserves all known fields', async () => {
    const app = makeApp(baseSchema);
    const res = await request(app)
      .post('/test')
      .send({ name: 'Bob', amount: 5 });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'Bob', amount: 5 });
  });

  test('allowUnknown:true preserves unknown fields', async () => {
    const schema = {
      body: {
        allowUnknown: true,
        fields: {
          name: { type: 'string', required: true },
        },
      },
    };
    const app = makeApp(schema);
    const res = await request(app)
      .post('/test')
      .send({ name: 'Carol', metadata: { foo: 'bar' }, extra: 42 });

    expect(res.status).toBe(200);
    expect(res.body.body).toHaveProperty('name', 'Carol');
    expect(res.body.body).toHaveProperty('metadata');
    expect(res.body.body).toHaveProperty('extra', 42);
  });

  test('strips unknown fields recursively from nested objects', async () => {
    const schema = {
      body: {
        fields: {
          name: { type: 'string', required: true },
          address: {
            type: 'object',
            required: true,
            fields: {
              city: { type: 'string', required: true },
            },
          },
        },
      },
    };
    const app = makeApp(schema);
    const res = await request(app)
      .post('/test')
      .send({ name: 'Dave', address: { city: 'NYC', country: 'US', zip: '10001' } });

    expect(res.status).toBe(200);
    expect(res.body.body.address).toEqual({ city: 'NYC' });
    expect(res.body.body.address).not.toHaveProperty('country');
    expect(res.body.body.address).not.toHaveProperty('zip');
  });

  test('unknown fields are stripped even when other optional fields are absent', async () => {
    const schema = {
      body: {
        fields: {
          name: { type: 'string', required: true },
          note: { type: 'string' }, // optional
        },
      },
    };
    const app = makeApp(schema);
    const res = await request(app)
      .post('/test')
      .send({ name: 'Eve', role: 'admin', injected: true });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'Eve' });
    expect(res.body.body).not.toHaveProperty('role');
    expect(res.body.body).not.toHaveProperty('injected');
  });
});
