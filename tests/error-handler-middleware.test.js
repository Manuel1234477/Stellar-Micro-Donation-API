const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const { ValidationError, ERROR_CODES } = require('../src/utils/errors');

jest.mock('../src/utils/log', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

describe('Global Error Handling Middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      id: 'req-test-123',
      path: '/test/path',
      method: 'POST'
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    next = jest.fn();
    process.env.NODE_ENV = 'test';
  });

  describe('errorHandler', () => {
    test('returns AppError responses with original status and unified format', () => {
      const err = new ValidationError(
        'Invalid payload',
        { field: 'amount' },
        ERROR_CODES.INVALID_AMOUNT
      );

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ERROR_CODES.INVALID_AMOUNT,
            message: 'Invalid payload',
            details: { field: 'amount' },
            requestId: 'req-test-123',
            timestamp: expect.any(String)
          })
        })
      );
    });

    test('returns generic errors with provided statusCode and consistent shape', () => {
      const err = new Error('Gateway timeout');
      err.statusCode = 504;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Gateway timeout',
          requestId: 'req-test-123',
          timestamp: expect.any(String)
        }
      });
    });

    test('maps named validation errors to VALIDATION_ERROR code', () => {
      const err = new Error('Invalid email format');
      err.name = 'ValidationError';
      err.status = 400;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
          requestId: 'req-test-123',
          timestamp: expect.any(String)
        }
      });
    });

    test('does not leak internal error details in production for non-validation errors', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('DB password is invalid');

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId: 'req-test-123',
          timestamp: expect.any(String)
        }
      });
    });
  });

  describe('notFoundHandler', () => {
    test('returns 404 with consistent response format', () => {
      req.method = 'GET';
      req.path = '/unknown-route';

      notFoundHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'ENDPOINT_NOT_FOUND',
          message: 'Endpoint not found: GET /unknown-route',
          timestamp: expect.any(String)
        }
      });
    });
  });
});
