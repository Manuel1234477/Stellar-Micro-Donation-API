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
const { HORIZON_URLS } = require('../constants');

class TransactionSyncService {
  /**
   * Create a new TransactionSyncService instance
   * @param {Object} stellarService - Stellar service instance
   * @param {string} [horizonUrl] - Horizon server URL (optional)
   */
  constructor(stellarService, horizonUrl = HORIZON_URLS.TESTNET) {
    if (!stellarService) throw new Error('stellarService is required');
    this.stellarService = stellarService;
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
  }

  /**
   * Sync wallet transactions from Stellar network to local database
   * Fetches transactions from Horizon and creates local records for new ones
   * @param {string} publicKey - Stellar public key to sync
   * @returns {Promise<{synced: number, transactions: Array}>} Sync results
   */
  async syncWalletTransactions(publicKey) {
    const horizonTxs = await this._fetchHorizonTransactions(publicKey);
    const syncedTxs = [];
