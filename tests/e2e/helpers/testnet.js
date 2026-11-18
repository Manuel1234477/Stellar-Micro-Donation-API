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

const StellarSdk = require('@stellar/stellar-sdk');
const path = require('path');
const StellarService = require('../../../src/services/StellarService');
const Database = require('../../../src/utils/database');
const { encrypt } = require('../../../src/utils/encryption');
const { withRetry, waitUntil } = require('./retry');

const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const TESTNET_NETWORK = 'testnet';

/**
 * Error codes/messages that indicate an account no longer exists on testnet.
 * Horizon returns 404 (not_found) when an account is absent, which typically
 * means testnet was reset between runs.
 */
const ACCOUNT_NOT_FOUND_PATTERNS = [
  /not\s*found/i,
  /does\s*not\s*exist/i,
  /account\s*not\s*found/i,
  /404/,
];

/**
 * Determine whether an error indicates the account is missing from testnet
 * (e.g. after a testnet reset).
 *
 * @param {Error|{ response?: { status?: number }, message?: string }} err
 * @returns {boolean}
 */
function isAccountNotFoundError(err) {
  if (!err) return false;
  if (err.response && err.response.status === 404) return true;
  if (err.status === 404) return true;
  const message = String(err.message || err);
  return ACCOUNT_NOT_FOUND_PATTERNS.some((re) => re.test(message));
}

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
 * Ensure an account still exists on testnet, re-funding it if testnet was reset.
 *
 * Testnet is reset periodically, which wipes all accounts. This helper detects
 * the resulting "account not found" condition and re-funds the account via
 * Friendbot so the test can continue. If re-funding fails, the error is
 * re-thrown so the caller can skip the test.
 *
 * @param {StellarService} service   - Testnet StellarService instance
 * @param {string}         publicKey - Account to verify
 * @returns {Promise<{ reset: boolean, refunded: boolean }>}
 * @throws {Error} If the account is missing and cannot be re-funded
 */
async function ensureAccountExists(service, publicKey) {
  try {
    await service.getBalance(publicKey);
    return { reset: false, refunded: false };
  } catch (err) {
    if (!isAccountNotFoundError(err)) {
      throw err;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[e2e/testnet] Account ${publicKey.slice(0, 8)}… not found — ` +
      'assuming testnet reset, re-funding via Friendbot'
    );
    await fundAccount(publicKey, service);
    await waitForBalance(service, publicKey, '1');
    return { reset: true, refunded: true };
  }
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
 * Poll Horizon until a transaction is confirmed (or fails) with a bounded timeout.
 *
 * Used to verify the money path on-chain after submitting a donation or refund.
 * A transaction that Horizon reports as failed causes this helper to throw.
 *
 * @param {StellarService} service       - Testnet StellarService instance
 * @param {string}         transactionHash - Hash of the submitted transaction
 * @param {object}         [options]
 * @param {number}         [options.maxAttempts=15] - Poll attempts before timing out
 * @param {number}         [options.intervalMs=3000] - Delay between polls
 * @returns {Promise<object>} The confirmed transaction record from Horizon
 * @throws {Error} If the transaction is not confirmed within the timeout or fails
 */
async function waitForTransaction(service, transactionHash, options = {}) {
  const { maxAttempts = 15, intervalMs = 3000 } = options;
  let confirmed = null;

  await waitUntil(
    async () => {
      try {
        const tx = await service.getTransaction(transactionHash);
        if (tx && tx.successful === false) {
          throw new Error(
            `Transaction ${transactionHash.slice(0, 8)}… failed on-chain`
          );
        }
        if (tx && tx.successful === true) {
          confirmed = tx;
          return true;
        }
        return false;
      } catch (err) {
        // Re-throw on-chain failures; treat "not found yet" as pending.
        if (/failed on-chain/i.test(err.message)) {
          throw err;
        }
        return false;
      }
    },
    {
      maxAttempts,
      intervalMs,
      description: `confirmation of tx ${transactionHash.slice(0, 8)}…`,
    }
  );

  return confirmed;
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
  isAccountNotFoundError,
  createTestnetService,
  generateKeypair,
  fundAccount,
  createFundedAccount,
  ensureAccountExists,
  waitForBalance,
  waitForTransaction,
  seedUser,
  createFundedUser,
};
