'use strict';

/**
 * Tests for issue #1889: 5xx responses must not echo raw error.message to clients.
 *
 * Acceptance criteria:
 * - No route returns err.message for 5xx responses in production mode.
 * - A test forces a DB error on a representative route and asserts the response hides SQLite text.
 */

const express = require('express');
const request = require('supertest');
const { clientErrorMessage, GENERIC_SERVER_MESSAGE } = require('../src/utils/clientErrorMessage');
const log = require('../src/utils/log');

const mockStellarService = {
  invokeContract: jest.fn(),
};

jest.mock('../src/config/stellar', () => ({
  getStellarService: () => mockStellarService,
}));

jest.mock('../src/middleware/apiKey', () => (req, res, next) => {
  req.user = { id: 'test-admin', role: 'admin' };
  next();
});

jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: () => (req, res, next) => next(),
}));

const contractsRouter = require('../src/routes/contracts');

const SQLITE_TEXT = 'SQLITE_CONSTRAINT: UNIQUE constraint failed: transactions.idempotencyKey';

describe('Issue #1889 – Client-facing error messages', () => {
  describe('clientErrorMessage', () => {
    let errorSpy;

    beforeEach(() => {
      errorSpy = jest.spyOn(log, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('passes 4xx messages through, since they are deliberate client feedback', () => {
      expect(clientErrorMessage('TEST', new Error('Account not found'), 404)).toBe('Account not found');
      expect(clientErrorMessage('TEST', new Error('Invalid XDR'), 400)).toBe('Invalid XDR');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('replaces 5xx messages with the generic text and logs the raw error', () => {
      const result = clientErrorMessage('TEST', new Error(SQLITE_TEXT), 500);

      expect(result).toBe(GENERIC_SERVER_MESSAGE);
      expect(result).not.toMatch(/SQLITE|transactions\.idempotencyKey/);
      expect(errorSpy).toHaveBeenCalledWith(
        'TEST',
        expect.any(String),
        expect.objectContaining({ status: 500, error: SQLITE_TEXT })
      );
    });

    it('uses the caller-supplied fallback for 5xx responses', () => {
      expect(clientErrorMessage('TEST', new Error('upstream https://horizon.example'), 503, 'Rates unavailable'))
        .toBe('Rates unavailable');
    });
  });

  describe('POST /:contractId/invoke with a database failure', () => {
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/contracts', contractsRouter);
    });

    beforeEach(() => {
      mockStellarService.invokeContract.mockReset();
    });

    it('returns 500 without leaking SQLite text', async () => {
      mockStellarService.invokeContract.mockRejectedValue(new Error(SQLITE_TEXT));

      const res = await request(app)
        .post('/contracts/CABC123/invoke')
        .send({ method: 'transfer', args: [] });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVOKE_FAILED');
      expect(res.body.error.message).toBe(GENERIC_SERVER_MESSAGE);
      expect(JSON.stringify(res.body)).not.toMatch(/SQLITE|idempotencyKey/);
    });
  });
});
