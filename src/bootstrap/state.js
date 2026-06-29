/**
 * Shared mutable application state.
 * Using a single module ensures all bootstrap sub-modules see the same reference
 * rather than independent copies of primitive booleans / integers.
 */
module.exports = {
  isShuttingDown: false,
  inFlightRequests: 0,
  isInitialized: false,
  initializationError: null,
};
