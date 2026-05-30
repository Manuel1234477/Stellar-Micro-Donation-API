'use strict';

const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    next = jest.fn();
  });

  it('calls the handler and resolves normally', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });

    await handler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards thrown errors to next(err)', async () => {
    const err = new Error('boom');
    const handler = asyncHandler(async () => {
      throw err;
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('forwards rejected promise errors to next(err)', async () => {
    const err = new Error('rejected');
    const handler = asyncHandler(() => Promise.reject(err));

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('passes req, res, next through to the wrapped handler', async () => {
    const spy = jest.fn().mockResolvedValue(undefined);
    const handler = asyncHandler(spy);

    await handler(req, res, next);

    expect(spy).toHaveBeenCalledWith(req, res, next);
  });

  it('does not swallow errors — next is called exactly once on failure', async () => {
    const handler = asyncHandler(async () => {
      throw new Error('fail');
    });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
