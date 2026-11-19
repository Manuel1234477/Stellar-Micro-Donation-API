'use strict';

/**
 * Token bucket rate limiter (#1981).
 *
 * Holds up to `perSecond` tokens, refilled continuously at `perSecond` per
 * second. Each `take()` spends one token and returns false when the bucket is
 * empty. Used per WebSocket connection to bound inbound message rate.
 *
 * @param {number} perSecond - Sustained rate and burst capacity.
 * @param {() => number} [now=Date.now] - Clock, injectable for tests.
 * @returns {{ take: () => boolean }}
 */
function createTokenBucket(perSecond, now = () => Date.now()) {
  let tokens = perSecond;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(perSecond, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

module.exports = { createTokenBucket };
