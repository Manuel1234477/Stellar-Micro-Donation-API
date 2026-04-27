'use strict';
/**
 * Tests for Issue #329: OpenAPI/Swagger documentation generation
 *
 * Verifies:
 * - spec is a valid OpenAPI 3.0 object
 * - All core endpoints are documented
 * - Swagger UI and raw spec endpoints are served
 * - Liquidity pool endpoints are documented
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key';

const { spec, swaggerUiMiddleware, swaggerUiSetup } = require('../src/config/openapi');

describe('OpenAPI spec structure', () => {
  it('has openapi 3.0.x version', () => {
    expect(spec.openapi).toMatch(/^3\.0\./);
  });

  it('has info block with title and version', () => {
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBeDefined();
    expect(spec.info.version).toBeDefined();
  });

  it('has paths object with at least one path', () => {
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it('has components.securitySchemes.ApiKeyAuth', () => {
    expect(spec.components.securitySchemes.ApiKeyAuth).toBeDefined();
  });

  it('has components.schemas.Error', () => {
    expect(spec.components.schemas.Error).toBeDefined();
  });

  it('has global security requiring ApiKeyAuth', () => {
    expect(spec.security.some(s => s.ApiKeyAuth !== undefined)).toBe(true);
  });
});

describe('Donations endpoints in spec', () => {
  it('documents POST /donations', () => {
    expect(spec.paths['/donations'].post).toBeDefined();
  });

  it('documents GET /donations', () => {
    expect(spec.paths['/donations'].get).toBeDefined();
  });

  it('documents GET /donations/{id}', () => {
    expect(spec.paths['/donations/{id}'].get).toBeDefined();
  });

  it('documents PATCH /donations/{id}/status', () => {
    expect(spec.paths['/donations/{id}/status'].patch).toBeDefined();
  });

  it('documents POST /donations/verify', () => {
    expect(spec.paths['/donations/verify'].post).toBeDefined();
  });

  it('documents GET /donations/limits', () => {
    expect(spec.paths['/donations/limits'].get).toBeDefined();
  });

  it('documents GET /donations/recent', () => {
    expect(spec.paths['/donations/recent'].get).toBeDefined();
  });
});

describe('Wallets endpoints in spec', () => {
  it('documents POST /wallets', () => {
    expect(spec.paths['/wallets'].post).toBeDefined();
  });

  it('documents GET /wallets', () => {
    expect(spec.paths['/wallets'].get).toBeDefined();
  });

  it('documents GET /wallets/{id}', () => {
    expect(spec.paths['/wallets/{id}'].get).toBeDefined();
  });

  it('documents PATCH /wallets/{id}', () => {
    expect(spec.paths['/wallets/{id}'].patch).toBeDefined();
  });
});

describe('Stream endpoints in spec', () => {
  it('documents POST /stream/create', () => {
    expect(spec.paths['/stream/create'].post).toBeDefined();
  });

  it('documents GET /stream/schedules', () => {
    expect(spec.paths['/stream/schedules'].get).toBeDefined();
  });

  it('documents DELETE /stream/schedules/{id}', () => {
    expect(spec.paths['/stream/schedules/{id}'].delete).toBeDefined();
  });
});

describe('Statistics endpoints in spec', () => {
  it('documents GET /stats/daily', () => {
    expect(spec.paths['/stats/daily']).toBeDefined();
  });

  it('documents GET /stats/weekly', () => {
    expect(spec.paths['/stats/weekly']).toBeDefined();
  });

  it('documents GET /stats/summary', () => {
    expect(spec.paths['/stats/summary']).toBeDefined();
  });
});

describe('Transaction endpoints in spec', () => {
  it('documents GET /transactions', () => {
    expect(spec.paths['/transactions'].get).toBeDefined();
  });

  it('documents POST /transactions/sync', () => {
    expect(spec.paths['/transactions/sync'].post).toBeDefined();
  });
});

describe('Liquidity pool endpoints in spec', () => {
  it('documents POST /liquidity-pools/deposit', () => {
    expect(spec.paths['/liquidity-pools/deposit']).toBeDefined();
    expect(spec.paths['/liquidity-pools/deposit'].post).toBeDefined();
  });

  it('documents POST /liquidity-pools/withdraw', () => {
    expect(spec.paths['/liquidity-pools/withdraw']).toBeDefined();
    expect(spec.paths['/liquidity-pools/withdraw'].post).toBeDefined();
  });

  it('documents GET /liquidity-pools/{id}/earnings', () => {
    expect(spec.paths['/liquidity-pools/{id}/earnings']).toBeDefined();
    expect(spec.paths['/liquidity-pools/{id}/earnings'].get).toBeDefined();
  });
});

describe('Audit log export endpoints in spec', () => {
  it('documents POST /admin/audit-logs/export', () => {
    expect(spec.paths['/admin/audit-logs/export']).toBeDefined();
    expect(spec.paths['/admin/audit-logs/export'].post).toBeDefined();
  });

  it('documents GET /admin/audit-logs/export/{jobId}/status', () => {
    expect(spec.paths['/admin/audit-logs/export/{jobId}/status']).toBeDefined();
  });

  it('documents GET /admin/audit-logs/export/{jobId}/download', () => {
    expect(spec.paths['/admin/audit-logs/export/{jobId}/download']).toBeDefined();
  });
});

describe('Response codes', () => {
  it('POST /donations has 201 and 400 responses', () => {
    const op = spec.paths['/donations'].post;
    expect(op.responses['201']).toBeDefined();
    expect(op.responses['400']).toBeDefined();
  });

  it('POST /wallets has 201 response', () => {
    expect(spec.paths['/wallets'].post.responses['201']).toBeDefined();
  });
});

describe('openapi.js module exports', () => {
  it('exports spec, swaggerUiMiddleware, swaggerUiSetup', () => {
    expect(spec).toBeDefined();
    expect(swaggerUiMiddleware).toBeDefined();
    expect(swaggerUiSetup).toBeDefined();
  });

  it('spec is a plain object', () => {
    expect(typeof spec).toBe('object');
    expect(spec).not.toBeNull();
  });
});
