/**
 * Centralized Application Constants
 * Single source of truth for all shared constants across the application
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
 * Time Periods for Statistics
 */
const STATS_PERIODS = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
});

/**
 * Default Horizon URLs
 */
const HORIZON_URLS = Object.freeze({
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
  FUTURENET: 'https://horizon-futurenet.stellar.org',
});

/**
 * HTTP Status Codes (commonly used)
 */
const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

module.exports = {
  RESPONSE_STATUS,
  DONATION_FREQUENCIES,
  VALID_FREQUENCIES,
  SCHEDULE_STATUS,
  API_KEY_STATUS,
  STELLAR_NETWORKS,
  VALID_STELLAR_NETWORKS,
  STATS_PERIODS,
  HORIZON_URLS,
  HTTP_STATUS,
};
