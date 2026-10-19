/**
 * Issue #1870: Idempotency-Key reuse with a different body must return 422
 * and must not replay the stored response or execute the handler.
 */

const IdempotencyService = require('../../src/services/IdempotencyService');
const { requireIdempotency, conditionalIdempotency } = require('../../src/middleware/idempotency');

const KEY = 'abc-reuse-key-1234567890';

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
}

function completedRecord(body) {
  return {
    response: { success: true, data: { amount: 5 } },
    requestHash: IdempotencyService.generateRequestHash(body),
    createdAt: '2026-10-14T00:00:00.000Z',
    isIdempotent: true
  };
}

describe('Idempotency key reuse with a different payload (#1870)', () => {
  let getSpy;

  beforeEach(() => {
    getSpy = jest.spyOn(IdempotencyService, 'get');
    jest.spyOn(IdempotencyService, 'isPending').mockResolvedValue(false);
    jest.spyOn(IdempotencyService, 'reserve').mockResolvedValue(true);
    jest.spyOn(IdempotencyService, 'findByHash').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each([
    ['requireIdempotency', requireIdempotency],
    ['conditionalIdempotency', conditionalIdempotency]
  ])('%s', (name, middleware) => {
    const originalBody = { amount: '5', recipient: 'GORIGINAL' };
    const reusedBody = { amount: '50', recipient: 'GDIFFERENT' };

    it('returns 422 IDEMPOTENCY_KEY_REUSED and does not call next when the body differs', async () => {
      getSpy.mockResolvedValue(completedRecord(originalBody));
      const req = { headers: { 'idempotency-key': KEY }, body: reusedBody, apiKey: { id: 1 } };
      const res = mockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' })
      }));
      expect(res.setHeader).not.toHaveBeenCalledWith('X-Idempotency-Replayed', 'true');
    });

    it('replays the original response when the body is identical', async () => {
      getSpy.mockResolvedValue(completedRecord(originalBody));
      const req = { headers: { 'idempotency-key': KEY }, body: { ...originalBody }, apiKey: { id: 1 } };
      const res = mockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        _idempotent: true
      }));
      expect(res.setHeader).toHaveBeenCalledWith('X-Idempotency-Replayed', 'true');
    });
  });

  it('rejects a reused key in the race path where the record completed mid-request', async () => {
    getSpy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedRecord({ amount: '5' }));
    IdempotencyService.reserve.mockResolvedValue(false);
    IdempotencyService.isPending.mockResolvedValue(false);

    const req = { headers: { 'idempotency-key': KEY }, body: { amount: '50' }, apiKey: { id: 1 } };
    const res = mockRes();
    const next = jest.fn();

    await requireIdempotency(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
