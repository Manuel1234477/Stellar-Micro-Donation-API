/**
 * Transaction Sync Service - Blockchain Data Synchronization
 * 
 * RESPONSIBILITY: Synchronizes transactions from Stellar Horizon API to local database
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Horizon API, Transaction model
 * 
 * Fetches transaction history from Stellar network and creates local records for new
 * transactions, ensuring local database reflects blockchain state.
 */

const StellarSdk = require('stellar-sdk');

// Internal modules
const Transaction = require('../routes/models/transaction');
const Wallet = require('../routes/models/wallet');
const { HORIZON_URLS } = require('../constants');
const log = require('../utils/log');

class TransactionSyncService {
  /**
   * Create a new TransactionSyncService instance
   * @param {Object} stellarService - Stellar service instance
   * @param {string} [horizonUrl] - Horizon server URL (optional)
   */
  constructor(stellarService, horizonUrl = HORIZON_URLS.TESTNET) {
    if (typeof stellarService === 'string') {
      horizonUrl = stellarService;
      stellarService = null;
    }
    this.stellarService = stellarService || null;
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
  }

  /**
   * Sync wallet transactions from Stellar network to local database.
   * Fetches only transactions AFTER the wallet's last_cursor (incremental sync).
   * On success, updates wallet's last_cursor and last_synced_at.
   * @param {string} publicKey - Stellar public key to sync
   * @param {number} maxTransactions - Limit for unbounded fetching
   * @returns {Promise<{synced: number, transactions: Array}>} Sync results
   */
  async syncWalletTransactions(publicKey, maxTransactions = 500) {
    const startTime = Date.now();
    const wallet = Wallet.getByAddress(publicKey);
    const lastCursor = wallet ? (wallet.last_cursor || wallet.last_synced_cursor) : undefined;

    const horizonTxs = await this._fetchHorizonTransactions(publicKey, maxTransactions, lastCursor);
    const syncedTxs = [];

    // Horizon returns asc when fetching forward from cursor
    for (const tx of horizonTxs) {
      const existing = Transaction.getByStellarTxId(tx.id);
      if (!existing) {
        const newTx = Transaction.create({
          stellarTxId: tx.id,
          status: 'confirmed',
          amount: this._extractAmount(tx),
          memo: tx.memo,
          timestamp: tx.created_at,
        });
        syncedTxs.push(newTx);
      }
    }

    if (wallet && horizonTxs.length > 0) {
      // Update the cursor using the latest transaction fetched
      // Txs are in asc order, so the last one is the newest
      const latestTx = horizonTxs[horizonTxs.length - 1];
      Wallet.update(wallet.id, {
        last_cursor: latestTx.paging_token,
        last_synced_at: new Date().toISOString(),
      });
    } else if (wallet) {
      // Even if no new txs, update last_synced_at to record the sync attempt
      Wallet.update(wallet.id, { last_synced_at: new Date().toISOString() });
    }

    const duration = Date.now() - startTime;
    log.info('TX_SYNC', `Synced transactions for wallet`, {
      walletAddress: publicKey,
      syncedCount: syncedTxs.length,
      fetchedCount: horizonTxs.length,
      durationMs: duration
    });

    return { synced: syncedTxs.length, transactions: syncedTxs };
  }

  /**
   * Fetch paginated transactions from Horizon
   */
  async _fetchHorizonTransactions(publicKey, maxTransactions = 500, cursor = undefined) {
    try {
      let transactions = [];
      let limit = Math.min(200, maxTransactions); // Max limit allowed by Horizon is 200

      let callBuilder = this.server.transactions()
        .forAccount(publicKey)
        .limit(limit);

      if (cursor) {
        // Incremental sync logic fetching NEWER transactions since last cursor
        callBuilder = callBuilder.cursor(cursor).order('asc');
      } else {
        // In full sync, we probably want desc, but we fetch up to maxTransactions.
        callBuilder = callBuilder.order('desc');
      }

      let response = await callBuilder.call();

      while (response.records && response.records.length > 0 && transactions.length < maxTransactions) {
        for (const record of response.records) {
          if (transactions.length < maxTransactions) {
            transactions.push(record);
          } else {
            break;
          }
        }

        if (transactions.length >= maxTransactions) {
          break;
        }

        // Standard way to fetch next page with stellar-sdk
        response = await response.next();
      }

      // If we fetched descending initially, we might want to reverse to get ascending order for processing?
      // Not strictly necessary since we're just syncing and grabbing the maximum cursor if we flip the logic.
      // But if we fetched 'desc', the first element is the newest!
      if (!cursor) {
        transactions.reverse(); // Ensure processing runs from oldest to newest to preserve cursor logic easily
      }

      return transactions;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return [];
      }
      throw error;
    }
  }

  _extractAmount(tx) {
    return (tx.operations && tx.operations[0] && tx.operations[0].amount) || '0';
  }

  _extractSource(tx) {
    return tx.source_account || null;
  }

  _extractDestination(tx) {
    return (tx.operations && tx.operations[0] && tx.operations[0].destination) || tx.source_account || null;
  }
}

module.exports = TransactionSyncService;
