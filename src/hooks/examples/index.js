/**
 * Example Hooks Initialization
 * 
 * This file demonstrates how to register multiple hooks during application startup.
 * Import and call registerExampleHooks() in your app.js to enable all example hooks.
 * 
 * Usage in app.js:
 *   const { registerExampleHooks } = require('./hooks/examples');
 *   registerExampleHooks();
 */

const loggingHook = require('./loggingHook');
const analyticsHook = require('./analyticsHook');
const notificationHook = require('./notificationHook');

/**
 * Register all example hooks
 * Call this function during application initialization
 */
function registerExampleHooks() {
  console.log('\n=== Registering Example Hooks ===');
  
  // Register logging hook
  loggingHook.register();
  
  // Register analytics hook
  analyticsHook.register();
  
  // Register notification hook
  notificationHook.register();
  
  console.log('=== All Example Hooks Registered ===\n');
}

/**
 * Register only specific hooks
 * @param {Object} options - Hook registration options
 * @param {boolean} options.logging - Register logging hook
 * @param {boolean} options.analytics - Register analytics hook
 * @param {boolean} options.notifications - Register notification hook
 */
function registerSelectiveHooks(options = {}) {
  console.log('\n=== Registering Selected Hooks ===');
  
  if (options.logging) {
    loggingHook.register();
  }
  
  if (options.analytics) {
    analyticsHook.register();
  }
  
  if (options.notifications) {
    notificationHook.register();
  }
  
  console.log('=== Selected Hooks Registered ===\n');
}

module.exports = {
  registerExampleHooks,
  registerSelectiveHooks,
  loggingHook,
  analyticsHook,
  notificationHook
};
