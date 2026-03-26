/**
 * GraphQL Router — mounts the /graphql HTTP endpoint and WebSocket subscription server.
 *
 * RESPONSIBILITY: Wire the GraphQL schema to Express and graphql-ws.
 * OWNER: Backend Team
 * DEPENDENCIES: graphql-http, graphql-ws, existing API key middleware, service layer
 *
 * Security:
 *  - All requests (HTTP + WS) require a valid API key.
 *  - Introspection is disabled in production (NODE_ENV=production).
 *  - Query depth is limited to prevent deeply nested abuse.
 */

const { createHandler } = require('graphql-http/lib/use/express');
const { useServer } = require('graphql-ws/lib/use/ws');
const { WebSocketServer } = require('ws');
const { parse, validate, execute, subscribe } = require('graphql');
const { buildSchema } = require('./schema');
const pubsub = require('./pubsub');
const requireApiKey = require('../middleware/apiKey');
const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const WalletService = require('../services/WalletService');
const StatsService = require('../services/StatsService');
const log = require('../utils/log');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Maximum allowed query depth to prevent deeply nested abuse */
const MAX_QUERY_DEPTH = 5;

/**
 * Recursively compute the depth of a GraphQL selection set.
 * @param {object} selectionSet
 * @param {number} depth
 * @returns {number}
 */
function getQueryDepth(selectionSet, depth = 0) {
  if (!selectionSet || !selectionSet.selections) return depth;
  return Math.max(
    ...selectionSet.selections.map((s) =>
      getQueryDepth(s.selectionSet, depth + 1)
    )
  );
}

/**
 * Validate that a parsed document does not exceed MAX_QUERY_DEPTH.
 * @param {object} document - Parsed GraphQL document
 * @returns {{ valid: boolean, depth: number }}
 */
function checkDepth(document) {
  let maxDepth = 0;
  for (const def of document.definitions) {
    if (def.selectionSet) {
      const d = getQueryDepth(def.selectionSet);
      if (d > maxDepth) maxDepth = d;
    }
  }
  return { valid: maxDepth <= MAX_QUERY_DEPTH, depth: maxDepth };
}

// ─── Service instances ────────────────────────────────────────────────────────

const stellarService = getStellarService();
const donationService = new DonationService(stellarService);
const walletService = new WalletService(stellarService);

// StatsService uses only static methods — pass the class itself as the service object
const statsService = {
  getDailyStats: (...args) => StatsService.getDailyStats(...args),
  getSummaryStats: (...args) => StatsService.getSummaryStats(...args),
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = buildSchema({ donationService, walletService, statsService, pubsub });

// ─── HTTP handler ─────────────────────────────────────────────────────────────

/**
 * Express middleware that handles GraphQL over HTTP (POST /graphql).
 * Authentication is enforced by requireApiKey before this handler runs.
 */
const graphqlHttpHandler = createHandler({
  schema,
  /**
   * Build per-request context, injecting the authenticated API key info.
   * @param {object} req - Express request
   * @returns {{ apiKey: object }}
   */
  context: (req) => ({ apiKey: req.raw.apiKey }),

  /**
   * Validate the incoming document before execution.
   * Blocks introspection in production and enforces depth limits.
   * @param {object} args
   * @returns {readonly Error[] | undefined}
   */
  validate(args) {
    const errors = validate(args.schema, args.documentAST);
    if (errors.length > 0) return errors;

    // Block introspection in production
    if (IS_PRODUCTION) {
      for (const def of args.documentAST.definitions) {
        const src = def.selectionSet?.selections ?? [];
        const hasIntrospection = src.some(
          (s) => s.name?.value === '__schema' || s.name?.value === '__type'
        );
        if (hasIntrospection) {
          return [new Error('GraphQL introspection is disabled in production.')];
        }
      }
    }

    // Enforce query depth limit
    const { valid, depth } = checkDepth(args.documentAST);
    if (!valid) {
      return [
        new Error(
          `Query depth ${depth} exceeds maximum allowed depth of ${MAX_QUERY_DEPTH}.`
        ),
      ];
    }

    return undefined;
  },
});

// ─── WebSocket subscription server ───────────────────────────────────────────

/**
 * Attach a graphql-ws WebSocket server to an existing HTTP server.
 * Clients must supply their API key in the `connectionParams.apiKey` field.
 *
 * @param {import('http').Server} httpServer - The running HTTP server
 * @returns {object} graphql-ws server handle (call .dispose() on shutdown)
 */
function attachSubscriptionServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/graphql' });

  const wsServer = useServer(
    {
      schema,
      /**
       * Authenticate WebSocket connections via connectionParams.
       * @param {object} ctx - graphql-ws context
       * @returns {Promise<object>} context passed to resolvers
       */
      onConnect: async (ctx) => {
        const apiKey = ctx.connectionParams?.apiKey;
        if (!apiKey) {
          throw new Error('API key required');
        }

        // Reuse the same validation logic as the REST middleware
        const { validateKey } = require('../models/apiKeys');
        const { securityConfig } = require('../config/securityConfig');
        const legacyKeys = securityConfig.API_KEYS || [];

        const keyInfo = await validateKey(apiKey).catch(() => null);
        if (keyInfo) {
          return { apiKey: keyInfo };
        }
        if (legacyKeys.includes(apiKey)) {
          return { apiKey: { role: 'user', isLegacy: true } };
        }

        throw new Error('Invalid or expired API key');
      },
      context: (ctx) => ({ apiKey: ctx.extra?.apiKey ?? ctx.connectionParams }),
    },
    wss
  );

  log.info('GRAPHQL', 'WebSocket subscription server attached at /graphql');
  return wsServer;
}

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * Return an Express router that mounts the GraphQL HTTP endpoint.
 * Call attachSubscriptionServer(httpServer) separately after server.listen().
 *
 * @returns {import('express').Router}
 */
function createGraphQLRouter() {
  const express = require('express');
  const router = express.Router();

  // All GraphQL HTTP requests require a valid API key
  router.use(requireApiKey);

  // POST /graphql — execute queries and mutations
  router.post('/', graphqlHttpHandler);

  return router;
}

module.exports = { createGraphQLRouter, attachSubscriptionServer, pubsub, schema };
