const { EventEmitter } = require('events');

/**
 * DonationEvents - Event emitter for donation lifecycle events
 * Provides a centralized event system for donation state changes
 */
class DonationEvents extends EventEmitter {
  // Lifecycle event constants
  static EVENTS = {
    CREATED: 'donation.created',
    SUBMITTED: 'donation.submitted',
    CONFIRMED: 'donation.confirmed',
    FAILED: 'donation.failed'
  };

  constructor() {
    super();
    this.validEvents = Object.values(DonationEvents.EVENTS);
  }

  /**
   * Register a hook for a lifecycle event
   * @param {string} eventName - One of DonationEvents.EVENTS
   * @param {Function} handler - Callback function (payload) => void
   * @throws {Error} If eventName is not a valid lifecycle event
   */
  registerHook(eventName, handler) {
    if (!this.validEvents.includes(eventName)) {
      throw new Error(`Invalid event name: ${eventName}. Must be one of: ${this.validEvents.join(', ')}`);
    }

    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }

    this.on(eventName, handler);
  }

  /**
   * Emit a lifecycle event with payload
   * Handles errors from hooks gracefully to prevent blocking
   * @param {string} eventName - Event to emit
   * @param {Object} payload - Event data
   */
  emitLifecycleEvent(eventName, payload) {
    const listeners = this.listeners(eventName);

    listeners.forEach((listener, index) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Error in hook ${index + 1} for event ${eventName}:`, error.message);
        console.error('Hook error details:', error);
      }
    });
  }

  /**
   * Get all registered hooks for an event
   * @param {string} eventName - Event name
   * @returns {Function[]} Array of registered handlers
   */
  getHooks(eventName) {
    return this.listeners(eventName);
  }
}

// Export singleton instance
module.exports = new DonationEvents();
