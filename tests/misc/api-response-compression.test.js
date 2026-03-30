/**
 * Tests for response compression middleware
 * Covers: gzip, brotli, threshold, skip logic, fallback, and integration via supertest
 */

const zlib = require('zlib');
const http = require('http');
const express = require('express');
const request = require('supertest');
const {
  createCompressionMiddleware,
  shouldSkip,
  selectEncoding,
} = require('../../src/middleware/compression');

// ---------------------------------------------------------------------------
// Unit tests — shouldSkip
// ---------------------------------------------------------------------------
describe('shouldSkip()', () => {
  test('returns false for application/json', () => {
    expect(shouldSkip('application/json')).toBe(false);
  });

  test('returns true for image/png', () => {
    expect(shouldSkip('image/png')).toBe(true);
  });

  test('returns true for application/pdf', () => {
    expect(shouldSkip('application/pdf')).toBe(true);
  });

  test('returns true for application/zip', () => {
    expect(shouldSkip('application/zip')).toBe(true);
  });

  test('returns true for video/mp4', () => {
    expect(shouldSkip('video/mp4')).toBe(true);
  });

  test('returns false for undefined / empty', () => {
    expect(shouldSkip(undefined)).toBe(false);
    expect(shouldSkip('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — selectEncoding
// ---------------------------------------------------------------------------
describe('selectEncoding()', () => {
  test('prefers br over gzip', () => {
    expect(selectEncoding('gzip, deflate, br')).toBe('br');
  });

  test('returns gzip when only gzip is listed', () => {
    expect(selectEncoding('gzip')).toBe('gzip');
  });

  test('returns null when no supported encoding', () => {
    expect(selectEncoding('deflate')).toBeNull();
    expect(selectEncoding('')).toBeNull();
    expect(selectEncoding(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express app with the compression middleware and a single route */
function buildApp(middlewareOptions, routeBody) {
  const app = express();
  app.use(createCompressionMiddleware(middlewareOptions));
  app.get('/test', (req, res) => res.json(routeBody));
  return app;
}

/** Generate a JSON-serialisable object whose serialised form exceeds `bytes` */
function largePayload(bytes = 2048) {
  return { data: 'x'.repeat(bytes) };
}

// ---------------------------------------------------------------------------
// Integration tests — gzip
// ---------------------------------------------------------------------------
/** Raw buffer parser — prevents supertest from auto-decompressing */
const rawParser = (res, callback) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

/**
 * Make a raw HTTP GET request that does NOT auto-decompress.
 * Returns { statusCode, headers, body: Buffer }
 */
function rawGet(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'GET',
      headers,
    };
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Compression middleware — gzip', () => {
  let server;
  beforeAll(done => {
    const app = buildApp({ threshold: 100, level: 6 }, largePayload(2048));
    server = app.listen(0, done);
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));

  test('compresses large response with gzip', async () => {
    const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');

    const parsed = JSON.parse(zlib.gunzipSync(res.body).toString());
    expect(parsed.data).toHaveLength(2048);
  });

  test('sets Content-Encoding: gzip header', async () => {
    const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — brotli
// ---------------------------------------------------------------------------
describe('Compression middleware — brotli', () => {
  let server;
  beforeAll(done => {
    const app = buildApp({ threshold: 100, level: 4 }, largePayload(2048));
    server = app.listen(0, done);
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));

  test('compresses large response with brotli', async () => {
    const res = await rawGet(server, '/test', { 'Accept-Encoding': 'br' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');

    const parsed = JSON.parse(zlib.brotliDecompressSync(res.body).toString());
    expect(parsed.data).toHaveLength(2048);
  });

  test('prefers brotli over gzip when both accepted', async () => {
    const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(res.headers['content-encoding']).toBe('br');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — threshold
// ---------------------------------------------------------------------------
describe('Compression middleware — threshold', () => {
  test('does not compress response below threshold', async () => {
    const app = buildApp({ threshold: 10000 }, { msg: 'small' });
    const server = app.listen(0);
    try {
      const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip' });
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(JSON.parse(res.body.toString())).toEqual({ msg: 'small' });
    } finally {
      server.close();
    }
  });

  test('compresses response exactly at threshold boundary', async () => {
    const payload = largePayload(200);
    const app = buildApp({ threshold: 100 }, payload);
    const server = app.listen(0);
    try {
      const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip' });
      expect(res.headers['content-encoding']).toBe('gzip');
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — no Accept-Encoding
// ---------------------------------------------------------------------------
describe('Compression middleware — no encoding requested', () => {
  test('passes through uncompressed when Accept-Encoding is absent', async () => {
    const app = buildApp({ threshold: 1 }, largePayload(2048));
    const server = app.listen(0);
    try {
      // No Accept-Encoding header at all
      const res = await rawGet(server, '/test', {});
      expect(res.headers['content-encoding']).toBeUndefined();
      const parsed = JSON.parse(res.body.toString());
      expect(parsed.data).toHaveLength(2048);
    } finally {
      server.close();
    }
  });

  test('passes through when only deflate is requested', async () => {
    const app = buildApp({ threshold: 1 }, largePayload(2048));
    const server = app.listen(0);
    try {
      const res = await rawGet(server, '/test', { 'Accept-Encoding': 'deflate' });
      expect(res.headers['content-encoding']).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — already-compressed content types
// ---------------------------------------------------------------------------
describe('Compression middleware — skip already-compressed types', () => {
  test('does not compress when route sets image content type', async () => {
    const app = express();
    app.use(createCompressionMiddleware({ threshold: 1 }));
    app.get('/img', (req, res) => {
      res.setHeader('Content-Type', 'image/png');
      res.json({ data: 'x'.repeat(2048) });
    });
    const server = app.listen(0);
    try {
      const res = await rawGet(server, '/img', { 'Accept-Encoding': 'gzip' });
      expect(res.headers['content-encoding']).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — compression level
// ---------------------------------------------------------------------------
describe('Compression middleware — configurable level', () => {
  test('level 1 produces valid gzip output', async () => {
    const app = buildApp({ threshold: 1, level: 1 }, largePayload(2048));
    const server = app.listen(0);
    try {
      const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip' });
      expect(res.headers['content-encoding']).toBe('gzip');
      const parsed = JSON.parse(zlib.gunzipSync(res.body).toString());
      expect(parsed.data).toHaveLength(2048);
    } finally {
      server.close();
    }
  });

  test('level 9 produces valid gzip output', async () => {
    const app = buildApp({ threshold: 1, level: 9 }, largePayload(2048));
    const server = app.listen(0);
    try {
      const res = await rawGet(server, '/test', { 'Accept-Encoding': 'gzip' });
      expect(res.headers['content-encoding']).toBe('gzip');
      const parsed = JSON.parse(zlib.gunzipSync(res.body).toString());
      expect(parsed.data).toHaveLength(2048);
    } finally {
      server.close();
    }
  });
});
