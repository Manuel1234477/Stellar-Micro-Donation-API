'use strict';

/**
 * pushHelper — builds Link headers and, when the connection supports it,
 * initiates HTTP/2 server push streams for related resources.
 *
 * Opt-out: set request header  X-No-Push: 1
 * Toggle:  env  ENABLE_SERVER_PUSH=true  (default off)
 */

const PUSH_ENABLED = process.env.ENABLE_SERVER_PUSH === 'true';

/**
 * Returns true when push/link logic should run for this request.
 * @param {import('express').Request} req
 */
function shouldPush(req) {
  return PUSH_ENABLED && req.headers['x-no-push'] !== '1';
}

/**
 * Appends a Link preload header for each related URL.
 * @param {import('express').Response} res
 * @param {string[]} urls
 */
function setLinkHeader(res, urls) {
  if (!urls.length) return;
  const value = urls.map(u => `<${u}>; rel=preload; as=fetch`).join(', ');
  res.setHeader('Link', value);
}

/**
 * Attempts HTTP/2 server push for each URL, forwarding the Authorization
 * header so pushed resources respect the same auth context.
 *
 * Falls back silently when the connection does not support push.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {string[]} urls
 */
function pushResources(req, res) {
  // res.push is only available on the http2 compatibility layer
  if (typeof res.push !== 'function') return;

  const urls = Array.from(arguments).slice(2).flat();
  const authHeader = req.headers['authorization'];

  for (const url of urls) {
    try {
      const pushHeaders = { ':path': url };
      if (authHeader) pushHeaders['authorization'] = authHeader;

      res.push(url, { request: pushHeaders }, (err, pushStream) => {
        if (err || !pushStream) return; // silently ignore
        pushStream.end();
      });
    } catch (_) {
      // push not supported — ignore
    }
  }
}

/**
 * Attach Link headers and initiate HTTP/2 push for donation-related resources.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {{ senderId?: number|string, receiverId?: number|string, id?: number|string }} donation
 */
function pushDonationRelated(req, res, donation) {
  if (!shouldPush(req) || !donation) return;

  const urls = [];
  if (donation.senderId)   urls.push(`/wallets/${donation.senderId}`);
  if (donation.receiverId) urls.push(`/wallets/${donation.receiverId}`);
  if (donation.id)         urls.push(`/transactions?donationId=${donation.id}`);

  if (!urls.length) return;

  setLinkHeader(res, urls);
  pushResources(req, res, urls);
}

module.exports = { shouldPush, setLinkHeader, pushResources, pushDonationRelated };
