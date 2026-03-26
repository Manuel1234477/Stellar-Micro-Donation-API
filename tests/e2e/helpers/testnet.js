/**
 * Testnet Utilities - E2E Test Infrastructure for Stellar Testnet
 *
 * RESPONSIBILITY: Account lifecycle management for e2e tests against Stellar testnet
 * OWNER: QA/Testing Team
 *
 * Provides helpers for creating and funding test accounts via Friendbot, seeding
 * the local SQLite DB with custodial user records (encrypted secrets), and polling
 * Horizon for balance confirmation. All helpers use the retry module so individual
 * tests don't need to implement their own retry logic.
 *
 * Designed to be called from beforeAll/beforeEach hooks in e2e test suites.
 */

'use strict';

const StellarSdk = require('stellar-sdk');
const path = require('path');
const StellarService = require('../../../src/services/StellarService');
const Database = require('../../../src/utils/database');
const { encrypt } = require('../../../src/utils/encryption');
const { withRetry, waitUntil } = require('./retry');

const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const TESTNET_NETWORK = 'testnet';

/**
 * Create a StellarService instance configured for the Stellar testnet.
 *
 * @returns {StellarService}
 */
function createTestnetService() {
  return new StellarService({
    network: TESTNET_NETWORK,
    horizonUrl: TESTNET_HORIZON_URL,
  });
}

/**
 * Generate a fresh random Stellar keypair.
 *
 * @returns {{ publicKey: string, secretKey: string }}
 */
function generateKeypair() {
  const pair = StellarSdk.Keypair.random();
  return {
    publicKey: pair.publicKey(),
    secretKey: pair.secret(),
  };
}

/**
 * Fund an account on the Stellar testnet via Friendbot.
 *
 * Retries up to 5 times with exponential backoff to handle Friendbot rate limits
 * and transient network errors.
 *
 * @param {string}         publicKey - Stellar public key to fund
 * @param {StellarService} service   - Testnet StellarService instance
 * @returns {Promise<{ funded: boolean, balance: string }>}
 * @throws {Error} If all retry attempts fail
 */
async function fundAccount(publicKey, service) {
  return withRetry(
    () => service.fundWithFriendbot(publicKey),
    {
      maxAttempts: 5,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
      onRetry: (err, attempt, delayMs) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[e2e/testnet] Friendbot retry ${attempt} for ${publicKey.slice(0, 8)}… ` +
          `(${err.message}) — waiting ${delayMs}ms`
        );
      },
    }
  );
}

/**
 * Create a fresh keypair and immediately fund it via Friendbot.
 *
 * @param {StellarService} service - Testnet StellarService instance
 * @returns {Promise<{ publicKey: string, secretKey: string }>}
 */
async function createFundedAccount(service) {
  const keypair = generateKeypair();
  await fundAccount(keypair.publicKey, service);
  return keypair;
}

/**
 * Poll Horizon until the account's XLM balance is at least minBalance.
 *
 * Useful after Friendbot calls to ensure the account is fully on-chain before
 * a test submits a transaction from it.
 *
 * @param {StellarService} service    - Testnet StellarService instance
 * @param {string}         publicKey  - Account to check
 * @param {string}         [minBalance='1'] - Minimum XLM balance required
 * @returns {Promise<void>}
 * @throws {Error} If account does not reach minBalance within timeout
 */
async function waitForBalance(service, publicKey, minBalance = '1') {
  await waitUntil(
    async () => {
      try {
        const { balance } = await service.getBalance(publicKey);
        return parseFloat(balance) >= parseFloat(minBalance);
      } catch {
        return false;
      }
    },
    {
      maxAttempts: 12,
      intervalMs: 3000,
      description: `balance ≥ ${minBalance} XLM for ${publicKey.slice(0, 8)}…`,
    }
  );
}

/**
 * Insert a custodial user row into the e2e test SQLite database.
 *
 * The secret key is encrypted with the current ENCRYPTION_KEY so DonationService
 * can later decrypt it when processing POST /donations/send requests.
 *
 * @param {string} publicKey  - Stellar public key
 * @param {string} secretKey  - Stellar secret key (will be encrypted at rest)
 * @returns {Promise<{ id: number }>} The inserted user's DB row ID
 */
async function seedUser(publicKey, secretKey) {
  const encryptedSecret = encrypt(secretKey);
  const result = await Database.run(
    'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
    [publicKey, encryptedSecret]
  );
  return { id: result.lastID };
}

/**
 * Create a funded testnet account AND seed a corresponding user row in the DB.
 *
 * Returns everything needed to make custodial donation API calls.
 *
 * @param {StellarService} service - Testnet StellarService instance
 * @returns {Promise<{ publicKey: string, secretKey: string, userId: number }>}
 */
async function createFundedUser(service) {
  const keypair = await createFundedAccount(service);
  const { id } = await seedUser(keypair.publicKey, keypair.secretKey);
  return { ...keypair, userId: id };
}

module.exports = {
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK,
  createTestnetService,
  generateKeypair,
  fundAccount,
  createFundedAccount,
  waitForBalance,
  seedUser,
  createFundedUser,
};
