/* eslint-disable local/no-bare-timers */
'use strict';

/**
 * Timer Registry — central tracking of all background setInterval / setTimeout handles.
 *
 * Goals:
 *  - Prevent leaked handles that keep the Node event loop alive after tests or shutdown.
 *  - Provide a single clearAll() call usable by the graceful-shutdown sequence.
 *  - Allow purely-background timers to be unref'd so they never by themselves block exit.
 *
 * Usage:
 *   const timerRegistry = require('./timerRegistry');
 *   const handle = timerRegistry.createInterval(fn, 5000, 'cache-sweeper');
 *   handle.unref();           // optional: won't keep process alive alone
 *   handle.clear();           // cancel this specific timer
 *   timerRegistry.clearAll(); // cancel every registered timer (called at shutdown)
 *
 * Guard: the ESLint rule local/no-bare-timers flags direct setInterval / setTimeout
 * calls in src/ so new timers must go through this registry.
 */

const log = require('./log');

class TimerRegistry {
  constructor() {
    this._timers = new Map();
    this._counter = 0;
  }

  /**
   * Register a repeating interval.
   * @param {Function} fn - Callback to invoke on each tick.
   * @param {number}   ms - Interval in milliseconds.
   * @param {string}  [label] - Human-readable label for diagnostics.
   * @returns {{ unref: Function, clear: Function }} Handle with unref and clear helpers.
   */
  createInterval(fn, ms, label = '') {
    const id = `interval_${++this._counter}${label ? '_' + label : ''}`;
    const handle = setInterval(fn, ms);
    this._timers.set(id, { type: 'interval', handle, label });

    return {
      unref: () => { if (handle.unref) handle.unref(); },
      clear: () => this._clear(id),
    };
  }

  /**
   * Register a one-shot timeout.
   * @param {Function} fn - Callback to invoke once.
   * @param {number}   ms - Delay in milliseconds.
   * @param {string}  [label] - Human-readable label for diagnostics.
   * @returns {{ unref: Function, clear: Function }} Handle with unref and clear helpers.
   */
  createTimeout(fn, ms, label = '') {
    const id = `timeout_${++this._counter}${label ? '_' + label : ''}`;
    const handle = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, ms);
    this._timers.set(id, { type: 'timeout', handle, label });

    return {
      unref: () => { if (handle.unref) handle.unref(); },
      clear: () => this._clear(id),
    };
  }

  /** @private */
  _clear(id) {
    const entry = this._timers.get(id);
    if (!entry) return;
    if (entry.type === 'interval') clearInterval(entry.handle);
    else clearTimeout(entry.handle);
    this._timers.delete(id);
  }

  /**
   * Cancel every registered timer.
   * Called once by the graceful-shutdown sequence before the DB pool closes.
   */
  clearAll() {
    let count = 0;
    for (const [id, entry] of this._timers) {
      if (entry.type === 'interval') clearInterval(entry.handle);
      else clearTimeout(entry.handle);
      this._timers.delete(id);
      count++;
    }
    if (count > 0) {
      log.info('TIMER_REGISTRY', `Cleared ${count} timer(s) at shutdown`);
    }
  }

  /** Number of currently registered timers (for diagnostics). */
  get size() {
    return this._timers.size;
  }
}

module.exports = new TimerRegistry();
module.exports.TimerRegistry = TimerRegistry;
