const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { createDeduplicationMiddleware } = require('../src/middleware/deduplication');

const app = express();
app.use(bodyParser.json());
app.use(createDeduplicationMiddleware({ ttlMs: 500 }));

app.post('/test', (req, res) => {
  res.status(201).json({ ok: true, body: req.body });
});
app.patch('/test', (req, res) => {
  res.status(200).json({ patched: true, body: req.body });
});
app.get('/test', (req, res) => {
  res.status(200).json({ get: true });
});

describe('Body Hash Deduplication Middleware', () => {
  it('deduplicates identical POST requests (same body, same API key)', async () => {
    const apiKey = 'key1';
    const body = { foo: 'bar', baz: 1 };
    const first = await request(app)
      .post('/test')
      .set('x-api-key', apiKey)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.headers['x-deduplicated']).toBeUndefined();

    const second = await request(app)
      .post('/test')
      .set('x-api-key', apiKey)
      .send({ baz: 1, foo: 'bar' }); // different order
    expect(second.status).toBe(201);
    expect(second.headers['x-deduplicated']).toBe('true');
    expect(second.body).toEqual(first.body);
  });

  it('does not deduplicate different API keys', async () => {
    const body = { foo: 'bar' };
    const first = await request(app)
      .post('/test')
      .set('x-api-key', 'keyA')
      .send(body);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/test')
      .set('x-api-key', 'keyB')
      .send(body);
    expect(second.status).toBe(201);
    expect(second.headers['x-deduplicated']).toBeUndefined();
  });

  it('deduplication window expiry allows new requests', async () => {
    const apiKey = 'key2';
    const body = { foo: 'baz' };
    await request(app).post('/test').set('x-api-key', apiKey).send(body);
    await new Promise(r => setTimeout(r, 600)); // wait for cache to expire
    const resp = await request(app).post('/test').set('x-api-key', apiKey).send(body);
    expect(resp.headers['x-deduplicated']).toBeUndefined();
  });

  it('never deduplicates GET requests', async () => {
    const apiKey = 'key3';
    const resp1 = await request(app).get('/test').set('x-api-key', apiKey);
    const resp2 = await request(app).get('/test').set('x-api-key', apiKey);
    expect(resp1.headers['x-deduplicated']).toBeUndefined();
    expect(resp2.headers['x-deduplicated']).toBeUndefined();
  });

  it('deduplicates PATCH requests', async () => {
    const apiKey = 'key4';
    const body = { a: 1 };
    const first = await request(app).patch('/test').set('x-api-key', apiKey).send(body);
    expect(first.status).toBe(200);
    const second = await request(app).patch('/test').set('x-api-key', apiKey).send(body);
    expect(second.headers['x-deduplicated']).toBe('true');
  });
});
