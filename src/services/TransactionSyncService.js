const StellarSdk = require('stellar-sdk');
const Transaction = require('../routes/models/transaction');
const { HORIZON_URLS } = require('../constants');

class TransactionSyncService {
  constructor(horizonUrl = HORIZON_URLS.TESTNET) {
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
  }

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

  async _fetchHorizonTransactions(publicKey, limit = 200) {
    const txs = await this.server.transactions()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .call();
    
    return txs.records;
  }

  _extractAmount(tx) {
    return tx.operations?.[0]?.amount || '0';
  }

  _extractSource(tx) {
    return tx.source_account;
  }

  _extractDestination(tx) {
    return tx.operations?.[0]?.destination || tx.source_account;
  }
}

module.exports = TransactionSyncService;
