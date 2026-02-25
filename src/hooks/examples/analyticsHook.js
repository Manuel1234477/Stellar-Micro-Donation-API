/**
 * Analytics Hook Example
 * 
 * This hook tracks donation metrics and events for analytics purposes.
 * It demonstrates how to extract and process event data for analytics.
 * 
 * Usage:
 *   const analyticsHook = require('./hooks/examples/analyticsHook');
 *   analyticsHook.register();
 */

const donationEvents = require('../../events/donationEvents');

// In-memory analytics store (replace with actual analytics service)
const analytics = {
  events: [],
  metrics: {
    totalDonations: 0,
    totalAmount: 0,
    successfulVerifications: 0,
    failedVerifications: 0,
    creationErrors: 0
  }
};

/**
 * Track donation creation
 * @param {Object} payload - donation.created event payload
 */
function trackCreation(payload) {
  const { transaction } = payload;
  
  analytics.events.push({
    type: 'donation_created',
    timestamp: payload.timestamp,
    data: {
      transactionId: transaction.id,
      amount: transaction.amount,
      donor: transaction.donor,
      recipient: transaction.recipient
    }
  });
  
  analytics.metrics.totalDonations++;
  analytics.metrics.totalAmount += transaction.amount;
  
  console.log('[Analytics] Donation created:', {
    id: transaction.id,
    amount: transaction.amount,
    totalDonations: analytics.metrics.totalDonations,
    totalAmount: analytics.metrics.totalAmount
  });
}

/**
 * Track donation submission for verification
 * @param {Object} payload - donation.submitted event payload
 */
function trackSubmission(payload) {
  analytics.events.push({
    type: 'donation_submitted',
    timestamp: payload.timestamp,
    data: {
      transactionHash: payload.transactionHash,
      transactionId: payload.transactionId
    }
  });
  
  console.log('[Analytics] Donation submitted for verification:', {
    hash: payload.transactionHash
  });
}

/**
 * Track successful verification
 * @param {Object} payload - donation.confirmed event payload
 */
function trackConfirmation(payload) {
  analytics.events.push({
    type: 'donation_confirmed',
    timestamp: payload.timestamp,
    data: {
      transactionHash: payload.transactionHash,
      transactionId: payload.transactionId
    }
  });
  
  analytics.metrics.successfulVerifications++;
  
  console.log('[Analytics] Donation confirmed:', {
    hash: payload.transactionHash,
    totalConfirmed: analytics.metrics.successfulVerifications
  });
}

/**
 * Track donation failures
 * @param {Object} payload - donation.failed event payload
 */
function trackFailure(payload) {
  analytics.events.push({
    type: 'donation_failed',
    timestamp: payload.timestamp,
    data: {
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
      stage: payload.context.stage
    }
  });
  
  if (payload.context.stage === 'creation') {
    analytics.metrics.creationErrors++;
  } else if (payload.context.stage === 'verification') {
    analytics.metrics.failedVerifications++;
  }
  
  console.log('[Analytics] Donation failed:', {
    errorCode: payload.errorCode,
    stage: payload.context.stage,
    creationErrors: analytics.metrics.creationErrors,
    verificationErrors: analytics.metrics.failedVerifications
  });
}

/**
 * Get current analytics metrics
 * @returns {Object} Current metrics
 */
function getMetrics() {
  return {
    ...analytics.metrics,
    averageDonation: analytics.metrics.totalDonations > 0
      ? analytics.metrics.totalAmount / analytics.metrics.totalDonations
      : 0,
    verificationSuccessRate: (analytics.metrics.successfulVerifications + analytics.metrics.failedVerifications) > 0
      ? (analytics.metrics.successfulVerifications / (analytics.metrics.successfulVerifications + analytics.metrics.failedVerifications)) * 100
      : 0
  };
}

/**
 * Get recent events
 * @param {number} limit - Number of events to return
 * @returns {Array} Recent events
 */
function getRecentEvents(limit = 10) {
  return analytics.events.slice(-limit);
}

/**
 * Register analytics hook for all lifecycle events
 */
function register() {
  const events = donationEvents.constructor.EVENTS;
  
  donationEvents.registerHook(events.CREATED, (payload) => {
    try {
      trackCreation(payload);
    } catch (error) {
      console.error('Analytics hook error (creation):', error.message);
    }
  });
  
  donationEvents.registerHook(events.SUBMITTED, (payload) => {
    try {
      trackSubmission(payload);
    } catch (error) {
      console.error('Analytics hook error (submission):', error.message);
    }
  });
  
  donationEvents.registerHook(events.CONFIRMED, (payload) => {
    try {
      trackConfirmation(payload);
    } catch (error) {
      console.error('Analytics hook error (confirmation):', error.message);
    }
  });
  
  donationEvents.registerHook(events.FAILED, (payload) => {
    try {
      trackFailure(payload);
    } catch (error) {
      console.error('Analytics hook error (failure):', error.message);
    }
  });
  
  console.log('Analytics hook registered for all donation events');
}

module.exports = {
  register,
  getMetrics,
  getRecentEvents,
  // Export for testing
  _analytics: analytics
};
