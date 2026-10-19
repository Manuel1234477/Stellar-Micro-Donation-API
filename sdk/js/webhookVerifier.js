'use strict';

const crypto = require('crypto');

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FUTURE_MS = 30 * 1000;

function normalizeSignature(signature) {
  if (typeof signature !== 'string') return null;
  const value = signature.trim();
  return value.startsWith('sha256=') ? value.slice(7) : value;
}

function verifySignature(payload, signature, secret, timestamp = null, options = {}) {
  if (!(typeof payload === 'string' || Buffer.isBuffer(payload))) return false;
  if (typeof secret !== 'string' || !secret) return false;

  const receivedHex = normalizeSignature(signature);
  if (!receivedHex || !/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const signedPayload = timestamp ? `${timestamp}.${payload.toString()}` : payload;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest();
  const received = Buffer.from(receivedHex, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) return false;

  if (timestamp && options.checkTimestamp !== false) {
    const timestampMs = Date.parse(timestamp);
    const now = options.nowMs === undefined ? Date.now() : options.nowMs;
    const maxAgeMs = options.maxAgeMs === undefined ? DEFAULT_MAX_AGE_MS : options.maxAgeMs;
    const maxFutureMs = options.maxFutureMs === undefined ? DEFAULT_MAX_FUTURE_MS : options.maxFutureMs;
    if (!Number.isFinite(timestampMs) || now - timestampMs > maxAgeMs || timestampMs - now > maxFutureMs) return false;
  }

  return true;
}

module.exports = {
  verifySignature,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_FUTURE_MS,
};
