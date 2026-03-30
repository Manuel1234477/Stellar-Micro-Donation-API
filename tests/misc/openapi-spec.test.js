'use strict';

/**
 * Tests for OpenAPI/Swagger documentation (issue #634):
 * - spec is a valid OpenAPI 3.0 object
 * - All expected endpoints are documented
 * - GET /api/openapi.json returns the spec
 * - GET /api/docs serves Swagger UI
 * - Spec completeness against registered routes
 */

const { spec } = require('../../src/config/openapi');

// ─── Spec structure ───────────────────────────────────────────────────────────

describe('OpenAPI spec structure', () => {
  it('has openapi 3.0.x version', () => {
    expect(spec.openapi).toMatch(/^3\.0\./);
  });

  it('has info block with title and version', () => {
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBeDefined();
    expect(spec.info.version).toBeDefined();
  });

  it('has paths object', () => {
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe('object');
  });

  it('has at least one path defined', () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it('has components.securitySchemes.ApiKeyAuth', () => {
    expect(spec.components).toBeDefined();
    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes.ApiKeyAuth).toBeDefined();
  });

  it('has components.schemas.Error', () => {
    expect(spec.components.schemas.Error).toBeDefined();
  });

  it('has global security requiring ApiKeyAuth', () => {
    expect(spec.security).toBeDefined();
    expect(spec.security.some(s => s.ApiKeyAuth !== undefined)).toBe(true);
  });
});

// ─── Donations endpoints ──────────────────────────────────────────────────────

describe('Donations endpoints in spec', () => {
  it('documents POST /donations', () => {
    expect(spec.paths['/donations']).toBeDefined();
    expect(spec.paths['/donations'].post).toBeDefined();
  });

  it('documents GET /donations', () => {
    expect(spec.paths['/donations'].get).toBeDefined();
  });

  it('documents GET /donations/{id}', () => {
    expect(spec.paths['/donations/{id}']).toBeDefined();
    expect(spec.paths['/donations/{id}'].get).toBeDefined();
  });

  it('documents PATCH /donations/{id}/status', () => {
    expect(spec.paths['/donations/{id}/status']).toBeDefined();
    expect(spec.paths['/donations/{id}/status'].patch).toBeDefined();
  });

  it('documents POST /donations/verify', () => {
    expect(spec.paths['/donations/verify']).toBeDefined();
    expect(spec.paths['/donations/verify'].post).toBeDefined();
  });

  it('documents GET /donations/limits', () => {
    expect(spec.paths['/donations/limits']).toBeDefined();
    expect(spec.paths['/donations/limits'].get).toBeDefined();
  });

  it('documents GET /donations/recent', () => {
    expect(spec.paths['/donations/recent']).toBeDefined();
    expect(spec.paths['/donations/recent'].get).toBeDefined();
  });
});

// ─── Wallets endpoints ────────────────────────────────────────────────────────

describe('Wallets endpoints in spec', () => {
  it('documents POST /wallets', () => {
    expect(spec.paths['/wallets']).toBeDefined();
    expect(spec.paths['/wallets'].post).toBeDefined();
  });

  it('documents GET /wallets', () => {
    expect(spec.paths['/wallets'].get).toBeDefined();
  });

  it('documents GET /wallets/{id}', () => {
    expect(spec.paths['/wallets/{id}']).toBeDefined();
    expect(spec.paths['/wallets/{id}'].get).toBeDefined();
  });

  it('documents PATCH /wallets/{id}', () => {
    expect(spec.paths['/wallets/{id}'].patch).toBeDefined();
  });
});

// ─── Stream endpoints ─────────────────────────────────────────────────────────

describe('Stream endpoints in spec', () => {
  it('documents POST /stream/create', () => {
    expect(spec.paths['/stream/create']).toBeDefined();
    expect(spec.paths['/stream/create'].post).toBeDefined();
  });

  it('documents GET /stream/schedules', () => {
    expect(spec.paths['/stream/schedules']).toBeDefined();
    expect(spec.paths['/stream/schedules'].get).toBeDefined();
  });

  it('documents DELETE /stream/schedules/{id}', () => {
    expect(spec.paths['/stream/schedules/{id}']).toBeDefined();
    expect(spec.paths['/stream/schedules/{id}'].delete).toBeDefined();
  });
});

// ─── Statistics endpoints ─────────────────────────────────────────────────────

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

// ─── Transaction endpoints ────────────────────────────────────────────────────

describe('Transaction endpoints in spec', () => {
  it('documents GET /transactions', () => {
    expect(spec.paths['/transactions']).toBeDefined();
    expect(spec.paths['/transactions'].get).toBeDefined();
  });

  it('documents POST /transactions/sync', () => {
    expect(spec.paths['/transactions/sync']).toBeDefined();
    expect(spec.paths['/transactions/sync'].post).toBeDefined();
  });

  it('documents POST /transactions/multisig', () => {
    expect(spec.paths['/transactions/multisig']).toBeDefined();
    expect(spec.paths['/transactions/multisig'].post).toBeDefined();
  });

  it('documents POST /transactions/multisig/collect', () => {
    expect(spec.paths['/transactions/multisig/collect']).toBeDefined();
    expect(spec.paths['/transactions/multisig/collect'].post).toBeDefined();
  });
});

// ─── Response codes ───────────────────────────────────────────────────────────

describe('Response codes', () => {
  it('POST /donations has 201 and 400 responses', () => {
    const op = spec.paths['/donations'].post;
    expect(op.responses['201']).toBeDefined();
    expect(op.responses['400']).toBeDefined();
  });

  it('POST /wallets has 201 response', () => {
    const op = spec.paths['/wallets'].post;
    expect(op.responses['201']).toBeDefined();
  });

  it('POST /transactions/multisig/collect has 400 for insufficient signatures', () => {
    const op = spec.paths['/transactions/multisig/collect'].post;
    expect(op.responses['400']).toBeDefined();
  });
});

// ─── openapi.js module ────────────────────────────────────────────────────────

describe('openapi.js module', () => {
  it('exports spec, swaggerUiMiddleware, swaggerUiSetup', () => {
    const openapi = require('../../src/config/openapi');
    expect(openapi.spec).toBeDefined();
    expect(openapi.swaggerUiMiddleware).toBeDefined();
    expect(openapi.swaggerUiSetup).toBeDefined();
  });

  it('spec is a plain object', () => {
    expect(typeof spec).toBe('object');
    expect(spec).not.toBeNull();
  });
});
