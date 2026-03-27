/**
 * Bulk Wallet Import Service
 *
 * RESPONSIBILITY: Orchestrate batch import of existing Stellar wallets
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, StellarService, stellar-sdk
 *
 * Validates each wallet independently, detects intra-batch and data-store
 * duplicates, queries Horizon concurrently, persists passing wallets, and
 * returns a per-wallet results array with a summary object.
 */

const StellarSdk = require('stellar-sdk');

class BulkWalletImportService {
  /**
   * Create a new BulkWalletImportService instance.
   * @param {import('./WalletService')} walletService - WalletService instance for data-store operations
   * @param {import('./StellarService')} stellarService - StellarService instance for Horizon queries
   */
  constructor(walletService, stellarService) {
    this.walletService = walletService;
    this.stellarService = stellarService;
  }

  /**
   * Validate a single wallet object from the import batch.
   *
   * Validation rules are checked in this order:
   * 1. Private key fields present (`secret_key` or `private_key`) → `private_key_not_accepted`
   * 2. Missing or non-string `public_key` → `missing_public_key`
   * 3. Invalid Stellar StrKey format → `invalid_address`
   *
   * @private
   * @param {Object} wallet - Wallet object from the request body
   * @param {number} index  - Zero-based position in the input array (reserved for future use)
   * @returns {{ valid: true } | { valid: false, reason: string }}
   */
  _validateWallet(wallet, index) { // eslint-disable-line no-unused-vars
    // Rule 1: reject private key fields
    if (wallet.secret_key !== undefined || wallet.private_key !== undefined) {
      return { valid: false, reason: 'private_key_not_accepted' };
    }

    // Rule 2: public_key must be present and a string
    if (wallet.public_key === undefined || wallet.public_key === null || typeof wallet.public_key !== 'string') {
      return { valid: false, reason: 'missing_public_key' };
    }

    // Rule 3: public_key must be a valid Stellar Ed25519 public key
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(wallet.public_key)) {
      return { valid: false, reason: 'invalid_address' };
    }

    return { valid: true };
  }

  /**
   * Import a batch of wallets.
   *
   * Processing steps:
   * 1. Validate each wallet with `_validateWallet`.
   * 2. Build an intra-batch seen-set; mark subsequent occurrences of the same
   *    `public_key` as `duplicate`.
   * 3. For all valid, non-intra-batch-duplicate keys, call
   *    `WalletService.getWalletByAddress` to detect data-store duplicates.
   * 4. For all remaining valid, non-duplicate keys, call
   *    `StellarService.getAccountInfo` concurrently via `Promise.allSettled`.
   * 5. Map Horizon outcomes: balance → success; notFound → unfunded_account;
   *    error → horizon_unavailable.
   * 6. For each wallet that passed all checks, call
   *    `WalletService.createWalletRecord(key, balance)`.
   * 7. Assemble the `results` array in original input order.
   * 8. Compute and return the `summary` object.
   *
   * @param {Array<Object>} wallets  - Array of wallet objects from the request body
   * @param {string}        clientId - Authenticated client identifier (for audit use by caller)
   * @returns {Promise<{ results: Array<ImportResult>, summary: Summary }>}
   *
   * @typedef {Object} ImportResult
   * @property {string}      public_key - The submitted public key (or empty string if missing)
   * @property {'success'|'duplicate'|'failed'} status
   * @property {string|null} reason     - Non-null when status is 'failed' or 'duplicate'
   * @property {string|null} id         - Wallet record id when status is 'success', else null
   *
   * @typedef {Object} Summary
   * @property {number} total
   * @property {number} succeeded
   * @property {number} duplicates
   * @property {number} failed
   */
  async importBatch(wallets, clientId) { // eslint-disable-line no-unused-vars
    const count = wallets.length;

    // Per-wallet state tracked by original index
    // Each slot: { publicKey, status, reason, id }
    const slots = new Array(count).fill(null).map(() => ({
      publicKey: null,
      status: null,
      reason: null,
      id: null,
    }));

    // ── Step 1: Validate each wallet ────────────────────────────────────────
    for (let i = 0; i < count; i++) {
      const wallet = wallets[i];
      const publicKey = typeof wallet.public_key === 'string' ? wallet.public_key : '';
      slots[i].publicKey = publicKey;

      const validation = this._validateWallet(wallet, i);
      if (!validation.valid) {
        slots[i].status = 'failed';
        slots[i].reason = validation.reason;
      }
    }

    // ── Step 2: Intra-batch duplicate detection ──────────────────────────────
    // Only consider wallets that passed validation so far
    const seenKeys = new Set();
    for (let i = 0; i < count; i++) {
      if (slots[i].status !== null) continue; // already failed

      const key = slots[i].publicKey;
      if (seenKeys.has(key)) {
        slots[i].status = 'duplicate';
        slots[i].reason = 'duplicate';
      } else {
        seenKeys.add(key);
      }
    }

    // ── Step 3: Data-store duplicate check ──────────────────────────────────
    // Collect indices of wallets still pending (passed validation, not intra-batch dup)
    const pendingIndices = [];
    for (let i = 0; i < count; i++) {
      if (slots[i].status === null) {
        pendingIndices.push(i);
      }
    }

    for (const i of pendingIndices) {
      const existing = this.walletService.getWalletByAddress(slots[i].publicKey);
      if (existing) {
        slots[i].status = 'duplicate';
        slots[i].reason = 'duplicate';
      }
    }

    // ── Step 4 & 5: Concurrent Horizon queries ───────────────────────────────
    // Re-collect indices still pending after data-store check
    const horizonIndices = pendingIndices.filter(i => slots[i].status === null);

    if (horizonIndices.length > 0) {
      const horizonPromises = horizonIndices.map(i =>
        this.stellarService.getAccountInfo(slots[i].publicKey)
      );

      const settled = await Promise.allSettled(horizonPromises);

      for (let j = 0; j < horizonIndices.length; j++) {
        const i = horizonIndices[j];
        const outcome = settled[j];

        if (outcome.status === 'rejected') {
          // Promise itself rejected (unexpected — getAccountInfo should not throw)
          slots[i].status = 'failed';
          slots[i].reason = 'horizon_unavailable';
          continue;
        }

        const result = outcome.value;

        if (result.error) {
          slots[i].status = 'failed';
          slots[i].reason = 'horizon_unavailable';
        } else if (result.notFound) {
          // Unfunded account — still a success, balance is null
          slots[i].status = 'success';
          slots[i].reason = 'unfunded_account';
          slots[i]._balance = null;
        } else {
          // Funded account
          slots[i].status = 'success';
          slots[i].reason = null;
          slots[i]._balance = result.balance;
        }
      }
    }

    // ── Step 6: Persist passing wallets ─────────────────────────────────────
    for (let i = 0; i < count; i++) {
      if (slots[i].status === 'success') {
        const record = this.walletService.createWalletRecord(
          slots[i].publicKey,
          slots[i]._balance ?? null
        );
        slots[i].id = record.id;
      }
    }

    // ── Step 7: Assemble results array ───────────────────────────────────────
    const results = slots.map(slot => ({
      public_key: slot.publicKey,
      status: slot.status,
      reason: slot.reason,
      id: slot.id,
    }));

    // ── Step 8: Compute summary ──────────────────────────────────────────────
    let succeeded = 0;
    let duplicates = 0;
    let failed = 0;

    for (const r of results) {
      if (r.status === 'success') succeeded++;
      else if (r.status === 'duplicate') duplicates++;
      else failed++;
    }

    const summary = {
      total: count,
      succeeded,
      duplicates,
      failed,
    };

    return { results, summary };
  }
}

module.exports = BulkWalletImportService;
