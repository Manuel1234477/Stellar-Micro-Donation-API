/**
 * Logging Hook Example
 * 
 * This hook logs all donation lifecycle events to the console.
 * It demonstrates basic hook implementation and event handling.
 * 
 * Usage:
 *   const loggingHook = require('./hooks/examples/loggingHook');
 *   loggingHook.register();
 */

const donationEvents = require('../../events/donationEvents');

/**
 * Format and log donation event
 * @param {Object} payload - Event payload
 */
function logEvent(payload) {
  const timestamp = new Date(payload.timestamp).toLocaleString();
  const eventType = payload.eventType;
  
  console.log('\n=== Donation Event ===');
  console.log(`Time: ${timestamp}`);
  console.log(`Event: ${eventType}`);
  
  switch (eventType) {
    case 'donation.created':
      console.log(`Transaction ID: ${payload.transaction.id}`);
      console.log(`Amount: $${payload.transaction.amount}`);
      console.log(`Donor: ${payload.transaction.donor}`);
      console.log(`Recipient: ${payload.transaction.recipient}`);
      break;
    
    case 'donation.submitted':
      console.log(`Transaction Hash: ${payload.transactionHash}`);
      console.log(`Transaction ID: ${payload.transactionId}`);
      break;
    
    case 'donation.confirmed':
      console.log(`Transaction Hash: ${payload.transactionHash}`);
      console.log(`Verified: ${payload.verified}`);
      break;
    
    case 'donation.failed':
      console.log(`Error Code: ${payload.errorCode}`);
      console.log(`Error Message: ${payload.errorMessage}`);
      console.log(`Stage: ${payload.context.stage}`);
      break;
  }
  
  console.log('=====================\n');
}

/**
 * Register logging hook for all lifecycle events
 */
function register() {
  const events = donationEvents.constructor.EVENTS;
  
  // Register for all lifecycle events
  Object.values(events).forEach(eventName => {
    donationEvents.registerHook(eventName, (payload) => {
      try {
        logEvent(payload);
      } catch (error) {
        console.error('Logging hook error:', error.message);
      }
    });
  });
  
  console.log('Logging hook registered for all donation events');
}

module.exports = {
  register,
  logEvent
};
