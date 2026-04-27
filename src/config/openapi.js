'use strict';

/**
 * OpenAPI Specification Generator
 *
 * RESPONSIBILITY: Generate OpenAPI 3.0 spec from JSDoc annotations in route files.
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
    openapi: '3.0.0',
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
    path.join(__dirname, '../routes/wallet.js'),
    path.join(__dirname, '../routes/stream.js'),
    path.join(__dirname, '../routes/transaction.js'),
    path.join(__dirname, '../routes/stats.js'),
    path.join(__dirname, '../routes/app.js'),
    path.join(__dirname, '../routes/liquidity-pools.js'),
    path.join(__dirname, '../routes/admin/auditLogExport.js'),
  ],
};

/** @type {object} Generated OpenAPI 3.0 specification */
const spec = swaggerJsdoc(options);

/** Express middleware array for serving Swagger UI */
const swaggerUiMiddleware = swaggerUi.serve;

/**
 * Express handler that renders the Swagger UI page.
 * @type {Function}
 */
const swaggerUiSetup = swaggerUi.setup(spec, {
  customSiteTitle: 'Stellar Micro-Donation API Docs',
});

module.exports = { spec, swaggerUiMiddleware, swaggerUiSetup };
