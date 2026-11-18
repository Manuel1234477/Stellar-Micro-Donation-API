'use strict';

/**
 * Tests for Soroban contract invocation routes.
 *
 * Moved from tests/soroban-contract-invocation.test.js as part of the
 * test-suite reorganisation (issue #1792).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/sorobanContractService', () => ({
  invokeContract: jest.fn(),
  simulateContract: jest.fn(),
  getContractState: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'user-1', role: 'admin' };
    next();
  },
  requireRole: () => (req, res, next) => next(),
}));

const sorobanContractService = require('../../src/services/sorobanContractService');
const contractsRouter = require('../../src/routes/contracts');

describe('Soroban contract invocation routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/contracts', contractsRouter);
  });

  describe('POST /contracts/:contractId/invoke', () => {
    it('invokes a contract method and returns the result', async () => {
      sorobanContractService.invokeContract.mockResolvedValue({
        transactionHash: 'abc123',
        result: { value: 42 },
      });

      const res = await request(app)
        .post('/contracts/CABC123/invoke')
        .send({ method: 'transfer', args: [{ value: 10 }] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        transactionHash: 'abc123',
        result: { value: 42 },
      });
      expect(sorobanContractService.invokeContract).toHaveBeenCalledWith(
        'CABC123',
        'transfer',
        [{ value: 10 }],
        expect.any(Object)
      );
    });

    it('returns 400 when method is missing', async () => {
      const res = await request(app)
        .post('/contracts/CABC123/invoke')
        .send({ args: [] });

      expect(res.status).toBe(400);
      expect(sorobanContractService.invokeContract).not.toHaveBeenCalled();
    });

    it('returns 400 when args is not an array', async () => {
      const res = await request(app)
        .post('/contracts/CABC123/invoke')
        .send({ method: 'transfer', args: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(sorobanContractService.invokeContract).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      sorobanContractService.invokeContract.mockRejectedValue(
        new Error('invocation failed')
      );

      const res = await request(app)
        .post('/contracts/CABC123/invoke')
        .send({ method: 'transfer', args: [] });

      expect(res.status).toBe(500);
      expect(res.body).toEqual(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('POST /contracts/:contractId/simulate', () => {
    it('simulates a contract call and returns the result', async () => {
      sorobanContractService.simulateContract.mockResolvedValue({
        result: { value: 7 },
        cost: { cpuInsns: '1000', memBytes: '500' },
      });

      const res = await request(app)
        .post('/contracts/CABC123/simulate')
        .send({ method: 'balance', args: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        result: { value: 7 },
        cost: { cpuInsns: '1000', memBytes: '500' },
      });
      expect(sorobanContractService.simulateContract).toHaveBeenCalledWith(
        'CABC123',
        'balance',
        [],
        expect.any(Object)
      );
    });

    it('returns 400 when method is missing', async () => {
      const res = await request(app)
        .post('/contracts/CABC123/simulate')
        .send({});

      expect(res.status).toBe(400);
      expect(sorobanContractService.simulateContract).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      sorobanContractService.simulateContract.mockRejectedValue(
        new Error('simulation failed')
      );

      const res = await request(app)
        .post('/contracts/CABC123/simulate')
        .send({ method: 'balance', args: [] });

      expect(res.status).toBe(500);
      expect(res.body).toEqual(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('GET /contracts/:contractId/state', () => {
    it('returns the contract state', async () => {
      sorobanContractService.getContractState.mockResolvedValue({
        contractId: 'CABC123',
        data: { counter: 3 },
      });

      const res = await request(app).get('/contracts/CABC123/state');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        contractId: 'CABC123',
        data: { counter: 3 },
      });
      expect(sorobanContractService.getContractState).toHaveBeenCalledWith(
        'CABC123',
        expect.any(Object)
      );
    });

    it('returns 500 when the service throws', async () => {
      sorobanContractService.getContractState.mockRejectedValue(
        new Error('state lookup failed')
      );

      const res = await request(app).get('/contracts/CABC123/state');

      expect(res.status).toBe(500);
      expect(res.body).toEqual(
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });
});