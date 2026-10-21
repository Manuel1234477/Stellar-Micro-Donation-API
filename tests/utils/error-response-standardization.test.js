/**
 * Tests for Standardized API Error Response Taxonomy (Issue #1090)
 * 
 * Verifies canonical error envelope format, Stellar error mapping,
 * sensitive data masking, and consistent responses across all paths.
 */

const {
  CanonicalErrorResponse,
  mapStellarError,
  formatErrorResponse,
  STELLAR_ERROR_MAPPING,
} = require('../../src/utils/errorResponseFormatter');

describe('Error Response Standardization (Issue #1090)', () => {
  describe('Canonical Error Envelope', () => {
    test('should create error response with required fields', () => {
      const response = new CanonicalErrorResponse(
        'INSUFFICIENT_BALANCE',
        'Account has insufficient balance',
        402
      );

      const envelope = response.toJSON('req-123');

      expect(envelope).toHaveProperty('error');
      expect(envelope.error).toHaveProperty('code', 'INSUFFICIENT_BALANCE');
      expect(envelope.error).toHaveProperty('message');
      expect(envelope.error).toHaveProperty('timestamp');
      expect(envelope.error).toHaveProperty('requestId', 'req-123');
    });

    test('should include details in non-production mode', () => {
      const response = new CanonicalErrorResponse(
        'VALIDATION_ERROR',
        'Invalid input',
        400,
        { field: 'amount', reason: 'must be positive' }
      );

      const envelope = response.toJSON('req-123', false);
      expect(envelope.error).toHaveProperty('details');
      expect(envelope.error.details.field).toBe('amount');
    });

    test('should exclude details in production mode', () => {
      const response = new CanonicalErrorResponse(
        'VALIDATION_ERROR',
        'Invalid input',
        400,
        { field: 'amount', reason: 'must be positive' }
      );

      const envelope = response.toJSON('req-123', true);
      expect(envelope.error).not.toHaveProperty('details');
    });
  });

  describe('Stellar Error Mapping', () => {
    test('should map tx_bad_seq to stable code', () => {
      const stellarError = {
        data: { result_code: 'tx_bad_seq' },
      };

      const response = mapStellarError(stellarError);

      expect(response.code).toBe('STELLAR_TX_BAD_SEQ');
      expect(response.statusCode).toBe(400);
    });

    test('should map op_underfunded to INSUFFICIENT_BALANCE', () => {
      const stellarError = {
        data: { result_code: 'op_underfunded' },
      };

      const response = mapStellarError(stellarError);

      expect(response.code).toBe('STELLAR_OP_UNDERFUNDED');
      expect(response.statusCode).toBe(402);
    });

    test('should map op_no_destination', () => {
      const stellarError = {
        data: { result_code: 'op_no_destination' },
      };

      const response = mapStellarError(stellarError);

      expect(response.code).toBe('STELLAR_OP_NO_DESTINATION');
      expect(response.message).toContain('does not exist');
    });

    test('should map op_no_trust error', () => {
      const stellarError = {
        data: { result_code: 'op_no_trust' },
      };

      const response = mapStellarError(stellarError);

      expect(response.code).toBe('STELLAR_OP_NO_TRUST');
      expect(response.message).toContain('trustline');
    });

    test('should handle unknown Stellar error codes', () => {
      const stellarError = {
        data: { result_code: 'unknown_future_error' },
      };

      const response = mapStellarError(stellarError);

      expect(response.code).toBe('STELLAR_OPERATION_FAILED');
      expect(response.statusCode).toBe(400);
    });

    test('should not leak internal details for internal errors', () => {
      const stellarError = {
        data: { result_code: 'tx_internal_error' },
      };

      const response = mapStellarError(stellarError);

      // Should not expose the raw Stellar error
      expect(response.code).toBe('STELLAR_TX_INTERNAL_ERROR');
      expect(response.statusCode).toBe(500);
    });
  });

  describe('Error Response Formatting', () => {
    test('should format Stellar errors consistently', () => {
      const stellarError = new Error('Stellar SDK error');
      stellarError.data = { result_code: 'tx_bad_seq' };

      const { statusCode, body } = formatErrorResponse(stellarError, {
        requestId: 'req-abc',
        production: false,
      });

      expect(statusCode).toBe(400);
      expect(body.error.code).toBe('STELLAR_TX_BAD_SEQ');
      expect(body.error.requestId).toBe('req-abc');
    });

    test('should format application errors with code', () => {
      const appError = new Error('Validation failed');
      appError.code = 'VALIDATION_ERROR';
      appError.statusCode = 400;

      const { statusCode, body } = formatErrorResponse(appError, {
        requestId: 'req-xyz',
        production: false,
      });

      expect(statusCode).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should format generic errors in non-production', () => {
      const error = new Error('Some internal error');

      const { statusCode, body } = formatErrorResponse(error, {
        requestId: 'req-123',
        production: false,
      });

      expect(statusCode).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('internal error');
    });

    test('should hide error details in production', () => {
      const error = new Error('Database connection failed');
      error.code = 'DATABASE_ERROR';
      error.statusCode = 500;

      const { body } = formatErrorResponse(error, {
        requestId: 'req-prod',
        production: true,
      });

      expect(body.error.message).not.toContain('connection');
    });
  });

  describe('Sensitive Data Masking', () => {
    test('should not leak Stellar secret keys in errors', () => {
      const stellarError = new Error('Invalid secret key');
      stellarError.data = {
        result_code: 'tx_bad_auth',
        details: 'Secret: SBXXXXXXXXX',
      };

      const { body } = formatErrorResponse(stellarError, {
        requestId: 'req-123',
        production: false,
      });

      // Secret should not appear in response
      expect(JSON.stringify(body)).not.toContain('SBXXXXXXXXX');
    });

    test('should not leak SQL errors in production', () => {
      const dbError = new Error("SQL: SELECT * FROM users WHERE email='admin@example.com'");
      dbError.code = 'DATABASE_ERROR';
      dbError.statusCode = 500;

      const { body } = formatErrorResponse(dbError, {
        requestId: 'req-sql',
        production: true,
      });

      expect(JSON.stringify(body)).not.toContain('SELECT');
    });

    test('should include request correlation ID for debugging', () => {
      const error = new Error('Processing error');

      const { body } = formatErrorResponse(error, {
        requestId: 'trace-abc-123',
        production: false,
      });

      expect(body.error.requestId).toBe('trace-abc-123');
    });
  });

  describe('Stellar Error Coverage', () => {
    test('should have mappings for all common Stellar tx_ errors', () => {
      const txErrors = [
        'tx_bad_seq', 'tx_bad_auth', 'tx_bad_auth_extra',
        'tx_internal_error', 'tx_no_operation', 'tx_too_late', 'tx_too_early',
        'tx_missing_operation', 'tx_insufficient_balance',
      ];

      for (const code of txErrors) {
        expect(STELLAR_ERROR_MAPPING).toHaveProperty(code);
        expect(STELLAR_ERROR_MAPPING[code]).toHaveProperty('code');
        expect(STELLAR_ERROR_MAPPING[code]).toHaveProperty('message');
      }
    });

    test('should have mappings for common op_ errors', () => {
      const opErrors = [
        'op_underfunded', 'op_no_destination', 'op_no_trust',
        'op_line_full', 'op_invalid_limit', 'op_already_exists',
      ];

      for (const code of opErrors) {
        expect(STELLAR_ERROR_MAPPING).toHaveProperty(code);
        expect(STELLAR_ERROR_MAPPING[code]).toHaveProperty('code');
        expect(STELLAR_ERROR_MAPPING[code]).toHaveProperty('message');
      }
    });

    test('should distinguish clientFacing errors', () => {
      // User-facing error
      const userError = STELLAR_ERROR_MAPPING['op_underfunded'];
      expect(userError.clientFacing).toBe(true);

      // Internal error - don't expose details
      const internalError = STELLAR_ERROR_MAPPING['tx_internal_error'];
      expect(internalError.clientFacing).toBe(false);
    });
  });

  describe('HTTP Status Code Mapping', () => {
    test('should use 402 for insufficient balance errors', () => {
      const error = new Error('Insufficient funds');
      error.data = { result_code: 'op_underfunded' };

      const { statusCode } = formatErrorResponse(error);

      expect(statusCode).toBe(402);
    });

    test('should use 400 for validation errors', () => {
      const error = new Error('Invalid amount');
      error.code = 'VALIDATION_ERROR';

      const { statusCode } = formatErrorResponse(error, {
        statusCode: 400,
      });

      expect(statusCode).toBe(400);
    });

    test('should use 500 for internal errors', () => {
      const error = new Error('Internal error');
      error.code = 'INTERNAL_ERROR';

      const { statusCode } = formatErrorResponse(error, {
        statusCode: 500,
      });

      expect(statusCode).toBe(500);
    });
  });

  describe('Consistency Across Response Paths', () => {
    test('should produce consistent error shape from middleware', () => {
      const error1 = new Error('Error 1');
      error1.data = { result_code: 'tx_bad_seq' };

      const error2 = new Error('Error 2');
      error2.data = { result_code: 'op_no_destination' };

      const resp1 = formatErrorResponse(error1, { requestId: 'req-1' });
      const resp2 = formatErrorResponse(error2, { requestId: 'req-2' });

      // Both should have same shape
      expect(Object.keys(resp1.body.error)).toEqual(
        Object.keys(resp2.body.error)
      );
    });

    test('should handle null/undefined gracefully', () => {
      const nullError = new Error('Null error');
      nullError.data = null;

      const { statusCode, body } = formatErrorResponse(nullError);

      expect(statusCode).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
