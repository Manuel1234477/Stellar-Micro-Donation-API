/**
 * Version routing middleware
 * 
 * RESPONSIBILITY: Version detection, header injection, and dispatching to correct router
 */

const API_VERSIONS = {
  '1': {
    deprecated: false,
    sunsetDate: null
  },
  '0': { // Deprecated test version
    deprecated: true,
    sunsetDate: '2026-12-31'
  }
};

const DEFAULT_VERSION = '1';

/**
 * Determine the API version from request
 * @param {Express.Request} req 
 * @returns {string} The requested version
 */
function determineVersion(req) {
  // 1. Check URL path (e.g., /api/v1/wallets)
  const urlMatch = req.url.match(/^\/api\/v(\d+)(\/|$)/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  // 2. Check Accept header (e.g., application/json; version=1 or application/vnd.company.v1+json)
  const acceptHeader = req.headers.accept;
  if (acceptHeader) {
    const acceptVersionMatch = acceptHeader.match(/version\s*=\s*(\d+)/i) || acceptHeader.match(/v=(\d+)/i);
    if (acceptVersionMatch) {
      return acceptVersionMatch[1];
    }
    const vendorVersionMatch = acceptHeader.match(/vnd\.[^.]+\.v(\d+)\+/i) || acceptHeader.match(/vnd\.v(\d+)\+/i);
    if (vendorVersionMatch) {
      return vendorVersionMatch[1];
    }
  }

  // Default
  return DEFAULT_VERSION;
}

/**
 * Version routing middleware
 * @param {Object} routers Map of version numbers to Express routers
 */
function apiVersionMiddleware(routers) {
  return (req, res, next) => {
    // Determine version
    const version = determineVersion(req);

    const versionInfo = API_VERSIONS[version];
    if (!versionInfo) {
      return res.status(404).json({
        error: 'Unsupported API version',
        requestedVersion: version
      });
    }

    // Inject required headers
    res.setHeader('X-API-Version', version);
    if (versionInfo.deprecated) {
      res.setHeader('X-API-Deprecated', 'true');
      if (versionInfo.sunsetDate) {
        res.setHeader('Sunset', versionInfo.sunsetDate);
        res.setHeader('Warning', `199 - "API version ${version} is deprecated and will be removed on ${versionInfo.sunsetDate}"`);
      }
    }

    req.apiVersion = version;

    // Dispatch to the mapped router
    const router = routers[version];
    if (router) {
      const prefix = `/api/v${version}`;
      if (req.url.toLowerCase().startsWith(prefix)) {
        // Strip the prefix so the inner router can match correctly
        const originalUrl = req.url;
        req.url = req.url.slice(prefix.length) || '/';
        
        router(req, res, (err) => {
          // Restore on fallback to next
          req.url = originalUrl;
          next(err);
        });
      } else {
        // Assume path is already matching inner routes (e.g., fallback original URLs without prefix)
        router(req, res, next);
      }
    } else {
      next();
    }
  };
}

module.exports = apiVersionMiddleware;
module.exports.determineVersion = determineVersion;
module.exports.API_VERSIONS = API_VERSIONS;
