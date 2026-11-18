/**
 * Tests: response compression is actually mounted (#1579)
 *
 * The compression middleware already existed but nothing required it, so no
 * response was ever compressed. These tests assert the wiring — that a large
 * JSON body comes back encoded when the client advertises support, that the
 * payload still decodes to the same object, and that clients which ask for
 * nothing are unaffected.
 */

'use strict';

const zlib = require('zlib');
const express = require('express');
const request = require('supertest');
const { createCompressionMiddleware } = require('../../src/middleware/compression');

// Comfortably above the 1024-byte default threshold.
const BIG_BODY = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `donation-${i}` })) };
const SMALL_BODY = { ok: true };

/** Reads the response as raw bytes: superagent only auto-decodes gzip, not brotli. */
function raw(req) {
  return req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

function buildApp() {
  const app = express();
  app.use(createCompressionMiddleware());
  app.get('/big', (req, res) => res.json(BIG_BODY));
  app.get('/small', (req, res) => res.json(SMALL_BODY));
  return app;
}

describe('response compression middleware', () => {
  const app = buildApp();

  it('gzips a large body when the client accepts gzip', async () => {
    const res = await request(app).get('/big').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('prefers brotli when the client accepts both', async () => {
    const res = await raw(request(app).get('/big').set('Accept-Encoding', 'gzip, br'));
    expect(res.headers['content-encoding']).toBe('br');
    expect(JSON.parse(zlib.brotliDecompressSync(res.body).toString())).toEqual(BIG_BODY);
  });

  it('gzip output round-trips to the identical object', async () => {
    const res = await request(app).get('/big').set('Accept-Encoding', 'gzip');
    // superagent transparently gunzips, so a matching body proves the payload
    // was valid gzip and lost nothing.
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body).toEqual(BIG_BODY);
  });

  it('actually shrinks the payload', async () => {
    // Measured on the brotli response: superagent transparently gunzips, so a
    // gzip response cannot be sized on the wire from here.
    const res = await raw(request(app).get('/big').set('Accept-Encoding', 'br'));
    expect(res.body.length).toBeLessThan(JSON.stringify(BIG_BODY).length);
  });

  it('leaves the response alone when no encoding is accepted', async () => {
    const res = await request(app).get('/big').set('Accept-Encoding', 'identity');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toEqual(BIG_BODY);
  });

  it('does not compress a body below the threshold', async () => {
    const res = await request(app).get('/small').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toEqual(SMALL_BODY);
  });
});

describe('middleware bootstrap wiring', () => {
  it('mounts compression before deduplication and field filtering', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/bootstrap/middleware.js'),
      'utf8'
    );
    const compression = source.indexOf('app.use(createCompressionMiddleware())');
    const dedup = source.indexOf('app.use(createDeduplicationMiddleware())');
    const fieldFilter = source.indexOf('app.use(fieldFilterMiddleware())');
    expect(compression).toBeGreaterThan(-1);
    // Installed first means it runs last, so it sees the final body.
    expect(compression).toBeLessThan(dedup);
    expect(compression).toBeLessThan(fieldFilter);
  });
});
