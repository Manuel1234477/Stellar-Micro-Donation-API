'use strict';

/**
 * Corporate matching routes — merged coverage.
 *
 * This suite consolidates the former root-level
 * `tests/corporate-matching-extended.test.js` with the base corporate
 * matching route tests. It exercises the corporate matching endpoints
 * (creating matches, listing matches, and match status transitions).
 */

const request = require('supertest');

// ---------------------------------------------------------------------------
// Module mocks (must be declared before requiring the app)
// ---------------------------------------------------------------------------

jest.mock('../../src/services/corporateMatchingService', () => ({
  createMatch: jest.fn(),
  listMatches: jest.fn(),
  getMatch: jest.fn(),
  updateMatchStatus: jest.fn(),
  deleteMatch: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'admin' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const corporateMatchingService = require('../../src/services/corporateMatchingService');
const app = require('../../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validMatchPayload = () => ({
  donorId: 'donor-1',
  companyId: 'company-1',
  donationId: 'donation-1',
  amount: 500,
  currency: 'USD',
  ratio: 1,
});

const sampleMatch = (overrides = {}) => ({
  id: 'match-1',
  donorId: 'donor-1',
  companyId: 'company-1',
  donationId: 'donation-1',
  amount: 500,
  currency: 'USD',
  ratio: 1,
  status: 'pending',
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /corporate-matching  (create)
// ---------------------------------------------------------------------------

describe('POST /corporate-matching', () => {
  it('creates a corporate match and returns 201', async () => {
    const payload = validMatchPayload();
    const created = sampleMatch();
    corporateMatchingService.createMatch.mockResolvedValue(created);

    const res = await request(app)
      .post('/corporate-matching')
      .send(payload)
      .expect(201);

    expect(corporateMatchingService.createMatch).toHaveBeenCalledTimes(1);
    expect(corporateMatchingService.createMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        donorId: payload.donorId,
        companyId: payload.companyId,
        donationId: payload.donationId,
        amount: payload.amount,
      })
    );
    expect(res.body).toEqual(expect.objectContaining({ id: 'match-1' }));
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/corporate-matching')
      .send({ amount: 500 })
      .expect(400);

    expect(corporateMatchingService.createMatch).not.toHaveBeenCalled();
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when amount is not a positive number', async () => {
    const res = await request(app)
      .post('/corporate-matching')
      .send({ ...validMatchPayload(), amount: -10 })
      .expect(400);

    expect(corporateMatchingService.createMatch).not.toHaveBeenCalled();
  });

  it('returns 400 when ratio is not a positive number', async () => {
    const res = await request(app)
      .post('/corporate-matching')
      .send({ ...validMatchPayload(), ratio: 0 })
      .expect(400);

    expect(corporateMatchingService.createMatch).not.toHaveBeenCalled();
  });

  it('propagates service errors as 500', async () => {
    corporateMatchingService.createMatch.mockRejectedValue(
      new Error('db failure')
    );

    const res = await request(app)
      .post('/corporate-matching')
      .send(validMatchPayload())
      .expect(500);

    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /corporate-matching  (list)
// ---------------------------------------------------------------------------

describe('GET /corporate-matching', () => {
  it('returns a list of matches', async () => {
    const matches = [sampleMatch(), sampleMatch({ id: 'match-2' })];
    corporateMatchingService.listMatches.mockResolvedValue(matches);

    const res = await request(app).get('/corporate-matching').expect(200);

    expect(corporateMatchingService.listMatches).toHaveBeenCalledTimes(1);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('passes filter query params to the service', async () => {
    corporateMatchingService.listMatches.mockResolvedValue([]);

    await request(app)
      .get('/corporate-matching')
      .query({ companyId: 'company-1', status: 'pending' })
      .expect(200);

    expect(corporateMatchingService.listMatches).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', status: 'pending' })
    );
  });

  it('returns an empty array when there are no matches', async () => {
    corporateMatchingService.listMatches.mockResolvedValue([]);

    const res = await request(app).get('/corporate-matching').expect(200);

    expect(res.body).toEqual([]);
  });

  it('propagates service errors as 500', async () => {
    corporateMatchingService.listMatches.mockRejectedValue(
      new Error('db failure')
    );

    await request(app).get('/corporate-matching').expect(500);
  });
});

// ---------------------------------------------------------------------------
// GET /corporate-matching/:id  (single)
// ---------------------------------------------------------------------------

describe('GET /corporate-matching/:id', () => {
  it('returns the requested match', async () => {
    corporateMatchingService.getMatch.mockResolvedValue(sampleMatch());

    const res = await request(app)
      .get('/corporate-matching/match-1')
      .expect(200);

    expect(corporateMatchingService.getMatch).toHaveBeenCalledWith('match-1');
    expect(res.body).toEqual(expect.objectContaining({ id: 'match-1' }));
  });

  it('returns 404 when the match does not exist', async () => {
    corporateMatchingService.getMatch.mockResolvedValue(null);

    await request(app).get('/corporate-matching/missing').expect(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /corporate-matching/:id/status  (status transitions)
// ---------------------------------------------------------------------------

describe('PATCH /corporate-matching/:id/status', () => {
  it('updates the match status', async () => {
    corporateMatchingService.updateMatchStatus.mockResolvedValue(
      sampleMatch({ status: 'approved' })
    );

    const res = await request(app)
      .patch('/corporate-matching/match-1/status')
      .send({ status: 'approved' })
      .expect(200);

    expect(corporateMatchingService.updateMatchStatus).toHaveBeenCalledWith(
      'match-1',
      'approved'
    );
    expect(res.body).toEqual(expect.objectContaining({ status: 'approved' }));
  });

  it('returns 400 for an invalid status value', async () => {
    const res = await request(app)
      .patch('/corporate-matching/match-1/status')
      .send({ status: 'not-a-status' })
      .expect(400);

    expect(corporateMatchingService.updateMatchStatus).not.toHaveBeenCalled();
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when updating a missing match', async () => {
    corporateMatchingService.updateMatchStatus.mockResolvedValue(null);

    await request(app)
      .patch('/corporate-matching/missing/status')
      .send({ status: 'approved' })
      .expect(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /corporate-matching/:id
// ---------------------------------------------------------------------------

describe('DELETE /corporate-matching/:id', () => {
  it('deletes a match and returns 204', async () => {
    corporateMatchingService.deleteMatch.mockResolvedValue(true);

    await request(app).delete('/corporate-matching/match-1').expect(204);

    expect(corporateMatchingService.deleteMatch).toHaveBeenCalledWith(
      'match-1'
    );
  });

  it('returns 404 when deleting a missing match', async () => {
    corporateMatchingService.deleteMatch.mockResolvedValue(false);

    await request(app).delete('/corporate-matching/missing').expect(404);
  });
});