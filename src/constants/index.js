/**
 * Application Constants - Configuration Layer
 *
 * RESPONSIBILITY: Centralized constant definitions for application-wide use
 * OWNER: Platform Team
 * DEPENDENCIES: None (foundational module)
 *
 * Single source of truth for all shared constants including Stellar networks,
 * donation frequencies, transaction states, API key statuses, validation limits,
 * time-unit conversions, network-level invariants, and domain defaults.
 *
 * Hierarchy:
 *   - ./time      Pure time-unit conversions  (MS_PER_DAY, MS_PER_HOUR, ...)
 *   - ./network   Network/protocol invariants (STROOPS_PER_XLM, default ports, ...)
 *   - ./domain    Domain-level defaults      (retention windows, recipient priority, ...)
 *   This file    Domain enums & SDK-oriented values (statuses, frequencies, enum lists).
 *
 * For env-overridable tunables, see ../config/.
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
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  CUSTOM: 'custom',
});

/**
 * Valid frequencies array for validation (Issue #888, #1602)
 */
const VALID_FREQUENCIES = Object.freeze([
  DONATION_FREQUENCIES.DAILY,
  DONATION_FREQUENCIES.WEEKLY,
  DONATION_FREQUENCIES.BIWEEKLY,
  DONATION_FREQUENCIES.MONTHLY,
  DONATION_FREQUENCIES.QUARTERLY,
  DONATION_FREQUENCIES.CUSTOM,
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

/**
 * Stellar amount precision: 1 XLM = 10,000,000 stroops
 * Use this constant to convert between XLM (user-facing) and stroops (storage).
 * (Re-exported below from ./network for backwards compatibility — single source of truth.)
 */

// Re-exports from modular constant files. Keep `STROOPS_PER_XLM` accessible
// at the top-level index for backwards compatibility with existing imports.
const {
  STROOPS_PER_XLM,
  STELLAR_BASE_FEE_STROOPS,
  XLM_DECIMAL_PLACES,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
} = require('./network');

module.exports = {
  RESPONSE_STATUS,
  DONATION_FREQUENCIES,
  VALID_FREQUENCIES,
  SCHEDULE_STATUS,
  API_KEY_STATUS,
  STELLAR_NETWORKS,
  VALID_STELLAR_NETWORKS,
  HORIZON_URLS,
  STROOPS_PER_XLM,
  // New: network invariants
  STELLAR_BASE_FEE_STROOPS,
  XLM_DECIMAL_PLACES,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  ...require('./time'),
  ...require('./domain'),
};
