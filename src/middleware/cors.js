/**
 * CORS Middleware - Cross-Origin Resource Sharing Configuration
 *
 * RESPONSIBILITY: Enforce strict CORS policies for all API responses
 * OWNER: Security Team
 * DEPENDENCIES: None (pure Node.js)
 *
 * Reads allowed origins from CORS_ALLOWED_ORIGINS env var (comma-separated).
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

/**
 * Parse and validate the CORS_ALLOWED_ORIGINS environment variable.
 * Returns an array of allowed origin strings/patterns.
 *
 * @param {string} [raw] - Raw env value, defaults to process.env.CORS_ALLOWED_ORIGINS
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
  // Escape the rest of the domain and anchor the regex
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
    // Exact match
    if (allowed === origin) return true;
    // Wildcard subdomain match
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
 * Reads configuration from environment variables:
 *   - CORS_ALLOWED_ORIGINS  Comma-separated list of allowed origins (required for any CORS)
 *   - CORS_ALLOWED_METHODS  Override default allowed HTTP methods
 *   - CORS_ALLOWED_HEADERS  Override default allowed request headers
 *   - CORS_MAX_AGE          Preflight cache duration in seconds (default: 86400)
 *
 * @param {Object} [options] - Optional overrides (useful in tests)
 * @param {string[]} [options.allowedOrigins] - Override parsed origins
 * @param {string}   [options.methods]        - Override allowed methods
 * @param {string}   [options.headers]        - Override allowed headers
 * @param {number}   [options.maxAge]         - Override max-age seconds
 * @returns {Function} Express middleware
 */
function createCorsMiddleware(options = {}) {
  const allowedOrigins = options.allowedOrigins !== undefined
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

  validateCorsConfig(allowedOrigins);

  /**
   * CORS middleware function
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;

    if (!origin) {
      // Same-origin or non-browser request — no CORS headers needed
      return next();
    }

    if (!isOriginAllowed(origin, allowedOrigins)) {
      log.warn('CORS', 'Rejected request from disallowed origin', {
        origin,
        method: req.method,
        path: req.path,
      });

      // For preflight, return 403 immediately
      if (req.method === 'OPTIONS') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CORS_ORIGIN_NOT_ALLOWED',
            message: 'Origin not allowed by CORS policy',
          },
        });
      }

      // For actual requests from disallowed origins, reject with 403
      return res.status(403).json({
        success: false,
        error: {
          code: 'CORS_ORIGIN_NOT_ALLOWED',
          message: 'Origin not allowed by CORS policy',
        },
      });
    }

    // Origin is allowed — set CORS headers
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight
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
  CORS_DEFAULTS,
};
