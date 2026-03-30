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
                message: { type: 'string' },
                code: { type: 'string' },
              },
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
    path.join(__dirname, '../routes/health.js'),
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
