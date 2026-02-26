const express = require('express');
const request = require('supertest');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');

const mockDonationService = {
  createDonationRecord: jest.fn(),
  verifyTransaction: jest.fn(),
  getAllDonations: jest.fn(),
  getDonationLimits: jest.fn(),
  getRecentDonations: jest.fn(),
  getDonationById: jest.fn(),
  updateDonationStatus: jest.fn(),
  sendCustodialDonation: jest.fn(),
};

jest.mock('../src/config/stellar', () => ({
  getStellarService: jest.fn(() => ({})),
}));

jest.mock('../src/services/DonationService', () => {
  return jest.fn().mockImplementation(() => mockDonationService);
});

jest.mock('../src/middleware/rateLimiter', () => ({
  donationRateLimiter: (req, res, next) => next(),
  verificationRateLimiter: (req, res, next) => next(),
}));

jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
}));

jest.mock('../src/middleware/apiKey', () => {
  return (req, res, next) => {
    if (req.get('X-API-Key') === 'test-key-1') {
      return next();
    }
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid API key',
      },
    });
  };
});

jest.mock('../src/middleware/idempotency', () => ({
  requireIdempotency: (req, res, next) => {
    const key = req.get('X-Idempotency-Key');
    if (!key) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'X-Idempotency-Key header is required',
        },
      });
    }
    req.idempotency = { key };
    return next();
  },
  storeIdempotencyResponse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const donationRouter = require('../src/routes/donation');

const RESPONSE_CONTRACTS = {
  createDonationSuccess: {
    topLevel: ['success', 'data'],
    data: ['verified', 'transactionHash'],
  },
  createDonationValidationError: {
    topLevel: ['success', 'error'],
    errorRequired: ['code', 'message', 'requestId', 'timestamp'],
  },
  listDonationsSuccess: {
    topLevel: ['success', 'data', 'count'],
  },
  verifyDonationError: {
    topLevel: ['success', 'error'],
    error: ['code', 'message'],
  },
  authError: {
    topLevel: ['success', 'error'],
    error: ['code', 'message'],
  },
  notFoundError: {
    topLevel: ['success', 'error'],
    errorRequired: ['code', 'message', 'requestId', 'timestamp'],
  },
};

function expectExactKeys(object, expectedKeys) {
  expect(Object.keys(object).sort()).toEqual([...expectedKeys].sort());
}

function expectRequiredKeys(object, requiredKeys) {
  requiredKeys.forEach((key) => {
    expect(object).toHaveProperty(key);
  });
}

describe('API Response Contract Tests', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDonationService.createDonationRecord.mockResolvedValue({
      id: 'don_001',
      stellarTxId: 'tx_001',
    });
    mockDonationService.verifyTransaction.mockResolvedValue({
      transactionHash: 'tx_001',
      verified: true,
    });
    mockDonationService.getAllDonations.mockReturnValue([
      {
        id: 'don_001',
        donor: 'GDONOR',
        recipient: 'GRECIPIENT',
        amount: 10,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.id = 'req-contract-001';
      next();
    });
    app.use('/donations', donationRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  test('POST /donations success response matches contract', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', 'idem-contract-001')
      .send({
        amount: '10.5',
        recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      });

    expect(response.status).toBe(201);
    expectExactKeys(response.body, RESPONSE_CONTRACTS.createDonationSuccess.topLevel);
    expect(response.body.success).toBe(true);
    expectExactKeys(response.body.data, RESPONSE_CONTRACTS.createDonationSuccess.data);
    expect(typeof response.body.data.verified).toBe('boolean');
    expect(typeof response.body.data.transactionHash).toBe('string');
  });

  test('POST /donations validation error response matches contract', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', 'idem-contract-002')
      .send({
        amount: '10.5',
      });

    expect(response.status).toBe(400);
    expectExactKeys(response.body, RESPONSE_CONTRACTS.createDonationValidationError.topLevel);
    expect(response.body.success).toBe(false);
    expectRequiredKeys(response.body.error, RESPONSE_CONTRACTS.createDonationValidationError.errorRequired);
  });

  test('GET /donations success response matches contract', async () => {
    const response = await request(app)
      .get('/donations')
      .set('X-API-Key', 'test-key-1');

    expect(response.status).toBe(200);
    expectExactKeys(response.body, RESPONSE_CONTRACTS.listDonationsSuccess.topLevel);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(typeof response.body.count).toBe('number');
  });

  test('POST /donations/verify error response matches contract', async () => {
    mockDonationService.verifyTransaction.mockRejectedValueOnce({
      status: 422,
      code: 'VERIFICATION_FAILED',
      message: 'Transaction hash could not be verified',
    });

    const response = await request(app)
      .post('/donations/verify')
      .set('X-API-Key', 'test-key-1')
      .send({
        transactionHash: 'tx_missing',
      });

    expect(response.status).toBe(422);
    expectExactKeys(response.body, RESPONSE_CONTRACTS.verifyDonationError.topLevel);
    expect(response.body.success).toBe(false);
    expectExactKeys(response.body.error, RESPONSE_CONTRACTS.verifyDonationError.error);
  });

  test('POST /donations authentication error response matches contract', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-Idempotency-Key', 'idem-contract-003')
      .send({
        amount: '10',
        recipient: 'GRECIPIENT',
      });

    expect(response.status).toBe(401);
    expectExactKeys(response.body, RESPONSE_CONTRACTS.authError.topLevel);
    expect(response.body.success).toBe(false);
    expectExactKeys(response.body.error, RESPONSE_CONTRACTS.authError.error);
  });

  test('unknown endpoint returns not-found error contract', async () => {
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
    expectExactKeys(response.body, RESPONSE_CONTRACTS.notFoundError.topLevel);
    expect(response.body.success).toBe(false);
    expectRequiredKeys(response.body.error, RESPONSE_CONTRACTS.notFoundError.errorRequired);
  });
});
