/**
 * CORS Middleware - Cross-Origin Resource Sharing Configuration
 *
 * RESPONSIBILITY: Enforce strict CORS policies for all API responses
 * OWNER: Security Team
 * DEPENDENCIES: Database (for runtime allowlist), log utility
 *
 * Reads allowed origins from:
 *   1. Database cors_origins table (runtime, cached 60s TTL)
 *   2. CORS_ALLOWED_ORIGINS env var (static fallback)
 *
 * Supports exact matches and wildcard subdomain patterns (e.g. *.example.com).
 * Preflight responses are cached via Access-Control-Max-Age.
 */

const log = require('../utils/log');

/**
 * Default CORS configuration values
 */
const CORS_DEFAULTS = {
  methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  headers: 'Content-Type,Authorization,X-API-Key,X-Request-ID,X-Idempotency-Key',
  maxAge: 86400, // 24 hours in seconds
};

/** In-memory cache for DB allowlist */
const _cache = {
  origins: null,
  expiresAt: 0,
  TTL_MS: 60 * 1000, // 60 seconds
};

/**
 * Invalidate the in-memory allowlist cache.
 * Call this after adding or removing an origin.
 */
function invalidateCache() {
  _cache.origins = null;
  _cache.expiresAt = 0;
}

/**
 * Load allowed origins from the database, using a 60-second TTL cache.
 *
 * @returns {Promise<string[]>} Array of origin strings/patterns
 */
async function loadDbOrigins() {
  const now = Date.now();
  if (_cache.origins !== null && now < _cache.expiresAt) {
    return _cache.origins;
  }

  try {
    const Database = require('../utils/database');
    const rows = await Database.query('SELECT origin FROM cors_origins ORDER BY id ASC', []);
    const origins = rows.map(r => r.origin);
    _cache.origins = origins;
    _cache.expiresAt = now + _cache.TTL_MS;
    return origins;
  } catch (err) {
    // Table may not exist yet during startup — fall back to empty
    log.warn('CORS', 'Failed to load DB origins, using empty list', { error: err.message });
    return [];
  }
}

/**
 * Parse and validate the CORS_ALLOWED_ORIGINS environment variable.
 * Returns an array of allowed origin strings/patterns.
 *
 * @param {string} [raw] - Raw allowlist env value
 * @returns {string[]} Parsed list of allowed origins
 */
function parseAllowedOrigins(raw) {
  const value = raw !== undefined ? raw : (process.env.CORS_ALLOWED_ORIGINS || '');
  if (!value || !value.trim()) return [];
  return value
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

/**
 * Convert a wildcard subdomain pattern (e.g. *.example.com) to a RegExp.
 * Only the leading `*` wildcard is supported.
 *
 * @param {string} pattern - Origin pattern, may start with `*.`
 * @returns {RegExp|null} Compiled regex, or null if not a wildcard pattern
 */
function wildcardToRegex(pattern) {
  if (!pattern.startsWith('*.')) return null;
  const escaped = pattern.slice(2).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https?://[^.]+\\.${escaped}$`);
}

/**
 * Determine whether a given origin is allowed by the allowlist.
 *
 * @param {string} origin - The Origin header value from the request
 * @param {string[]} allowedOrigins - List of allowed origins/patterns
 * @returns {boolean}
 */
function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  for (const allowed of allowedOrigins) {
    if (allowed === origin) return true;
    const regex = wildcardToRegex(allowed);
    if (regex && regex.test(origin)) return true;
  }
  return false;
}

/**
 * Validate CORS configuration on startup and warn about issues.
 *
 * @param {string[]} allowedOrigins
 */
function validateCorsConfig(allowedOrigins) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (allowedOrigins.length === 0) {
    if (isProduction) {
      log.warn('CORS', 'CORS_ALLOWED_ORIGINS is not set in production — all cross-origin requests will be rejected');
    } else {
      log.info('CORS', 'CORS_ALLOWED_ORIGINS not set — CORS disabled (all origins rejected)');
    }
  } else {
    log.info('CORS', 'CORS configured', { origins: allowedOrigins.length });
  }
}

/**
 * Create the CORS middleware.
 *
 * Reads configuration from:
 *   - Database cors_origins table (runtime, 60s TTL cache)
 *   - CORS_ALLOWED_ORIGINS env var (static fallback/supplement)
 *   - CORS_ALLOWED_METHODS, CORS_ALLOWED_HEADERS, CORS_MAX_AGE env vars
 *
 * @param {Object} [options] - Optional overrides (useful in tests)
 * @param {string[]} [options.allowedOrigins] - Override parsed origins (disables DB lookup)
 * @param {string}   [options.methods]        - Override allowed methods
 * @param {string}   [options.headers]        - Override allowed headers
 * @param {number}   [options.maxAge]         - Override max-age seconds
 * @param {boolean}  [options.skipDbLookup]   - Skip DB lookup (use only static origins)
 * @returns {Function} Express middleware
 */
function createCorsMiddleware(options = {}) {
  const staticOrigins = options.allowedOrigins !== undefined
    ? options.allowedOrigins
    : parseAllowedOrigins();

  const methods = options.methods
    || process.env.CORS_ALLOWED_METHODS
    || CORS_DEFAULTS.methods;

  const headers = options.headers
    || process.env.CORS_ALLOWED_HEADERS
    || CORS_DEFAULTS.headers;

  const maxAge = options.maxAge !== undefined
    ? options.maxAge
    : parseInt(process.env.CORS_MAX_AGE || String(CORS_DEFAULTS.maxAge), 10);

  const skipDbLookup = options.skipDbLookup === true || options.allowedOrigins !== undefined;

  validateCorsConfig(staticOrigins);

  /**
   * CORS middleware function
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return async function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (!origin) {
      return next();
    }

    // Merge static origins with DB origins
    let allowedOrigins = staticOrigins;
    if (!skipDbLookup) {
      const dbOrigins = await loadDbOrigins();
      if (dbOrigins.length > 0) {
        allowedOrigins = [...new Set([...staticOrigins, ...dbOrigins])];
      }
    }

    if (!isOriginAllowed(origin, allowedOrigins)) {
      log.warn('CORS', 'Rejected request from disallowed origin', {
        origin,
        method: req.method,
        path: req.path,
      });

      if (req.method === 'OPTIONS') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CORS_ORIGIN_NOT_ALLOWED',
            message: 'Origin not allowed by CORS policy',
          },
        });
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'CORS_ORIGIN_NOT_ALLOWED',
          message: 'Origin not allowed by CORS policy',
        },
      });
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Max-Age', String(maxAge));
      return res.status(204).end();
    }

    return next();
  };
}

module.exports = {
  createCorsMiddleware,
  parseAllowedOrigins,
  isOriginAllowed,
  wildcardToRegex,
  validateCorsConfig,
  loadDbOrigins,
  invalidateCache,
  CORS_DEFAULTS,
  _cache,
};
