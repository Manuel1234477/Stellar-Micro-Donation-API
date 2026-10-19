'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/FeeService', () => ({
  calculateFee: jest.fn(),
  getFeeSchedule: jest.fn(),
}));

const FeeService = require('../../src/services/FeeService');

describe('Fees routes (#794)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());

    const feesRouter = require('../../src/routes/fees');
    app.use('/fees', feesRouter);
  });

  describe('GET /fees/schedule', () => {
    it('returns the fee schedule', async () => {
      const schedule = {
        custodial: 1.5,
        nonCustodial: 0.5,
        currency: 'XLM',
      };
      FeeService.getFeeSchedule.mockResolvedValue(schedule);

      const res = await request(app).get('/fees/schedule');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(schedule);
      expect(FeeService.getFeeSchedule).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the fee schedule lookup fails', async () => {
      FeeService.getFeeSchedule.mockRejectedValue(new Error('boom'));

      const res = await request(app).get('/fees/schedule');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /fees/calculate', () => {
    it('returns the calculated fee', async () => {
      const fee = { amount: 2.5, currency: 'XLM' };
      FeeService.calculateFee.mockResolvedValue(fee);

      const res = await request(app)
        .post('/fees/calculate')
        .send({ amount: 100, type: 'custodial' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(fee);
      expect(FeeService.calculateFee).toHaveBeenCalledWith({
        amount: 100,
        type: 'custodial',
      });
    });

    it('returns 400 when the request body is invalid', async () => {
      FeeService.calculateFee.mockRejectedValue(
        Object.assign(new Error('invalid amount'), { status: 400 })
      );

      const res = await request(app)
        .post('/fees/calculate')
        .send({ amount: -1, type: 'custodial' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 500 when fee calculation fails unexpectedly', async () => {
      FeeService.calculateFee.mockRejectedValue(new Error('boom'));

      const res = await request(app)
        .post('/fees/calculate')
        .send({ amount: 100, type: 'custodial' });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});