'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../src/services/liquidityPoolService', () => ({
  createPool: jest.fn(),
  getPool: jest.fn(),
  listPools: jest.fn(),
  addLiquidity: jest.fn(),
  removeLiquidity: jest.fn(),
  getPoolStats: jest.fn(),
}));

const liquidityPoolService = require('../../src/services/liquidityPoolService');
const liquidityPoolRoutes = require('../../src/routes/liquidity-pools');

describe('Liquidity Pools Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/liquidity-pools', liquidityPoolRoutes);
  });

  describe('POST /liquidity-pools', () => {
    it('creates a new liquidity pool', async () => {
      const pool = { id: 'pool-1', tokenA: 'XLM', tokenB: 'USDC', reserveA: '1000', reserveB: '2000' };
      liquidityPoolService.createPool.mockResolvedValue(pool);

      const res = await request(app)
        .post('/liquidity-pools')
        .send({ tokenA: 'XLM', tokenB: 'USDC', amountA: '1000', amountB: '2000' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(pool);
      expect(liquidityPoolService.createPool).toHaveBeenCalledWith({
        tokenA: 'XLM',
        tokenB: 'USDC',
        amountA: '1000',
        amountB: '2000',
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/liquidity-pools')
        .send({ tokenA: 'XLM' });

      expect(res.status).toBe(400);
      expect(liquidityPoolService.createPool).not.toHaveBeenCalled();
    });

    it('returns 500 when the service throws', async () => {
      liquidityPoolService.createPool.mockRejectedValue(new Error('boom'));

      const res = await request(app)
        .post('/liquidity-pools')
        .send({ tokenA: 'XLM', tokenB: 'USDC', amountA: '1', amountB: '2' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /liquidity-pools', () => {
    it('lists all pools', async () => {
      const pools = [{ id: 'pool-1' }, { id: 'pool-2' }];
      liquidityPoolService.listPools.mockResolvedValue(pools);

      const res = await request(app).get('/liquidity-pools');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(pools);
    });

    it('returns 500 when listing fails', async () => {
      liquidityPoolService.listPools.mockRejectedValue(new Error('boom'));

      const res = await request(app).get('/liquidity-pools');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /liquidity-pools/:id', () => {
    it('returns a pool by id', async () => {
      const pool = { id: 'pool-1', tokenA: 'XLM', tokenB: 'USDC' };
      liquidityPoolService.getPool.mockResolvedValue(pool);

      const res = await request(app).get('/liquidity-pools/pool-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(pool);
      expect(liquidityPoolService.getPool).toHaveBeenCalledWith('pool-1');
    });

    it('returns 404 when the pool does not exist', async () => {
      liquidityPoolService.getPool.mockResolvedValue(null);

      const res = await request(app).get('/liquidity-pools/missing');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /liquidity-pools/:id/add-liquidity', () => {
    it('adds liquidity to a pool', async () => {
      const updated = { id: 'pool-1', reserveA: '1500', reserveB: '3000' };
      liquidityPoolService.addLiquidity.mockResolvedValue(updated);

      const res = await request(app)
        .post('/liquidity-pools/pool-1/add-liquidity')
        .send({ amountA: '500', amountB: '1000' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(liquidityPoolService.addLiquidity).toHaveBeenCalledWith('pool-1', {
        amountA: '500',
        amountB: '1000',
      });
    });

    it('returns 400 when amounts are missing', async () => {
      const res = await request(app)
        .post('/liquidity-pools/pool-1/add-liquidity')
        .send({});

      expect(res.status).toBe(400);
      expect(liquidityPoolService.addLiquidity).not.toHaveBeenCalled();
    });
  });

  describe('POST /liquidity-pools/:id/remove-liquidity', () => {
    it('removes liquidity from a pool', async () => {
      const updated = { id: 'pool-1', reserveA: '500', reserveB: '1000' };
      liquidityPoolService.removeLiquidity.mockResolvedValue(updated);

      const res = await request(app)
        .post('/liquidity-pools/pool-1/remove-liquidity')
        .send({ shares: '100' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(liquidityPoolService.removeLiquidity).toHaveBeenCalledWith('pool-1', {
        shares: '100',
      });
    });

    it('returns 400 when shares are missing', async () => {
      const res = await request(app)
        .post('/liquidity-pools/pool-1/remove-liquidity')
        .send({});

      expect(res.status).toBe(400);
      expect(liquidityPoolService.removeLiquidity).not.toHaveBeenCalled();
    });
  });

  describe('GET /liquidity-pools/:id/stats', () => {
    it('returns pool statistics', async () => {
      const stats = { id: 'pool-1', totalLiquidity: '3000', volume24h: '500' };
      liquidityPoolService.getPoolStats.mockResolvedValue(stats);

      const res = await request(app).get('/liquidity-pools/pool-1/stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(stats);
      expect(liquidityPoolService.getPoolStats).toHaveBeenCalledWith('pool-1');
    });

    it('returns 404 when stats are unavailable', async () => {
      liquidityPoolService.getPoolStats.mockResolvedValue(null);

      const res = await request(app).get('/liquidity-pools/missing/stats');

      expect(res.status).toBe(404);
    });
  });
});