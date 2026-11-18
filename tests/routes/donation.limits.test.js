'use strict';

/**
 * Tests for the /donations/limits endpoint caching behaviour.
 *
 * Extracted from the legacy issue bundle `tests/issues-764-765-766-767.test.js`
 * (issue #767) and renamed to follow docs/TEST_NAMING_CONVENTION.md.
 */

const request = require('supertest');

// Mock the donation service so the route can be exercised in isolation.
jest.mock('../../src/services/DonationService', () => ({
  getLimits: jest.fn(),
}));

const DonationService = require('../../src/services/DonationService');
const app = require('../../src/app');

describe('/donations/limits caching (issue #767)', () => {
  const limitsPayload = {
    min: 1,
    max: 10000,
    currency: 'XLM',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    DonationService.getLimits.mockResolvedValue(limitsPayload);
  });

  it('responds with the donation limits', async () => {
    const res = await request(app).get('/donations/limits');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(limitsPayload);
    expect(DonationService.getLimits).toHaveBeenCalledTimes(1);
  });

  it('sets a Cache-Control header on the response', async () => {
    const res = await request(app).get('/donations/limits');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeDefined();
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('sets an ETag header on the response', async () => {
    const res = await request(app).get('/donations/limits');

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
  });

  it('returns 304 when the request ETag matches the response ETag', async () => {
    const first = await request(app).get('/donations/limits');

    expect(first.status).toBe(200);
    expect(first.headers.etag).toBeDefined();

    const second = await request(app)
      .get('/donations/limits')
      .set('If-None-Match', first.headers.etag);

    expect(second.status).toBe(304);
    expect(second.text).toBeFalsy();
  });

  it('returns 200 with a body when the request ETag does not match', async () => {
    const res = await request(app)
      .get('/donations/limits')
      .set('If-None-Match', '"non-matching-etag"');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(limitsPayload);
  });

  it('propagates service errors as a 500 response', async () => {
    DonationService.getLimits.mockRejectedValueOnce(new Error('boom'));

    const res = await request(app).get('/donations/limits');

    expect(res.status).toBe(500);
  });
});