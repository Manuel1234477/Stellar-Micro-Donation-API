'use strict';

/**
 * URL redaction for logs (#1942)
 *
 * API keys must never be written to access logs, proxy logs or traces. Some
 * clients still send a key in a query string (for example the WebSocket
 * `?apiKey=` form), so any URL that is logged passes through redactUrl() first.
 */

const SENSITIVE_QUERY_PARAMS = ['apikey', 'api_key', 'access_token', 'token'];
const REDACTED = '[REDACTED]';

/**
 * Returns the URL with the values of sensitive query parameters replaced.
 * Returns non-string input unchanged and never throws.
 *
 * @param {string} url - a request path or URL, e.g. "/ws/balances?apiKey=abc"
 * @returns {string}
 */
function redactUrl(url) {
  if (typeof url !== 'string' || url.indexOf('?') === -1) return url;

  const [pathPart, ...rest] = url.split('?');
  const query = rest.join('?');
  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
      if (SENSITIVE_QUERY_PARAMS.includes(name)) {
        return `${eq === -1 ? pair : pair.slice(0, eq)}=${REDACTED}`;
      }
      return pair;
    })
    .join('&');

  return `${pathPart}?${redacted}`;
}

module.exports = { redactUrl, REDACTED };
