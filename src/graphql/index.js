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
const { useServer } = require('graphql-ws/use/ws');
const { WebSocketServer } = require('ws');
const { validate } = require('graphql');
const { buildSchema } = require('./schema');
const pubsub = require('./pubsub');
const requireApiKey = require('../middleware/apiKey');
const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const WalletService = require('../services/WalletService');
const StatsService = require('../services/StatsService');
const log = require('../utils/log');
const { parseLanguage, getMessage } = require('../utils/i18n');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Maximum allowed query depth to prevent deeply nested abuse */
const MAX_QUERY_DEPTH = parseInt(process.env.GRAPHQL_MAX_DEPTH || '6', 10);

/**
 * Default complexity budget.  Configurable via GRAPHQL_MAX_COMPLEXITY env var.
 * Each scalar/leaf field costs 1 point; list fields cost a multiplier (default 10).
 */
const MAX_QUERY_COMPLEXITY = parseInt(process.env.GRAPHQL_MAX_COMPLEXITY || '1000', 10);

/**
 * Per-field complexity cost multiplier for list fields.
 * Configurable via GRAPHQL_LIST_FIELD_COST env var.
 */
const LIST_FIELD_COST = parseInt(process.env.GRAPHQL_LIST_FIELD_COST || '10', 10);

/**
 * Names of fields considered "list" fields for complexity scoring.
 * Extend this set when new list-returning fields are added to the schema.
 */
const LIST_FIELD_NAMES = new Set([
  'donations', 'wallets', 'recentDonations', 'dailyStats',
]);

/**
 * Compute a hashed fingerprint of a query document for security logging.
 * Uses the query source string to produce a short, stable identifier.
 *
 * @param {object} document - Parsed GraphQL document
 * @returns {string} Short hex fingerprint
 */
function hashQuery(document) {
  try {
    const { createHash } = require('crypto');
    const src = document.loc?.source?.body || JSON.stringify(document.definitions);
    return createHash('sha256').update(src).digest('hex').slice(0, 16);
  } catch (_) {
    return 'unknown';
  }
}

/**
 * Build a lookup map of fragment name -> FragmentDefinition node from a parsed document.
 * Required so that FragmentSpread nodes can be resolved to their full selection sets
 * when computing query depth. Without this map, fragment spreads silently halt
 * depth recursion, allowing chained fragments (A → B → C) to bypass MAX_QUERY_DEPTH.
 *
 * @param {object} document - Parsed GraphQL document
 * @returns {Map<string, object>} Fragment name to FragmentDefinition node
 */
function buildFragmentMap(document) {
  const map = new Map();
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') {
      map.set(def.name.value, def);
    }
  }
  return map;
}

/**
 * Recursively compute the depth of a GraphQL selection set, resolving
 * FragmentSpread nodes to their definitions so chained fragment spreads
 * (Fragment A → B → C) accumulate depth correctly toward MAX_QUERY_DEPTH.
 *
 * @param {object} selectionSet - AST SelectionSet node
 * @param {Map<string, object>} fragmentMap - Fragment name → FragmentDefinition
 * @param {number} depth - Current accumulated depth
 * @param {Set<string>} visited - Fragment names already on the current call stack
 *   (cycle guard: prevents infinite recursion from circular fragment references)
 * @returns {number} Maximum depth reached within this selection set
 */
function getQueryDepth(selectionSet, fragmentMap, depth = 0, visited = new Set()) {
  if (!selectionSet || !selectionSet.selections) return depth;

  let max = depth;
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'FragmentSpread') {
      // Resolve the fragment spread to its definition and recurse into it.
      // The depth does NOT increase at the spread site itself — it increases
      // when we step into the fragment's own child fields.
      const fragName = selection.name.value;
      if (!visited.has(fragName)) {
        const fragDef = fragmentMap.get(fragName);
        if (fragDef && fragDef.selectionSet) {
          // Mark visited before recursing to guard against circular fragments
          const nextVisited = new Set(visited).add(fragName);
          const d = getQueryDepth(fragDef.selectionSet, fragmentMap, depth, nextVisited);
          if (d > max) max = d;
        }
      }
    } else if (selection.kind === 'InlineFragment') {
      // Inline fragments are traversed in-place; they don't add depth themselves
      const d = getQueryDepth(selection.selectionSet, fragmentMap, depth, visited);
      if (d > max) max = d;
    } else {
      // Regular field — step one level deeper
      const d = getQueryDepth(selection.selectionSet, fragmentMap, depth + 1, visited);
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * Validate that a parsed document does not exceed MAX_QUERY_DEPTH.
 * Fragments are fully resolved before measuring depth so that chained
 * fragment spreads cannot bypass the limit (#1368).
 *
 * @param {object} document - Parsed GraphQL document
 * @returns {{ valid: boolean, depth: number }}
 */
function checkDepth(document) {
  const fragmentMap = buildFragmentMap(document);
  let maxDepth = 0;
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') continue; // checked via spread resolution
    if (def.selectionSet) {
      const d = getQueryDepth(def.selectionSet, fragmentMap);
      if (d > maxDepth) maxDepth = d;
    }
  }
  return { valid: maxDepth <= MAX_QUERY_DEPTH, depth: maxDepth };
}

/**
 * Recursively compute a complexity score for a GraphQL selection set.
 *
 * Scoring rules:
 *  - Each regular field costs 1 point.
 *  - List fields (names in LIST_FIELD_NAMES) are multiplied by LIST_FIELD_COST
 *    because they resolve multiple objects.
 *  - Fragment spreads are resolved to their definitions and scored.
 *  - Inline fragments are scored without extra cost.
 *  - Circular fragment references are guarded by a visited set.
 *
 * @param {object}              selectionSet - AST SelectionSet node
 * @param {Map<string, object>} fragmentMap  - Fragment name → definition
 * @param {Set<string>}         visited      - Fragment names on the current call stack
 * @returns {number} Total complexity cost
 */
function computeComplexity(selectionSet, fragmentMap, visited = new Set()) {
  if (!selectionSet || !selectionSet.selections) return 0;

  let total = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'FragmentSpread') {
      const fragName = selection.name.value;
      if (!visited.has(fragName)) {
        const fragDef = fragmentMap.get(fragName);
        if (fragDef && fragDef.selectionSet) {
          const nextVisited = new Set(visited).add(fragName);
          total += computeComplexity(fragDef.selectionSet, fragmentMap, nextVisited);
        }
      }
    } else if (selection.kind === 'InlineFragment') {
      total += computeComplexity(selection.selectionSet, fragmentMap, visited);
    } else {
      // Regular field
      const fieldName = selection.name?.value;
      const fieldCost = LIST_FIELD_NAMES.has(fieldName) ? LIST_FIELD_COST : 1;
      total += fieldCost;
      if (selection.selectionSet) {
        const childCost = computeComplexity(selection.selectionSet, fragmentMap, visited);
        // Child complexity is multiplied by the parent's list cost to model
        // the fact that each element in a list resolves all child fields.
        total += childCost * (LIST_FIELD_NAMES.has(fieldName) ? LIST_FIELD_COST : 1);
      }
    }
  }
  return total;
}

/**
 * Validate that a parsed document does not exceed MAX_QUERY_COMPLEXITY.
 *
 * @param {object} document - Parsed GraphQL document
 * @returns {{ valid: boolean, complexity: number }}
 */
function checkComplexity(document) {
  const fragmentMap = buildFragmentMap(document);
  let totalComplexity = 0;
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') continue;
    if (def.selectionSet) {
      totalComplexity += computeComplexity(def.selectionSet, fragmentMap);
    }
  }
  return { valid: totalComplexity <= MAX_QUERY_COMPLEXITY, complexity: totalComplexity };
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

// ─── Error sanitization ───────────────────────────────────────────────────────

/** Patterns that might expose sensitive implementation details in production. */
const SENSITIVE_PATTERNS = [
  /database|db|sql|query/gi,
  /file|path|directory|folder/gi,
  /internal|system|server|infrastructure/gi,
  /stack|trace|exception/gi,
  /password|secret|key|token|credential/gi,
  /localhost|127\.0\.0\.1|internal|private/gi,
  /\.js|\.json|\.env|config/gi,
];

/**
 * Sanitize a GraphQL error before it reaches the client.
 *
 * Routes every error through the same sanitization, i18n, and request-ID
 * injection pipeline that src/middleware/errorHandler.js applies to REST errors,
 * so both API surfaces present an equally-safe error contract.
 *
 * @param {import('graphql').GraphQLError} err   - The original GraphQL error
 * @param {object}                         reqCtx - Per-request context from createHandler
 * @returns {import('graphql').GraphQLError}      - Sanitized error safe for the client
 */
function sanitizeGraphQLError(err, reqCtx) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Resolve correlation/request ID from context (injected by requestId middleware)
  const requestId = reqCtx?.raw?.id || reqCtx?.raw?.headers?.['x-request-id'];
  const lang = parseLanguage(
    reqCtx?.raw?.headers?.['accept-language']
  );

  // Log the original error server-side (never exposes stack to client)
  log.error('GRAPHQL_ERROR', 'GraphQL error occurred', {
    requestId,
    message: err.message,
    path: err.path,
    locations: err.locations,
    stack: err.stack, // server-side only
  });

  // Translate the message via the i18n catalogue when possible
  const translated = getMessage('INTERNAL_ERROR', lang);

  let safeMessage = err.message;

  if (isProduction) {
    // Check whether the original message contains sensitive implementation details
    const hasSensitiveContent = SENSITIVE_PATTERNS.some((p) => p.test(err.message));
    if (hasSensitiveContent || !err.originalError) {
      // Unexpected / unhandled errors → opaque message
      safeMessage = translated || 'An internal error occurred. Please try again later.';
    }
  }

  // Build an extensions bag consistent with the REST error contract
  const extensions = {
    ...(err.extensions || {}),
    requestId,
    timestamp: new Date().toISOString(),
  };

  return new err.constructor(safeMessage, {
    nodes: err.nodes,
    source: err.source,
    positions: err.positions,
    path: err.path,
    originalError: err.originalError,
    extensions,
  });
}

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
   * Blocks introspection in production and enforces depth/complexity limits.
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

    // Enforce query depth limit (#1594)
    const { valid: depthValid, depth } = checkDepth(args.documentAST);
    if (!depthValid) {
      const queryHash = hashQuery(args.documentAST);
      log.warn('GRAPHQL_SECURITY', 'Query depth limit exceeded', {
        depth,
        maxDepth: MAX_QUERY_DEPTH,
        queryHash,
        code: 'QUERY_DEPTH_EXCEEDED',
      });
      const err = new Error(
        `Query depth ${depth} exceeds maximum allowed depth of ${MAX_QUERY_DEPTH}.`
      );
      err.extensions = { code: 'QUERY_DEPTH_EXCEEDED' };
      return [err];
    }

    // Enforce query complexity budget (#1594)
    const { valid: complexityValid, complexity } = checkComplexity(args.documentAST);
    if (!complexityValid) {
      const queryHash = hashQuery(args.documentAST);
      log.warn('GRAPHQL_SECURITY', 'Query complexity budget exceeded', {
        complexity,
        maxComplexity: MAX_QUERY_COMPLEXITY,
        queryHash,
        code: 'QUERY_COMPLEXITY_EXCEEDED',
      });
      const err = new Error(
        `Query complexity ${complexity} exceeds maximum allowed budget of ${MAX_QUERY_COMPLEXITY}.`
      );
      err.extensions = { code: 'QUERY_COMPLEXITY_EXCEEDED' };
      return [err];
    }

    return undefined;
  },

  /**
   * Sanitize errors before they reach the client.
   *
   * Routes every GraphQL error through the same sanitization, i18n, and
   * request-ID injection pipeline used by src/middleware/errorHandler.js,
   * so both the REST and GraphQL API surfaces present a consistent,
   * equally-safe error contract. Raw database errors or stack traces that
   * bubble up from resolvers are redacted in production.
   *
   * @param {import('graphql').GraphQLError} err     - Original error
   * @param {object}                         reqCtx  - Request context from createHandler
   * @returns {import('graphql').GraphQLError}       - Sanitized error
   */
  formatError(err, reqCtx) {
    return sanitizeGraphQLError(err, reqCtx);
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

      /**
       * Validate each incoming subscription document before execution.
       * Applies the same introspection-blocking and depth/complexity-limiting rules used
       * by the HTTP handler, so WebSocket subscribers cannot bypass security
       * by bypassing the HTTP layer. (#1369, #1594)
       *
       * @param {object} ctx - graphql-ws context (ctx.extra.apiKey is set after onConnect)
       * @param {object} msg - The subscribe message containing the document
       * @param {object} args - Execution args including schema and document
       * @returns {readonly GraphQLError[] | void} Return errors to reject the subscription
       */
      onSubscribe: (ctx, msg, args) => {
        // args may be undefined in some graphql-ws versions; fall back to parsing msg
        const document = args?.document;
        if (!document) return;

        // Standard GraphQL validation
        const validationErrors = validate(args.schema || schema, document);
        if (validationErrors.length > 0) return validationErrors;

        // Block introspection in production (#1369)
        if (IS_PRODUCTION) {
          for (const def of document.definitions) {
            const src = def.selectionSet?.selections ?? [];
            const hasIntrospection = src.some(
              (s) => s.name?.value === '__schema' || s.name?.value === '__type'
            );
            if (hasIntrospection) {
              return [new Error('GraphQL introspection is disabled in production.')];
            }
          }
        }

        // Enforce query depth limit (#1369)
        const { valid: depthValid, depth } = checkDepth(document);
        if (!depthValid) {
          const queryHash = hashQuery(document);
          log.warn('GRAPHQL_SECURITY', 'Subscription depth limit exceeded', {
            depth, maxDepth: MAX_QUERY_DEPTH, queryHash, code: 'QUERY_DEPTH_EXCEEDED',
          });
          const err = new Error(`Query depth ${depth} exceeds maximum allowed depth of ${MAX_QUERY_DEPTH}.`);
          err.extensions = { code: 'QUERY_DEPTH_EXCEEDED' };
          return [err];
        }

        // Enforce query complexity budget (#1594)
        const { valid: complexityValid, complexity } = checkComplexity(document);
        if (!complexityValid) {
          const queryHash = hashQuery(document);
          log.warn('GRAPHQL_SECURITY', 'Subscription complexity budget exceeded', {
            complexity, maxComplexity: MAX_QUERY_COMPLEXITY, queryHash, code: 'QUERY_COMPLEXITY_EXCEEDED',
          });
          const err = new Error(`Query complexity ${complexity} exceeds maximum allowed budget of ${MAX_QUERY_COMPLEXITY}.`);
          err.extensions = { code: 'QUERY_COMPLEXITY_EXCEEDED' };
          return [err];
        }
      },

      /**
       * Build per-subscription resolver context from the authenticated connection.
       * Only trust ctx.extra.apiKey — populated by onConnect after successful auth.
       * Do NOT fall back to raw connectionParams, which are unauthenticated. (#1370)
       *
       * @param {object} ctx - graphql-ws context
       * @returns {{ apiKey: object|null }}
       */
      context: (ctx) => ({ apiKey: ctx.extra?.apiKey ?? null }),
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

module.exports = {
  createGraphQLRouter,
  attachSubscriptionServer,
  pubsub,
  schema,
  // Exported for testing (#1594)
  checkDepth,
  checkComplexity,
  computeComplexity,
  hashQuery,
  MAX_QUERY_DEPTH,
  MAX_QUERY_COMPLEXITY,
  LIST_FIELD_COST,
};
