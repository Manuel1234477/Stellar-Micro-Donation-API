const fs = require('fs');
const path = require('path');
const donationEvents = require('../../events/donationEvents');
const {
  TRANSACTION_STATES,
  normalizeState,
  assertValidState,
  assertValidTransition,
} = require('../../utils/transactionStateMachine');

class Transaction {
  static getDbPath() {
    return process.env.DB_JSON_PATH || path.join(__dirname, '../../../data/donations.json');
  }

  static ensureDbDir() {
    const dir = path.dirname(this.getDbPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static loadTransactions() {
    this.ensureDbDir();
    const dbPath = this.getDbPath();
    if (!fs.existsSync(dbPath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  static saveTransactions(transactions) {
    this.ensureDbDir();
    fs.writeFileSync(this.getDbPath(), JSON.stringify(transactions, null, 2));
  }

  /**
   * Set the event emitter instance (for testing)
   * @param {Object} emitter - Event emitter to use
   */
  static setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  static create(transactionData) {
    const transactions = this.loadTransactions();

    if (transactionData.idempotencyKey) {
      const existingTransaction = transactions.find(
        t => t.idempotencyKey === transactionData.idempotencyKey
      );

      if (existingTransaction) {
        return existingTransaction;
      }
    }

    const normalizedStatus = normalizeState(transactionData.status || TRANSACTION_STATES.PENDING);
    assertValidState(normalizedStatus, 'status');

    const nowIso = new Date().toISOString();
    const newTransaction = {
      ...transactionData,
      id: transactionData.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      amount: transactionData.amount,
      donor: transactionData.donor,
      recipient: transactionData.recipient,
      memo: transactionData.memo || '',
      memoType: transactionData.memoType || 'text',
      encryptionMetadata: transactionData.encryptionMetadata || null,
      memoEnvelope: transactionData.memoEnvelope || null,
      notes: transactionData.notes || null,
      tags: transactionData.tags || [],
      apiKeyId: transactionData.apiKeyId || null,
      timestamp: transactionData.timestamp || nowIso,
      status: normalizedStatus,
      stellarTxId: transactionData.stellarTxId || null,
      stellarLedger: transactionData.stellarLedger || null,
      statusUpdatedAt: transactionData.statusUpdatedAt || nowIso,
      envelopeXdr: transactionData.envelopeXdr || null,
      feeBumpCount: transactionData.feeBumpCount || 0,
      originalFee: transactionData.originalFee || null,
      currentFee: transactionData.currentFee || null,
      lastFeeBumpAt: transactionData.lastFeeBumpAt || null,
    };
    transactions.push(newTransaction);
    this.saveTransactions(transactions);
    return newTransaction;
  }

  static getPaginated({ limit = 10, offset = 0 } = {}) {
    const transactions = this.loadTransactions();

    const total = transactions.length;


    limit = parseInt(limit);
    offset = parseInt(offset);


    const paginatedData = transactions.slice(offset, offset + limit);

    return {
      data: paginatedData,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  }

  static getById(id) {
    const transactions = this.loadTransactions();
    return transactions.find(t => t.id === id);
  }

  static getByDateRange(startDate, endDate) {
    const transactions = this.loadTransactions();
    return transactions.filter(t => {
      const txDate = new Date(t.timestamp);
      return txDate >= startDate && txDate <= endDate;
    });
  }

  static getAll() {
    return this.loadTransactions();
  }

  static updateStatus(id, status, stellarData = {}) {
    const transactions = this.loadTransactions();
    const index = transactions.findIndex(t => t.id === id);

    if (index === -1) {
      throw new Error(`Transaction not found: ${id}`);
    }

    const currentStatus = normalizeState(transactions[index].status);
    const nextStatus = normalizeState(status);

    assertValidState(currentStatus, 'current status');
    assertValidState(nextStatus, 'target status');
    assertValidTransition(currentStatus, nextStatus);

    const previousStatusTimestamp = new Date(transactions[index].statusUpdatedAt || transactions[index].timestamp || 0).getTime();
    const nextStatusTimestamp = new Date(Math.max(Date.now(), previousStatusTimestamp + 1)).toISOString();

    transactions[index].status = nextStatus;
    transactions[index].statusUpdatedAt = nextStatusTimestamp;

    if (stellarData.transactionId) {
      transactions[index].stellarTxId = stellarData.transactionId;
    }
    if (stellarData.ledger) {
      transactions[index].stellarLedger = stellarData.ledger;
    }
    if (stellarData.confirmedAt) {
      transactions[index].confirmedAt = stellarData.confirmedAt;
    }
    if (Object.prototype.hasOwnProperty.call(stellarData, 'notes')) {
      transactions[index].notes = stellarData.notes;
    }
    if (Object.prototype.hasOwnProperty.call(stellarData, 'tags')) {
      transactions[index].tags = Array.isArray(stellarData.tags) ? stellarData.tags : [];
    }

    this.saveTransactions(transactions);
    return transactions[index];
  }

  /**
   * Update fee bump metadata for a transaction.
   * @param {string} id - Transaction ID
   * @param {Object} feeBumpData - Fee bump data to update
   * @param {number} [feeBumpData.feeBumpCount] - New fee bump count
   * @param {number} [feeBumpData.currentFee] - New current fee in stroops
   * @param {string} [feeBumpData.lastFeeBumpAt] - ISO timestamp of fee bump
   * @param {string} [feeBumpData.envelopeXdr] - Updated envelope XDR (fee bump envelope)
   * @param {string} [feeBumpData.stellarTxId] - New Stellar transaction hash
   * @returns {Object} Updated transaction
   */
  static updateFeeBumpData(id, feeBumpData) {
    const transactions = this.loadTransactions();
    const index = transactions.findIndex(t => t.id === id);

    if (index === -1) {
      throw new Error(`Transaction not found: ${id}`);
    }

    if (feeBumpData.feeBumpCount !== undefined) {
      transactions[index].feeBumpCount = feeBumpData.feeBumpCount;
    }
    if (feeBumpData.currentFee !== undefined) {
      transactions[index].currentFee = feeBumpData.currentFee;
    }
    if (feeBumpData.lastFeeBumpAt !== undefined) {
      transactions[index].lastFeeBumpAt = feeBumpData.lastFeeBumpAt;
    }
    if (feeBumpData.envelopeXdr !== undefined) {
      transactions[index].envelopeXdr = feeBumpData.envelopeXdr;
    }
    if (feeBumpData.stellarTxId !== undefined) {
      transactions[index].stellarTxId = feeBumpData.stellarTxId;
    }

    this.saveTransactions(transactions);
    return transactions[index];
  }

  static getByStatus(status) {
    const transactions = this.loadTransactions();
    return transactions.filter(t => t.status === status);
  }

  static getByStellarTxId(stellarTxId) {
    const transactions = this.loadTransactions();
    return transactions.find(t => t.stellarTxId === stellarTxId);
  }

  static getDailyTotalByDonor(donor, date = new Date()) {
    const transactions = this.loadTransactions();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return transactions
      .filter(t => {
        const txDate = new Date(t.timestamp);
        return t.donor === donor &&
          txDate >= startOfDay &&
          txDate <= endOfDay &&
          t.status !== 'failed' &&
          t.status !== 'cancelled';
      })
      .reduce((total, t) => total + t.amount, 0);
  }

  // Test helper for integration suites.
  static _clearAllData() {
    this.saveTransactions([]);
  }

  /**
   * Update NFT certificate fields on a transaction record.
   * @param {string} id - Transaction ID
   * @param {Object} nftData
   * @param {string} [nftData.nft_asset_code]
   * @param {string} [nftData.nft_issuer]
   * @param {string} [nftData.nft_tx_hash]
   * @param {string} [nftData.nft_minted_at]
   * @param {string} [nftData.nft_mint_error]
   * @returns {Object} Updated transaction
   */
  static updateNftData(id, nftData) {
    const transactions = this.loadTransactions();
    const index = transactions.findIndex(t => t.id === id);
    if (index === -1) throw new Error(`Transaction not found: ${id}`);

    const fields = ['nft_asset_code', 'nft_issuer', 'nft_tx_hash', 'nft_minted_at', 'nft_mint_error'];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(nftData, field)) {
        transactions[index][field] = nftData[field];
      }
    }

    this.saveTransactions(transactions);
    return transactions[index];
  }
}

Transaction.eventEmitter = donationEvents;

module.exports = Transaction;
