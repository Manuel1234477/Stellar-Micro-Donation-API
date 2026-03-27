'use strict';

const crypto = require('crypto');

/**
 * Verifies an X-Webhook-Signature header against a raw request payload.
 *
 * @param {string|Buffer} payload  - The raw request body (before JSON parsing).
 * @param {string}        signature - The hex-encoded HMAC-SHA256 signature from the header.
 * @param {string}        secret    - The shared secret used to sign the webhook.
 * @returns {boolean} `true` if the signature is valid, `false` otherwise.
 *
 * @example
 * const { verifySignature } = require('./webhookVerifier');
 * const isValid = verifySignature(req.rawBody, req.headers['x-webhook-signature'], process.env.WEBHOOK_SECRET);
 */
function verifySignature(payload, signature, secret) {
  if (typeof signature !== 'string' || typeof secret !== 'string') {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = { verifySignature };
