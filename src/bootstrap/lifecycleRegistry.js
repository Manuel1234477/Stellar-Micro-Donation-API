/**
 * Lifecycle registry (#2073).
 *
 * Single source of truth for background services started by startServer().
 * Each service registers { name, start, stop }; gracefulShutdown() stops every
 * registered service in reverse start order, so the hand-maintained start/stop
 * lists can no longer drift apart.
 */

'use strict';

const log = require('../utils/log');

function createLifecycleRegistry() {
  /** @type {Array<{name: string, start: Function, stop: Function}>} */
  const entries = [];

  /**
   * Register a service. `start` is invoked immediately (awaited if async);
   * `stop` is invoked during shutdown in reverse registration order.
   *
   * @param {{name: string, start?: Function, stop?: Function}} service
   * @returns {Promise<void>}
   */
  async function register(service) {
    if (!service || typeof service.name !== 'string' || !service.name) {
      throw new TypeError('lifecycle service requires a non-empty name');
    }
    if (typeof service.stop !== 'function') {
      throw new TypeError(`lifecycle service "${service.name}" requires a stop() function`);
    }
    if (entries.some((entry) => entry.name === service.name)) {
      throw new Error(`lifecycle service "${service.name}" is already registered`);
    }

    if (typeof service.start === 'function') {
      await service.start();
    }
    entries.push({ name: service.name, start: service.start, stop: service.stop });
  }

  /**
   * Stop all registered services in reverse start order. Errors are logged and
   * do not prevent the remaining services from being stopped.
   *
   * @returns {Promise<{stopped: string[], failed: Array<{name: string, error: string}>}>}
   */
  async function stopAll() {
    const stopped = [];
    const failed = [];

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      try {
        await entry.stop();
        stopped.push(entry.name);
      } catch (err) {
        failed.push({ name: entry.name, error: err && err.message ? err.message : String(err) });
        log.error('SHUTDOWN', `Error stopping ${entry.name}`, { error: err && err.message });
      }
    }

    entries.length = 0;
    return { stopped, failed };
  }

  function names() {
    return entries.map((entry) => entry.name);
  }

  return { register, stopAll, names };
}

module.exports = { createLifecycleRegistry };
