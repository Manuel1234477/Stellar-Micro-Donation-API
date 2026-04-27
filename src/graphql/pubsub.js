/**
 * GraphQL PubSub — Simple in-process event bus for subscriptions.
 *
 * RESPONSIBILITY: Decouple event producers (service layer) from GraphQL subscription resolvers.
 * OWNER: Backend Team
 *
 * Implements the minimal interface required by graphql-ws:
 *   pubsub.asyncIterator(topic) → AsyncIterator
 *   pubsub.publish(topic, payload) → void
 *
 * This is intentionally kept simple (in-process only). For multi-instance deployments,
 * replace with a Redis-backed pubsub without changing the interface.
 */

class PubSub {
  constructor() {
    /** @type {Map<string, Set<Function>>} topic → set of listener callbacks */
    this._listeners = new Map();
  }

  /**
   * Publish a payload to all subscribers of a topic.
   * @param {string} topic
   * @param {*} payload
   */
  publish(topic, payload) {
    const listeners = this._listeners.get(topic);
    if (!listeners) return;
    for (const fn of listeners) {
      fn(payload);
    }
  }

  /**
   * Return an AsyncIterator that yields payloads published to the given topic.
   * The iterator is automatically cleaned up when the client disconnects.
   * @param {string} topic
   * @returns {AsyncIterator}
   */
  asyncIterator(topic) {
    /** @type {Function[]} resolve queue for pending next() calls */
    const pullQueue = [];
    /** @type {*[]} buffer of payloads not yet consumed */
    const pushQueue = [];
    let done = false;
    const listeners = this._listeners;

    const listener = (payload) => {
      if (pullQueue.length > 0) {
        pullQueue.shift()({ value: payload, done: false });
      } else {
        pushQueue.push(payload);
      }
    };

    if (!listeners.has(topic)) {
      listeners.set(topic, new Set());
    }
    listeners.get(topic).add(listener);

    return {
      next() {
        if (pushQueue.length > 0) {
          return Promise.resolve({ value: pushQueue.shift(), done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => pullQueue.push(resolve));
      },
      return() {
        done = true;
        const set = listeners.get(topic);
        if (set) set.delete(listener);
        for (const resolve of pullQueue) {
          resolve({ value: undefined, done: true });
        }
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

/** Singleton instance shared across the application */
const pubsub = new PubSub();

/** Subscription topic constants */
pubsub.TOPICS = {
  DONATION_CREATED: 'DONATION_CREATED',
  DONATION_COMPLETED: 'DONATION_COMPLETED',
  RECURRING_DONATION_EXECUTED: 'RECURRING_DONATION_EXECUTED',
  // Legacy
  TRANSACTION_CREATED: 'TRANSACTION_CREATED',
};

/**
 * Return an AsyncIterator that only yields payloads matching the given filter.
 * @param {string} topic
 * @param {object} [filter] - { walletAddress, campaignId, minAmount }
 * @returns {AsyncIterator}
 */
pubsub.filteredIterator = function (topic, filter = {}) {
  const { walletAddress, campaignId, minAmount } = filter;
  const base = this.asyncIterator(topic);

  return {
    async next() {
      while (true) {
        const result = await base.next();
        if (result.done) return result;
        const p = result.value;
        if (walletAddress && p.donor !== walletAddress && p.recipient !== walletAddress) continue;
        if (campaignId != null && p.campaign_id !== campaignId) continue;
        if (minAmount != null && p.amount < minAmount) continue;
        return result;
      }
    },
    return() { return base.return(); },
    [Symbol.asyncIterator]() { return this; },
  };
};

module.exports = pubsub;
