/**
 * Application Constants - Configuration Layer
 * 
 * RESPONSIBILITY: Centralized constant definitions for application-wide use
 * OWNER: Platform Team
 * DEPENDENCIES: None (foundational module)
 * 
 * Single source of truth for all shared constants including Stellar networks,
 * donation frequencies, transaction states, API key statuses, and validation limits.
 */

/**
 * API Response Status
 */
const RESPONSE_STATUS = Object.freeze({
  SUCCESS: true,
  FAILURE: false,
});

/**
 * Recurring Donation Frequencies
 */
const DONATION_FREQUENCIES = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
});

/**
 * Valid frequencies array for validation
 */
const VALID_FREQUENCIES = Object.freeze([
  DONATION_FREQUENCIES.DAILY,
  DONATION_FREQUENCIES.WEEKLY,
  DONATION_FREQUENCIES.MONTHLY,
]);

/**
 * Schedule/Subscription Status
 */
const SCHEDULE_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
});

/**
 * API Key Status
 */
const API_KEY_STATUS = Object.freeze({
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  REVOKED: 'revoked',
});

/**
 * Stellar Network Types
 */
const STELLAR_NETWORKS = Object.freeze({
  TESTNET: 'testnet',
  MAINNET: 'mainnet',
  FUTURENET: 'futurenet',
});

/**
 * Valid Stellar networks array for validation
 */
const VALID_STELLAR_NETWORKS = Object.freeze([
  STELLAR_NETWORKS.TESTNET,
  STELLAR_NETWORKS.MAINNET,
  STELLAR_NETWORKS.FUTURENET,
]);

/**
 * Default Horizon URLs
 */
const HORIZON_URLS = Object.freeze({
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
  FUTURENET: 'https://horizon-futurenet.stellar.org',
});

module.exports = {
  RESPONSE_STATUS,
  DONATION_FREQUENCIES,
  VALID_FREQUENCIES,
  SCHEDULE_STATUS,
  API_KEY_STATUS,
  STELLAR_NETWORKS,
  VALID_STELLAR_NETWORKS,
  HORIZON_URLS,
};
