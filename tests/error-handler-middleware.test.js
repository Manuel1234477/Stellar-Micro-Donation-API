const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const { ValidationError, ERROR_CODES } = require('../src/utils/errors');

jest.mock('../src/utils/log', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const log = require('../src/utils/log');

describe('Global Error Handling Middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      id: "req-test-123",
      path: "/test/path",
      method: "POST",
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    next = jest.fn();
    process.env.NODE_ENV = "test"; // 'test' should behave like development for debugging
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
            code: ERROR_CODES.INVALID_AMOUNT.code,
            numericCode: ERROR_CODES.INVALID_AMOUNT.numeric,
            message: "Invalid payload",
            details: { field: "amount" },
            requestId: "req-test-123",
            timestamp: expect.any(String),
            debug: expect.objectContaining({
              name: "ValidationError",
            }),
          }),
        }),
      );

      expect(log.error).toHaveBeenCalledTimes(2);
      expect(log.error).toHaveBeenCalledWith(
        "ERROR_HANDLER",
        "Error occurred",
        expect.objectContaining({
          requestId: "req-test-123",
          path: "/test/path",
          method: "POST",
          error: expect.objectContaining({
            name: "ValidationError",
            message: "Invalid payload",
            code: ERROR_CODES.INVALID_AMOUNT.code,
            numericCode: ERROR_CODES.INVALID_AMOUNT.numeric,
            statusCode: 400,
          }),
        }),
      );
    });

    test('returns generic errors with provided statusCode and consistent shape', () => {
      const err = new Error('Gateway timeout');
      err.statusCode = 504;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: "INTERNAL_ERROR",
            numericCode: 9000,
            message: "Gateway timeout",
            requestId: "req-test-123",
            timestamp: expect.any(String),
            debug: {
              name: "InternalError",
            },
          }),
        }),
      );

      expect(log.error).toHaveBeenCalledTimes(2);
      expect(log.error).toHaveBeenCalledWith(
        "ERROR_HANDLER",
        "Error occurred",
        expect.objectContaining({
          requestId: "req-test-123",
          path: "/test/path",
          method: "POST",
          error: "Gateway timeout",
          code: undefined,
          numericCode: undefined,
        }),
      );
    });

    test('maps named validation errors to VALIDATION_ERROR code', () => {
      const err = new Error('Invalid email format');
      err.name = "ValidationError";

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: "VALIDATION_ERROR",
            numericCode: 1000,
            message: "Invalid email format",
            requestId: "req-test-123",
            timestamp: expect.any(String),
            debug: {
              name: "ValidationError",
            },
          }),
        }),
      );

      expect(log.error).toHaveBeenCalledTimes(2);
      expect(log.error).toHaveBeenCalledWith(
        "ERROR_HANDLER",
        "Error occurred",
        expect.objectContaining({
          requestId: "req-test-123",
          path: "/test/path",
          method: "POST",
          error: expect.objectContaining({
            name: "ValidationError",
            message: "Invalid email format",
          }),
        }),
      );
    });

    test('does not leak internal error details in production for non-validation errors', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error("Database connection failed: password=secret123");
      err.statusCode = 500;

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: "INTERNAL_ERROR",
            numericCode: 9000,
            message: "An unexpected error occurred. Please try again later.",
            requestId: "req-test-123",
            timestamp: expect.any(String),
          }),
        }),
      );

      expect(log.error).toHaveBeenCalledTimes(2);
      expect(log.error).toHaveBeenCalledWith(
        "ERROR_HANDLER",
        "Error occurred",
        expect.objectContaining({
          requestId: "req-test-123",
          path: "/test/path",
          method: "POST",
          error: "Database connection failed: password=secret123",
        }),
      );
    });
  });

  describe('notFoundHandler', () => {
    test('returns 404 with consistent response format', () => {
      req.method = 'GET';
      req.path = '/unknown-route';

      notFoundHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: "ENDPOINT_NOT_FOUND",
            numericCode: 3005,
            message: "Endpoint not found: GET /unknown-route",
            requestId: "req-test-123",
            timestamp: expect.any(String),
            debug: {
              name: "NotFoundError",
            },
          }),
        }),
      );
    });
  });
});
