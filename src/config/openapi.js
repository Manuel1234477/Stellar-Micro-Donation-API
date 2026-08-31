'use strict';

/**
 * OpenAPI Specification Generator
 *
 * RESPONSIBILITY: Generate OpenAPI 3.1 spec from JSDoc annotations in route files.
 * OWNER: Platform Team
 *
 * Usage:
 *   const { spec, swaggerUiMiddleware } = require('./openapi');
 *   app.use('/api/docs', ...swaggerUiMiddleware);
 *   app.get('/api/openapi.json', (req, res) => res.json(spec));
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'Stellar Micro-Donation API',
      version: '1.0.0',
      description: 'API for managing micro-donations on the Stellar blockchain network.',
    },
    servers: [{ url: '/', description: 'Current server' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key passed in the x-api-key header. Obtain via `npm run keys:create`.',
        },
      },
      headers: {
        XRequestID: {
          description:
            'Unique identifier for the request. Include this in support requests to correlate client activity with server logs. ' +
            'If you supply a valid UUID v4 in the `X-Request-ID` request header the server echoes it back; ' +
            'otherwise the server generates one automatically.',
          schema: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
        },
        XSchemaVersion: {
          description:
            'Request-body schema variant. Accepted values are full semver strings (e.g. "1.0.0", "2.0.0"). ' +
            'An integer shorthand (e.g. "1") is also accepted and is normalised to "1.0.0" for backward compatibility. ' +
            'Omitting this header selects the latest stable schema for the endpoint. ' +
            'Supported versions for a given endpoint are listed in the X-Schema-Version-Supported response header. ' +
            'NOTE: this header governs the request-body schema only — it is independent of the URL API version ' +
            '(/api/v1). The URL version changes only on breaking (MAJOR) API releases.',
          schema: { type: 'string', example: '1.0.0' },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string', example: 'Validation failed' },
                code: { type: 'string', example: 'VALIDATION_ERROR' },
              },
            },
          },
        },
        ValidationError: {
          allOf: [
            { $ref: '#/components/schemas/Error' },
            {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'VALIDATION_ERROR' },
                    message: { type: 'string', example: 'Invalid request parameters' },
                    details: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          field: { type: 'string' },
                          message: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
        UnauthorizedError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'UNAUTHORIZED' },
                message: { type: 'string', example: 'Invalid or missing API key' },
              },
            },
          },
        },
        NotFoundError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: 'Resource not found' },
              },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            limit: { type: 'integer', example: 20 },
            direction: { type: 'string', enum: ['next', 'prev'], example: 'next' },
            next_cursor: { type: 'string', nullable: true, example: 'eyJ0aW1lc3RhbXAiOiIyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6IjEifQ==' },
            prev_cursor: { type: 'string', nullable: true, example: null },
          },
        },
        // ── /api/v2 standardized response envelope (Issue #1553) ──────────────
        // Note: this is a different, unrelated envelope from Error/PaginationMeta
        // above, which describe the /api/v1 { success, ... } shape. /api/v2 has
        // no `success` field at all.
        V2ListMeta: {
          type: 'object',
          description: 'Pagination metadata for a /api/v2 list response.',
          properties: {
            total: { type: 'integer', example: 42, description: 'Total matching items across all pages.' },
            page: { type: 'integer', nullable: true, example: 1 },
            pageSize: { type: 'integer', nullable: true, example: 20 },
            cursor: { type: 'string', nullable: true, example: 'MjA=', description: 'Opaque cursor for the next page, base64-encoded; null on the last page.' },
          },
        },
        V2Error: {
          type: 'object',
          description: 'Error envelope returned by every /api/v2 endpoint. Unlike /api/v1, there is no top-level `success` field.',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: 'Resource not found' },
                requestId: { type: 'string', nullable: true, example: '550e8400-e29b-41d4-a716-446655440000' },
                timestamp: { type: 'string', format: 'date-time', example: '2026-08-30T09:00:00.000Z' },
              },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid API key',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UnauthorizedError' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NotFoundError' },
            },
          },
        },
        V2Error: {
          description: '/api/v2 error envelope: { error: { code, message, requestId, timestamp } }',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/V2Error' },
            },
          },
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ValidationError' },
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: [
    path.join(__dirname, '../routes/donation.js'),
    path.join(__dirname, '../routes/donations/notes.js'),
    path.join(__dirname, '../routes/wallet.js'),
    path.join(__dirname, '../routes/wallets/*.js'),
    path.join(__dirname, '../routes/stream.js'),
    path.join(__dirname, '../routes/transaction.js'),
    path.join(__dirname, '../routes/stats.js'),
    path.join(__dirname, '../app.js'),
    path.join(__dirname, '../routes/liquidity-pools.js'),
    path.join(__dirname, '../routes/campaigns.js'),
    path.join(__dirname, '../routes/assets.js'),
    path.join(__dirname, '../routes/tiers.js'),
    path.join(__dirname, '../routes/offers.js'),
    path.join(__dirname, '../routes/leaderboard.js'),
    path.join(__dirname, '../routes/tags.js'),
    path.join(__dirname, '../routes/receipt.js'),
    path.join(__dirname, '../routes/disputes.js'),
    path.join(__dirname, '../routes/recurringDonation.js'),
    path.join(__dirname, '../routes/auth.js'),
    path.join(__dirname, '../routes/admin/auditLogExport.js'),
    path.join(__dirname, '../routes/v2/donations.js'),
    path.join(__dirname, '../routes/v2/wallets.js'),
    path.join(__dirname, '../routes/v2/corporateMatching.js'),
  ],
};

/** @type {object} Generated OpenAPI 3.1 specification */
let spec = swaggerJsdoc(options);

/**
 * Ensure deterministic ordering of all keys in the spec (byte-stable output).
 * This guarantees the serialized JSON is identical across runs.
 * @param {object} obj - Object to sort keys
 * @returns {object} Object with keys sorted recursively
 */
function sortObjectKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  } else if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((result, key) => {
        result[key] = sortObjectKeys(obj[key]);
        return result;
      }, {});
  }
  return obj;
}

// Sort spec keys for byte-stable output
spec = sortObjectKeys(spec);

/** Express middleware array for serving Swagger UI */
const swaggerUiMiddleware = swaggerUi.serve;

/**
 * Express handler that renders the Swagger UI page.
 * @type {Function}
 */
const swaggerUiSetup = swaggerUi.setup(spec, {
  customSiteTitle: 'Stellar Micro-Donation API Docs',
});

module.exports = { spec, swaggerUiMiddleware, swaggerUiSetup, sortObjectKeys };
