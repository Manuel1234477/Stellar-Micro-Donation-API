/**
 * Issue #1871: idempotent replays must reproduce the original status code and
 * headers, and records must be scoped per authenticated principal.
 */

const IdempotencyService = require('../../src/services/IdempotencyService');
const {
  requireIdempotency,
  storeIdempotencyResponse
} = require('../../src/middleware/idempotency');

const KEY = 'replay-status-key-1234567890';
const BODY = { amount: '5', recipient: 'GTEST' };

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
}

function storedRecord(response) {
  return {
    response,
    requestHash: IdempotencyService.generateRequestHash(BODY),
    createdAt: '2026-10-14T00:00:00.000Z',
    isIdempotent: true
  };
}

describe('Idempotent replay status and scoping (#1871)', () => {
  beforeEach(() => {
    jest.spyOn(IdempotencyService, 'isPending').mockResolvedValue(false);
    jest.spyOn(IdempotencyService, 'reserve').mockResolvedValue(true);
    jest.spyOn(IdempotencyService, 'findByHash').mockResolvedValue(null);
    jest.spyOn(IdempotencyService, 'complete').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('storeIdempotencyResponse', () => {
    it('persists the original status code, request id and extra headers with the body', async () => {
      const req = {
        id: 'req-original-1',
        idempotency: { key: KEY, isNew: true, apiKeyId: 1 },
        user: { id: 7 }
      };
      const body = { success: true, data: { id: 'd1' } };

      await storeIdempotencyResponse(req, body, {
        statusCode: 201,
        headers: { Location: '/donations/d1' }
      });

      expect(IdempotencyService.complete).toHaveBeenCalledWith(
        KEY,
        {
          __idempotentEnvelope: 2,
          status: 201,
          headers: { 'X-Request-Id': 'req-original-1', Location: '/donations/d1' },
          body
        },
        1,
        7
      );
    });
  });

  describe('replay', () => {
    it('replays a 201 created response as 201 with the original request id', async () => {
      const body = { success: true, data: { id: 'd1' } };
      jest.spyOn(IdempotencyService, 'get').mockResolvedValue(storedRecord({
        __idempotentEnvelope: 2,
        status: 201,
        headers: { 'X-Request-Id': 'req-original-1' },
        body
      }));
      const req = { headers: { 'idempotency-key': KEY }, body: BODY, apiKey: { id: 1 } };
      const res = mockRes();
      const next = jest.fn();

      await requireIdempotency(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-original-1');
      expect(res.setHeader).toHaveBeenCalledWith('X-Idempotency-Replayed', 'true');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        _idempotent: true
      }));
    });

    it('replays legacy bare records as 200 for backward compatibility', async () => {
      jest.spyOn(IdempotencyService, 'get').mockResolvedValue(storedRecord({ success: true }));
      const req = { headers: { 'idempotency-key': KEY }, body: BODY, apiKey: { id: 1 } };
      const res = mockRes();

      await requireIdempotency(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('scoping by principal', () => {
    it('looks up JWT principals in separate namespaces', async () => {
      const getSpy = jest.spyOn(IdempotencyService, 'get').mockResolvedValue(null);

      const reqA = { headers: { 'idempotency-key': KEY }, body: BODY, user: { id: 'jwt-alice' } };
      const reqB = { headers: { 'idempotency-key': KEY }, body: BODY, user: { id: 'jwt-bob' } };
      await requireIdempotency(reqA, mockRes(), jest.fn());
      await requireIdempotency(reqB, mockRes(), jest.fn());

      const scopesUsed = getSpy.mock.calls.map(call => call[1]);
      expect(scopesUsed[0]).not.toEqual(scopesUsed[1]);
      expect(scopesUsed).toEqual(['principal:jwt-alice', 'principal:jwt-bob']);
    });

    it('keeps the API key id as the scope when an API key is present', async () => {
      const getSpy = jest.spyOn(IdempotencyService, 'get').mockResolvedValue(null);
      const req = { headers: { 'idempotency-key': KEY }, body: BODY, apiKey: { id: 42 }, user: { id: 'jwt-x' } };

      await requireIdempotency(req, mockRes(), jest.fn());

      expect(getSpy).toHaveBeenCalledWith(KEY, 42);
    });
  });
});
