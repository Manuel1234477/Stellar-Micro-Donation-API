const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const donationEvents = require('../events/donationEvents');
const {
  TRANSACTION_STATES,
  normalizeState,
  assertValidState,
  assertValidTransition,
} = require('../utils/transactionStateMachine');

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
      id: transactionData.id || uuidv4(),
      amount: transactionData.amount,
      donor: transactionData.donor,
      recipient: transactionData.recipient,
      memo: transactionData.memo || '',
      memoType: transactionData.memoType || 'text',
      memoHash: transactionData.memoHash || null,
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

    if (this.eventEmitter) {
      const eventName = this.eventEmitter.constructor?.EVENTS?.CREATED || 'donation.created';
      if (typeof this.eventEmitter.emitLifecycleEvent === 'function') {
        this.eventEmitter.emitLifecycleEvent(eventName, newTransaction);
      } else if (typeof this.eventEmitter.emit === 'function') {
        this.eventEmitter.emit(eventName, newTransaction);
      }
    }

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

  /**
   * Get paginated transactions using cursor-based pagination with optional date filtering and sender/recipient filtering.
   *
   * When startDate or endDate are provided the results are filtered to only
   * include transactions whose timestamp falls within the specified range.
   * When senderPublicKey or recipientPublicKey are provided, results are filtered
   * to only include transactions matching those participants.
   * The date range and filters are encoded in the cursor so subsequent pages automatically
   * apply the same filter without the caller needing to repeat the parameters.
   *
   * Cursor format (no date filter):  "<epochMs>_<id>"
   * Cursor format (with date filter): base64(JSON { t, id, sd?, ed?, spk?, rpk? })
   *
   * @param {Object}  options
   * @param {number}  [options.limit=20]    - Items per page (max 100)
   * @param {string}  [options.cursor=null] - Opaque pagination cursor
   * @param {string}  [options.startDate]   - ISO 8601 start of date range (inclusive)
   * @param {string}  [options.endDate]     - ISO 8601 end of date range (inclusive)
   * @param {string}  [options.senderPublicKey]   - Filter by sender public key
   * @param {string}  [options.recipientPublicKey] - Filter by recipient public key
   * @returns {{ data: Array, nextCursor: string|null, hasMore: boolean }}
   */
  static getCursorPaginated({ limit = 20, cursor = null, startDate, endDate, senderPublicKey, recipientPublicKey } = {}) {
    const transactions = this.loadTransactions();

    // Decode cursor — may carry embedded date range and filters
    let cursorTime = null;
    let cursorId = null;
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    let effectiveSenderPublicKey = senderPublicKey;
    let effectiveRecipientPublicKey = recipientPublicKey;

    if (cursor) {
      // Try new base64-JSON format first (used when date filters are active)
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        if (decoded && typeof decoded.t === 'number') {
          cursorTime = decoded.t;
          cursorId = decoded.id;
          // Restore encoded date range so it applies on every page
          if (decoded.sd) effectiveStartDate = decoded.sd;
          if (decoded.ed) effectiveEndDate = decoded.ed;
          if (decoded.spk) effectiveSenderPublicKey = decoded.spk;
          if (decoded.rpk) effectiveRecipientPublicKey = decoded.rpk;
        }
      } catch {
        // Fall back to legacy "timestamp_id" format
        const parts = cursor.split('_');
        if (parts.length >= 2) {
          cursorTime = parseInt(parts[0]);
          cursorId = parts.slice(1).join('_');
        }
      }
    }

    // Exclude soft-deleted records
    let active = transactions.filter(t => !t.deleted_at);

    // Apply date range filter at the data level (equivalent to SQL WHERE timestamp BETWEEN)
    if (effectiveStartDate) {
      const start = new Date(effectiveStartDate).getTime();
      active = active.filter(t => new Date(t.timestamp).getTime() >= start);
    }
    if (effectiveEndDate) {
      const end = new Date(effectiveEndDate).getTime();
      active = active.filter(t => new Date(t.timestamp).getTime() <= end);
    }

    // Apply sender/recipient filters
    if (effectiveSenderPublicKey) {
      active = active.filter(t => t.donor === effectiveSenderPublicKey);
    }
    if (effectiveRecipientPublicKey) {
      active = active.filter(t => t.recipient === effectiveRecipientPublicKey);
    }

    // Sort by timestamp DESC, then by id DESC for consistent ordering
    const sorted = active.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;

    // If cursor provided, find the starting position within the (filtered) sorted list
    if (cursorTime !== null && cursorId !== null) {
      startIndex = sorted.findIndex(t => {
        const txTime = new Date(t.timestamp).getTime();
        return txTime < cursorTime || (txTime === cursorTime && t.id.localeCompare(cursorId) < 0);
      });

      // If cursor not found, return empty results
      if (startIndex === -1) {
        return { data: [], nextCursor: null, hasMore: false };
      }
    }

    // Get the page of results
    const pageLimit = Math.min(parseInt(limit), 100);
    const paginatedData = sorted.slice(startIndex, startIndex + pageLimit);

    // Check if there are more results
    const hasMore = startIndex + pageLimit < sorted.length;

    // Generate next cursor from the last item, embedding the date range and filters when present
    let nextCursor = null;
    if (hasMore && paginatedData.length > 0) {
      const lastItem = paginatedData[paginatedData.length - 1];
      const lastTimestamp = new Date(lastItem.timestamp).getTime();

      if (effectiveStartDate || effectiveEndDate || effectiveSenderPublicKey || effectiveRecipientPublicKey) {
        // Encode date range and filters into cursor so next page uses the same filter
        const cursorPayload = { t: lastTimestamp, id: lastItem.id };
        if (effectiveStartDate) cursorPayload.sd = effectiveStartDate;
        if (effectiveEndDate) cursorPayload.ed = effectiveEndDate;
        if (effectiveSenderPublicKey) cursorPayload.spk = effectiveSenderPublicKey;
        if (effectiveRecipientPublicKey) cursorPayload.rpk = effectiveRecipientPublicKey;
        nextCursor = Buffer.from(JSON.stringify(cursorPayload)).toString('base64');
      } else {
        nextCursor = `${lastTimestamp}_${lastItem.id}`;
      }
    }

    return { data: paginatedData, nextCursor, hasMore };
  }

  static getById(id) {
    const transactions = this.loadTransactions();
    const tx = transactions.find(t => t.id === id);
    // Return null for soft-deleted records (treat as not found)
    if (tx && tx.deleted_at) return null;
    return tx;
  }

  static getByDateRange(startDate, endDate) {
    const transactions = this.loadTransactions();
    return transactions.filter(t => {
      const txDate = new Date(t.timestamp);
      return txDate >= startDate && txDate <= endDate;
    });
  }

  static getAll({ includeDeleted = false } = {}) {
    const transactions = this.loadTransactions();
    if (includeDeleted) return transactions;
    return transactions.filter(t => !t.deleted_at);
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
    const updatedTransaction = transactions[index];

    if (this.eventEmitter) {
      const statusEventMap = {
        [TRANSACTION_STATES.SUBMITTED]: this.eventEmitter.constructor?.EVENTS?.SUBMITTED,
        [TRANSACTION_STATES.CONFIRMED]: this.eventEmitter.constructor?.EVENTS?.CONFIRMED,
        [TRANSACTION_STATES.FAILED]: this.eventEmitter.constructor?.EVENTS?.FAILED,
      };
      const eventName = statusEventMap[nextStatus];

      if (eventName) {
        if (typeof this.eventEmitter.emitLifecycleEvent === 'function') {
          this.eventEmitter.emitLifecycleEvent(eventName, updatedTransaction);
        } else if (typeof this.eventEmitter.emit === 'function') {
          this.eventEmitter.emit(eventName, updatedTransaction);
        }
      }
    }

    return updatedTransaction;
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
