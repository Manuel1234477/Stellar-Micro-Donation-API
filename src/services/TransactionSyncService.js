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
   * @param {Object|number} [options] - Options object or legacy maxTransactions number
   * @param {number} [options.maxTransactions=500] - Max total transactions to fetch
   * @param {number} [options.maxPages=50] - Max Horizon pages to follow
   * @param {string} [options.cursor] - Override cursor (resume from specific point)
   * @returns {Promise<{synced: number, transactions: Array, lastCursor: string|null}>}
   */
  async syncWalletTransactions(publicKey, options = {}) {
    // Support legacy numeric argument
    if (typeof options === 'number') options = { maxTransactions: options };
    const { maxTransactions = 500, maxPages = 50, cursor: cursorOverride } = options;

    const startTime = Date.now();
    const wallet = Wallet.getByAddress(publicKey);
    const lastCursor = cursorOverride !== undefined
      ? cursorOverride
      : (wallet ? (wallet.last_cursor || wallet.last_synced_cursor) : undefined);

    const horizonTxs = await this._fetchHorizonTransactions(publicKey, maxTransactions, lastCursor, maxPages);
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

    const newLastCursor = horizonTxs.length > 0
      ? horizonTxs[horizonTxs.length - 1].paging_token
      : null;

    if (wallet && horizonTxs.length > 0) {
      Wallet.update(wallet.id, {
        last_cursor: newLastCursor,
        last_synced_at: new Date().toISOString(),
      });
    } else if (wallet) {
      Wallet.update(wallet.id, { last_synced_at: new Date().toISOString() });
    }

    const duration = Date.now() - startTime;
    log.info('TX_SYNC', `Synced transactions for wallet`, {
      walletAddress: publicKey,
      syncedCount: syncedTxs.length,
      fetchedCount: horizonTxs.length,
      durationMs: duration,
      lastCursor: newLastCursor,
    });

    return { synced: syncedTxs.length, transactions: syncedTxs, lastCursor: newLastCursor };
  }

  /**
   * Fetch paginated transactions from Horizon, following next-page cursors.
   * @param {string} publicKey
   * @param {number} maxTransactions
   * @param {string|undefined} cursor - Starting cursor for incremental sync
   * @param {number} maxPages - Maximum number of pages to fetch
   */
  async _fetchHorizonTransactions(publicKey, maxTransactions = 500, cursor = undefined, maxPages = 50) {
    try {
      let transactions = [];
      const pageSize = Math.min(200, maxTransactions);
      let pagesFetched = 0;

      let callBuilder = this.server.transactions()
        .forAccount(publicKey)
        .limit(pageSize);

      if (cursor) {
        callBuilder = callBuilder.cursor(cursor).order('asc');
      } else {
        callBuilder = callBuilder.order('desc');
      }

      let response = await callBuilder.call();

      while (response.records && response.records.length > 0 && transactions.length < maxTransactions && pagesFetched < maxPages) {
        for (const record of response.records) {
          if (transactions.length < maxTransactions) {
            transactions.push(record);
          } else {
            break;
          }
        }

        pagesFetched++;
        log.info('TX_SYNC', `Fetched page ${pagesFetched}`, {
          publicKey,
          pageRecords: response.records.length,
          totalFetched: transactions.length,
        });

        if (transactions.length >= maxTransactions || pagesFetched >= maxPages) {
          break;
        }

        response = await response.next();
      }

      if (!cursor) {
        transactions.reverse();
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
