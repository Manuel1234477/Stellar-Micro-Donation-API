/**
 * Transaction Sync Service
 * Synchronizes transactions from Stellar Horizon API to local database
 * Fetches transaction history and creates local records for new transactions
 */

const StellarSdk = require('stellar-sdk');
const Transaction = require('../routes/models/transaction');

class TransactionSyncService {
  /**
   * Create a new TransactionSyncService instance
   * @param {string} [horizonUrl='https://horizon-testnet.stellar.org'] - Horizon server URL
   */
  constructor(horizonUrl = 'https://horizon-testnet.stellar.org') {
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

    for (const tx of horizonTxs) {
      const existing = Transaction.getByStellarTxId(tx.id);
      
      if (!existing) {
        const newTx = Transaction.create({
          stellarTxId: tx.id,
          stellarLedger: tx.ledger_attr,
          timestamp: tx.created_at,
          status: 'confirmed',
          confirmedAt: tx.created_at,
          amount: this._extractAmount(tx),
          donor: this._extractSource(tx),
          recipient: this._extractDestination(tx)
        });
        syncedTxs.push(newTx);
      }
    }

    return { synced: syncedTxs.length, transactions: syncedTxs };
  }

  /**
   * Fetch transactions from Horizon API
   * @private
   * @param {string} publicKey - Stellar public key
   * @param {number} [limit=200] - Maximum number of transactions to fetch
   * @returns {Promise<Array>} Array of transaction records
   */
  async _fetchHorizonTransactions(publicKey, limit = 200) {
    const txs = await this.server.transactions()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .call();
    
    return txs.records;
  }

  /**
   * Extract amount from transaction
   * @private
   * @param {Object} tx - Horizon transaction object
   * @returns {string} Transaction amount
   */
  _extractAmount(tx) {
    return tx.operations?.[0]?.amount || '0';
  }

  /**
   * Extract source account from transaction
   * @private
   * @param {Object} tx - Horizon transaction object
   * @returns {string} Source account public key
   */
  _extractSource(tx) {
    return tx.source_account;
  }

  /**
   * Extract destination account from transaction
   * @private
   * @param {Object} tx - Horizon transaction object
   * @returns {string} Destination account public key
   */
  _extractDestination(tx) {
    return tx.operations?.[0]?.destination || tx.source_account;
  }
}

module.exports = TransactionSyncService;
