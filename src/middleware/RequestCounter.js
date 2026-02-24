/**
 * RequestCounter - Tracks request counts per API key with time window management
 * 
 * Maintains a sliding window counter for each API key, automatically resetting
 * counts when the time window expires.
 */
class RequestCounter {
  /**
   * Create a new RequestCounter
   * @param {number} windowMs - Time window duration in milliseconds
   * @param {number} cleanupIntervalMs - Interval for automatic cleanup (optional)
   */
  constructor(windowMs, cleanupIntervalMs = null) {
    this.windowMs = windowMs;
    this.counters = new Map();
    this.cleanupIntervalId = null;

    // Start automatic cleanup if interval provided
    if (cleanupIntervalMs && cleanupIntervalMs > 0) {
      this.cleanupIntervalId = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);
    }
  }

  /**
   * Increment the request count for an API key
   * @param {string} apiKey - The API key to increment
   * @returns {number} The new count for this API key
   */
  increment(apiKey) {
    const now = Date.now();
    const entry = this.counters.get(apiKey);

    if (!entry || this._isWindowExpired(entry.windowStart, now)) {
      // Start new window
      this.counters.set(apiKey, {
        count: 1,
        windowStart: now
      });
      return 1;
    }

    // Increment existing window
    entry.count++;
    return entry.count;
  }

  /**
   * Get the current request count for an API key
   * @param {string} apiKey - The API key to check
   * @returns {number} The current count (0 if window expired or key not found)
   */
  getCount(apiKey) {
    const now = Date.now();
    const entry = this.counters.get(apiKey);

    if (!entry) {
      return 0;
    }

    if (this._isWindowExpired(entry.windowStart, now)) {
      // Window expired, return 0 but don't delete yet (cleanup will handle it)
      return 0;
    }

    return entry.count;
  }

  /**
   * Get the time remaining until the rate limit window resets for an API key
   * @param {string} apiKey - The API key to check
   * @returns {number} Milliseconds until reset (0 if window expired or key not found)
   */
  getTimeUntilReset(apiKey) {
    const now = Date.now();
    const entry = this.counters.get(apiKey);

    if (!entry) {
      return 0;
    }

    const resetTime = entry.windowStart + this.windowMs;
    const timeRemaining = resetTime - now;

    return timeRemaining > 0 ? timeRemaining : 0;
  }

  /**
   * Remove expired entries from memory
   * Iterates through all counters and removes entries with expired windows
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [apiKey, entry] of this.counters.entries()) {
      if (this._isWindowExpired(entry.windowStart, now)) {
        keysToDelete.push(apiKey);
      }
    }

    for (const key of keysToDelete) {
      this.counters.delete(key);
    }

    return keysToDelete.length;
  }

  /**
   * Stop automatic cleanup (for testing and shutdown)
   */
  stopCleanup() {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Reset all counters (for testing)
   */
  reset() {
    this.counters.clear();
  }

  /**
   * Check if a time window has expired
   * @private
   * @param {number} windowStart - Window start timestamp
   * @param {number} now - Current timestamp
   * @returns {boolean} True if window has expired
   */
  _isWindowExpired(windowStart, now) {
    return (now - windowStart) >= this.windowMs;
  }
}

module.exports = RequestCounter;
