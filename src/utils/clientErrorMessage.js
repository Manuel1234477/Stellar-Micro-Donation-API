/**
 * Client-Facing Error Message
 *
 * RESPONSIBILITY: Decide which error text a route may return to the client.
 * OWNER: Platform Team
 * DEPENDENCIES: log
 *
 * 4xx messages are deliberate feedback about the request, so they pass through.
 * 5xx messages can carry SQL fragments, file paths, or upstream URLs, so they are
 * logged server-side and replaced with a generic message (see issue #1889).
 */

const log = require('./log');

const GENERIC_SERVER_MESSAGE = 'An unexpected error occurred. Please try again later.';

/**
 * @param {string} context Log context, e.g. 'CONTRACTS'
 * @param {Error} err The caught error
 * @param {number} status The HTTP status the response will use
 * @param {string} [fallback] Generic text returned for 5xx responses
 * @returns {string} Message safe to include in the response body
 */
function clientErrorMessage(context, err, status, fallback = GENERIC_SERVER_MESSAGE) {
  if (status < 500) {
    return err.message;
  }

  log.error(context, 'Server error response sent with generic message', {
    status,
    name: err && err.name,
    error: err && err.message,
  });
  return fallback;
}

module.exports = { clientErrorMessage, GENERIC_SERVER_MESSAGE };
