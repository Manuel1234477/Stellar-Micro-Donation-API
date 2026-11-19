'use strict';

const http = require('http');
const { startMetricsServer } = require('../../src/bootstrap/metricsServer');

const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
  }).on('error', reject);
});

describe('startMetricsServer (#1982)', () => {
  let server;
  let port;

  beforeAll(async () => {
    server = await startMetricsServer({ port: 0, host: '127.0.0.1' });
    port = server.address().port;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('serves /metrics without any application auth', async () => {
    const res = await get(port, '/metrics');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/plain/);
    expect(res.body).toContain('stream_connections_active');
  });

  test('answers 404 for every other path', async () => {
    expect((await get(port, '/health')).status).toBe(404);
    expect((await get(port, '/api/v1/donations')).status).toBe(404);
  });
});
