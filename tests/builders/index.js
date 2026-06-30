/**
 * Test Data Builders - Central Export
 * 
 * RESPONSIBILITY: Provides convenient access to all test data builders
 * OWNER: QA/Testing Team
 * 
 * Import all builders from a single location for cleaner test files.
 * 
 * @example
 * const { WalletBuilder, DonationRequestBuilder, ApiRequestBuilder } = require('./builders');
 * const { uniqueId, uniquePublicKey } = require('./builders');
 */

const WalletBuilder = require('./WalletBuilder');
const DonationRequestBuilder = require('./DonationRequestBuilder');
const ApiRequestBuilder = require('./ApiRequestBuilder');
const TransactionBuilder = require('./TransactionBuilder');
const ApiKeyBuilder = require('./ApiKeyBuilder');
const TestAppBuilder = require('./TestAppBuilder');
const RecipientBuilder = require('./RecipientBuilder');
const { uniqueId, uniquePublicKey, uniqueKeyName } = require('./uniqueId');

module.exports = {
  WalletBuilder,
  DonationRequestBuilder,
  ApiRequestBuilder,
  TransactionBuilder,
  ApiKeyBuilder,
  TestAppBuilder,
  RecipientBuilder,
  // Unique ID helpers — use these instead of hard-coded strings to prevent
  // cross-test collisions when multiple suites run in the same worker.
  uniqueId,
  uniquePublicKey,
  uniqueKeyName,
};
