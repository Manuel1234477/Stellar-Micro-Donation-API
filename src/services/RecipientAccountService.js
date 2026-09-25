'use strict';

/**
 * RecipientAccountService
 *
 * Small cached service that answers whether a recipient Stellar account exists.
 * Positive results are cached with a long TTL (accounts rarely disappear),
 * negative results with a short TTL (an account may be created shortly after).
 *
 * This keeps custodial donations from performing an extra Horizon account
 * lookup on every request, reducing latency and Horizon rate-limit pressure.
 */

const DEFAULT_POSITIVE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_NEGATIVE_TTL_MS = 15 * 1000; // 15 seconds

class RecipientAccountService {
  /**
   * @param {object} [options]
   * @param {object} [options.server] Horizon server exposing `loadAccount(publicKey)`.
   * @param {number} [options.positiveTtlMs] TTL for existing accounts.
   * @param {number} [options.negativeTtlMs] TTL for missing accounts.
   * @param {number} [options.now] Injectable clock (ms) for tests.
   */
  constructor(options = {}) {
    this.server = options.server || null;
    this.positiveTtlMs =
      typeof options.positiveTtlMs === 'number'
        ? options.positiveTtlMs
        : DEFAULT_POSITIVE_TTL_MS;
    this.negativeTtlMs =
      typeof options.negativeTtlMs === 'number'
        ? options.negativeTtlMs
        : DEFAULT_NEGATIVE_TTL_MS;
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.cache = new Map();
  }

  /**
   * Returns true when the recipient account exists on the network.
   * Results are cached with separate positive/negative TTLs.
   *
   * @param {string} publicKey
   * @returns {Promise<boolean>}
   */
  async checkRecipientAccountExists(publicKey) {
    if (!publicKey) {
      return false;
    }

    const cached = this.cache.get(publicKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.exists;
    }

    let exists = false;
    try {
      if (this.server && typeof this.server.loadAccount === 'function') {
        await this.server.loadAccount(publicKey);
        exists = true;
      }
    } catch (error) {
      // A 404 means the account does not exist yet; anything else is treated
      // as a missing account so the caller can decide how to proceed.
      exists = false;
    }

    const ttl = exists ? this.positiveTtlMs : this.negativeTtlMs;
    this.cache.set(publicKey, { exists, expiresAt: this.now() + ttl });

    return exists;
  }

  /**
   * Clears a single cached entry (or the whole cache when no key is given).
   * @param {string} [publicKey]
   */
  clear(publicKey) {
    if (publicKey) {
      this.cache.delete(publicKey);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = RecipientAccountService;
module.exports.RecipientAccountService = RecipientAccountService;
module.exports.DEFAULT_POSITIVE_TTL_MS = DEFAULT_POSITIVE_TTL_MS;
module.exports.DEFAULT_NEGATIVE_TTL_MS = DEFAULT_NEGATIVE_TTL_MS;
