/**
 * Shared helpers for HTTP → WebSocket upgrade handling.
 *
 * Several WebSocket servers (GraphQL subscriptions, balance streaming) share one
 * HTTP server. Each must act ONLY on its own pathname and leave every other
 * upgrade request alone, so that no listener destroys or rejects another
 * transport's handshake. Unknown paths are rejected once, by a single fallback
 * listener, with 404. (#1980)
 */

'use strict';

/**
 * Extract the pathname (no query string) from an upgrade request.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function upgradePathname(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname;
  } catch (_) {
    return '';
  }
}

/**
 * Register a single fallback 'upgrade' listener that rejects any upgrade whose
 * pathname is not in `knownPaths` with 404 and closes the socket. Known paths are
 * passed through untouched for their own listeners to handle.
 *
 * @param {import('http').Server} server
 * @param {string[]} knownPaths
 */
function attachUnknownUpgradeFallback(server, knownPaths) {
  const known = new Set(knownPaths);
  server.on('upgrade', (req, socket) => {
    if (known.has(upgradePathname(req))) return;
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  });
}

module.exports = { upgradePathname, attachUnknownUpgradeFallback };
