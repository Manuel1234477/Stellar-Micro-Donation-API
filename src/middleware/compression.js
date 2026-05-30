/**
 * Response Compression Middleware
 *
 * Compresses JSON responses using Brotli or Gzip based on the client's
 * Accept-Encoding header. Responses below the size threshold or with
 * already-compressed content types are passed through unmodified.
 *
 * Configuration:
 *   - COMPRESSION_THRESHOLD_BYTES: min response size to compress (default 512)
 *   - COMPRESSION_LEVEL: compression level 1-9 for gzip, 0-11 for brotli (default 6)
 *
 * Flow:
 * 1. Check Accept-Encoding header to select algorithm (br > gzip)
 * 2. Intercept res.json() to capture the serialized body
 * 3. If body exceeds threshold, compress and set Content-Encoding header
 * 4. Skip compression for already-compressed content types and SSE/WebSocket
 */

const zlib = require('zlib');

/** Content types that are already compressed — skip re-compression */
const SKIP_CONTENT_TYPES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/x-brotli',
  'application/octet-stream',
];

/**
 * Determine whether the response content type should be skipped.
 * Skips SSE (text/event-stream) and already-compressed types.
 * @param {string} contentType - Value of the Content-Type header
 * @returns {boolean}
 */
function shouldSkip(contentType) {
  if (!contentType) return false;
  // Never compress SSE responses (breaks streaming)
  if (contentType.includes('text/event-stream')) return true;
  return SKIP_CONTENT_TYPES.some(prefix => contentType.includes(prefix));
}

/**
 * Select the best compression algorithm from the Accept-Encoding header.
 * Prefers Brotli over Gzip when both are accepted.
 * @param {string} acceptEncoding - Value of the Accept-Encoding header
 * @returns {'br'|'gzip'|null}
 */
function selectEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  if (acceptEncoding.includes('br')) return 'br';
  if (acceptEncoding.includes('gzip')) return 'gzip';
  return null;
}

/**
 * Compress a buffer synchronously.
 * @param {Buffer} buffer - Data to compress
 * @param {'br'|'gzip'} encoding - Compression algorithm
 * @param {number} level - Compression level (1–9 for gzip, 0–11 for brotli)
 * @returns {Buffer} Compressed data
 */
function compress(buffer, encoding, level) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level },
    });
  }
  return zlib.gzipSync(buffer, { level });
}

/**
 * Create compression middleware.
 * @param {object} [options]
 * @param {number} [options.threshold]  - Min response size in bytes to compress (default from env or 512)
 * @param {number} [options.level]      - Compression level (default from env or 6)
 * @returns {import('express').RequestHandler}
 */
function createCompressionMiddleware(options = {}) {
  const threshold = options.threshold ?? parseInt(process.env.COMPRESSION_THRESHOLD_BYTES, 10) ?? 512;
  const level = options.level ?? parseInt(process.env.COMPRESSION_LEVEL, 10) ?? 6;

  // Validate compression level
  if (level < 1 || level > 9) {
    throw new Error(`COMPRESSION_LEVEL must be between 1 and 9, got ${level}`);
  }

  return function compressionMiddleware(req, res, next) {
    // Skip compression for WebSocket upgrade requests
    if (req.headers.upgrade === 'websocket') {
      return next();
    }

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const encoding = selectEncoding(acceptEncoding);

    // No supported encoding requested — pass through
    if (!encoding) return next();

    // Wrap res.json to intercept the serialized body
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      const contentType = res.getHeader('Content-Type') || 'application/json';

      // Skip already-compressed content types and SSE
      if (shouldSkip(String(contentType))) {
        return originalJson(body);
      }

      const serialized = JSON.stringify(body);
      const buffer = Buffer.from(serialized, 'utf8');

      // Skip compression for small responses
      if (buffer.length < threshold) {
        return originalJson(body);
      }

      try {
        const compressed = compress(buffer, encoding, level);

        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Length', compressed.length);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.removeHeader('Transfer-Encoding');

        return res.end(compressed);
      } catch {
        // Compression failed — fall back to uncompressed response
        return originalJson(body);
      }
    };

    next();
  };
}

module.exports = { createCompressionMiddleware, shouldSkip, selectEncoding };
