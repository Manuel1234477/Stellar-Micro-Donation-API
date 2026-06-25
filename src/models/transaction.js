/**
 * Transaction Model - Data Access Layer (SQLite-backed)
 * No longer reads from or writes to data/donations.json.
 *
 * Uses an in-memory store initialised from SQLite on first access.
 * All mutations are persisted to SQLite (fire-and-forget with error logging).
 * The synchronous public API is preserved for backward compatibility.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const donationEvents = require('../events/donationEvents');
const {
  TRANSACTION_STATES,
  normalizeState,
  assertValidState,
  assertValidTransition,
} = require('../utils/transactionStateMachine');
const log = require('../utils/log');

// ── In-memory store ──────────────────────────────────────────────────────────

/** @type {Map<string, object>} id -> transaction object */
const _store = new Map();
let _loaded = false;
let _loading = null; // Promise<void> | null

/**
 * Persist a single record to SQLite (fire-and-forget).
 * Stroop amounts are stored as exact integers to avoid float coercion.
 */
function _persist(tx) {
  const Database = require('../utils/database');
  const amountStroops = Number.isInteger(tx.amount) ? tx.amount : null;
  const data = JSON.stringify(tx);

  Database.run(
    `INSERT INTO donations_store
       (id, donor, recipient, amount_stroops, amount_text, status,
        idempotency_key, stellar_tx_id, timestamp, status_updated_at, deleted_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       stellar_tx_id = excluded.stellar_tx_id,
       status_updated_at = excluded.status_updated_at,
       deleted_at = excluded.deleted_at,
       data = excluded.data`,
    [
      tx.id,
      tx.donor || null,
      tx.recipient || null,
      amountStroops,
      String(tx.amount ?? ''),
      tx.status || 'pending',
      tx.idempotencyKey || null,
      tx.stellarTxId || null,
      tx.timestamp || new Date().toISOString(),
      tx.statusUpdatedAt || null,
      tx.deleted_at || null,
      data,
    ]
  ).catch(err => log.error('TRANSACTION_MODEL', 'SQLite persist failed', { id: tx.id, error: err.message }));
}

/**
 * Load all records from SQLite into the in-memory store.
 * Called once lazily; subsequent calls are no-ops.
 */
async function _ensureLoaded() {
  if (_loaded) return;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const Database = require('../utils/database');
      const rows = await Database.all('SELECT data FROM donations_store');
      for (const row of rows) {
        try {
          const tx = JSON.parse(row.data);
          _store.set(tx.id, tx);
        } catch (_) { /* skip corrupt rows */ }
      }
      _loaded = true;
    } catch (err) {
      // If DB isn't ready yet (e.g. first startup before migrations), start empty
      log.warn('TRANSACTION_MODEL', 'Could not load from SQLite, starting empty', { error: err.message });
      _loaded = true;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

// Kick off the load immediately so most requests find the store ready
_ensureLoaded().catch(() => {});

// ── Model class ──────────────────────────────────────────────────────────────

class Transaction {
  /** @deprecated No longer used — retained for test compatibility only */
  static getDbPath() {
    return null;
  }

  /**
   * Synchronous helper — returns the in-memory array.
   * If the store hasn't been loaded from SQLite yet, returns what's already
   * in memory (empty on very first request before load completes).
   */
  static loadTransactions() {
    return Array.from(_store.values());
  }

  /** @deprecated No-op — writes go through _persist(). */
  static saveTransactions(_transactions) {
    // intentionally empty — no file I/O
  }

  static setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  static create(transactionData) {
    const normalizedStatus = normalizeState(transactionData.status || TRANSACTION_STATES.PENDING);
    assertValidState(normalizedStatus, 'status');

    // Idempotency check
    if (transactionData.idempotencyKey) {
      for (const tx of _store.values()) {
        if (tx.idempotencyKey === transactionData.idempotencyKey) {
          return tx;
        }
      }
    }

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

    _store.set(newTransaction.id, newTransaction);
    _persist(newTransaction);

    const emitter = this.eventEmitter;
    if (emitter) {
      const eventName = emitter.constructor?.EVENTS?.CREATED || 'donation.created';
      if (typeof emitter.emitLifecycleEvent === 'function') {
        emitter.emitLifecycleEvent(eventName, newTransaction);
      } else if (typeof emitter.emit === 'function') {
        emitter.emit(eventName, newTransaction);
      }
    }

    return newTransaction;
  }

  static getPaginated({ limit = 10, offset = 0 } = {}) {
    const transactions = this.loadTransactions();
    limit = parseInt(limit);
    offset = parseInt(offset);
    return {
      data: transactions.slice(offset, offset + limit),
      pagination: {
        total: transactions.length,
        limit,
        offset,
        hasMore: offset + limit < transactions.length,
      },
    };
  }

  static getCursorPaginated({ limit = 20, cursor = null, startDate, endDate, senderPublicKey, recipientPublicKey } = {}) {
    let cursorTime = null;
    let cursorId = null;
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    let effectiveSenderPublicKey = senderPublicKey;
    let effectiveRecipientPublicKey = recipientPublicKey;

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        if (decoded && typeof decoded.t === 'number') {
          cursorTime = decoded.t;
          cursorId = decoded.id;
          if (decoded.sd) effectiveStartDate = decoded.sd;
          if (decoded.ed) effectiveEndDate = decoded.ed;
          if (decoded.spk) effectiveSenderPublicKey = decoded.spk;
          if (decoded.rpk) effectiveRecipientPublicKey = decoded.rpk;
        }
      } catch {
        const parts = cursor.split('_');
        if (parts.length >= 2) {
          cursorTime = parseInt(parts[0]);
          cursorId = parts.slice(1).join('_');
        }
      }
    }

    let active = Array.from(_store.values()).filter(t => !t.deleted_at);

    if (effectiveStartDate) {
      const start = new Date(effectiveStartDate).getTime();
      active = active.filter(t => new Date(t.timestamp).getTime() >= start);
    }
    if (effectiveEndDate) {
      const end = new Date(effectiveEndDate).getTime();
      active = active.filter(t => new Date(t.timestamp).getTime() <= end);
    }
    if (effectiveSenderPublicKey) {
      active = active.filter(t => t.donor === effectiveSenderPublicKey);
    }
    if (effectiveRecipientPublicKey) {
      active = active.filter(t => t.recipient === effectiveRecipientPublicKey);
    }

    const sorted = active.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (cursorTime !== null && cursorId !== null) {
      startIndex = sorted.findIndex(t => {
        const txTime = new Date(t.timestamp).getTime();
        return txTime < cursorTime || (txTime === cursorTime && t.id.localeCompare(cursorId) < 0);
      });
      if (startIndex === -1) return { data: [], nextCursor: null, hasMore: false };
    }

    const pageLimit = Math.min(parseInt(limit), 100);
    const paginatedData = sorted.slice(startIndex, startIndex + pageLimit);
    const hasMore = startIndex + pageLimit < sorted.length;

    let nextCursor = null;
    if (hasMore && paginatedData.length > 0) {
      const lastItem = paginatedData[paginatedData.length - 1];
      const lastTimestamp = new Date(lastItem.timestamp).getTime();
      if (effectiveStartDate || effectiveEndDate || effectiveSenderPublicKey || effectiveRecipientPublicKey) {
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
    const tx = _store.get(id);
    if (tx && tx.deleted_at) return null;
    return tx || null;
  }

  static getByDateRange(startDate, endDate) {
    return Array.from(_store.values()).filter(t => {
      const txDate = new Date(t.timestamp);
      return txDate >= startDate && txDate <= endDate;
    });
  }

  static getAll({ includeDeleted = false } = {}) {
    const all = Array.from(_store.values());
    return includeDeleted ? all : all.filter(t => !t.deleted_at);
  }

  static updateStatus(id, status, stellarData = {}) {
    const tx = _store.get(id);
    if (!tx) throw new Error(`Transaction not found: ${id}`);

    const currentStatus = normalizeState(tx.status);
    const nextStatus = normalizeState(status);
    assertValidState(currentStatus, 'current status');
    assertValidState(nextStatus, 'target status');
    assertValidTransition(currentStatus, nextStatus);

    const previousStatusTimestamp = new Date(tx.statusUpdatedAt || tx.timestamp || 0).getTime();
    const nextStatusTimestamp = new Date(Math.max(Date.now(), previousStatusTimestamp + 1)).toISOString();

    const updated = { ...tx, status: nextStatus, statusUpdatedAt: nextStatusTimestamp };

    if (stellarData.transactionId) updated.stellarTxId = stellarData.transactionId;
    if (stellarData.ledger) updated.stellarLedger = stellarData.ledger;
    if (stellarData.confirmedAt) updated.confirmedAt = stellarData.confirmedAt;
    if (Object.prototype.hasOwnProperty.call(stellarData, 'notes')) updated.notes = stellarData.notes;
    if (Object.prototype.hasOwnProperty.call(stellarData, 'tags')) {
      updated.tags = Array.isArray(stellarData.tags) ? stellarData.tags : [];
    }

    _store.set(id, updated);
    _persist(updated);

    const emitter = this.eventEmitter;
    if (emitter) {
      const statusEventMap = {
        [TRANSACTION_STATES.SUBMITTED]: emitter.constructor?.EVENTS?.SUBMITTED,
        [TRANSACTION_STATES.CONFIRMED]: emitter.constructor?.EVENTS?.CONFIRMED,
        [TRANSACTION_STATES.FAILED]: emitter.constructor?.EVENTS?.FAILED,
      };
      const eventName = statusEventMap[nextStatus];
      if (eventName) {
        if (typeof emitter.emitLifecycleEvent === 'function') {
          emitter.emitLifecycleEvent(eventName, updated);
        } else if (typeof emitter.emit === 'function') {
          emitter.emit(eventName, updated);
        }
      }
    }

    return updated;
  }

  static updateFeeBumpData(id, feeBumpData) {
    const tx = _store.get(id);
    if (!tx) throw new Error(`Transaction not found: ${id}`);

    const updated = { ...tx };
    if (feeBumpData.feeBumpCount !== undefined) updated.feeBumpCount = feeBumpData.feeBumpCount;
    if (feeBumpData.currentFee !== undefined) updated.currentFee = feeBumpData.currentFee;
    if (feeBumpData.lastFeeBumpAt !== undefined) updated.lastFeeBumpAt = feeBumpData.lastFeeBumpAt;
    if (feeBumpData.envelopeXdr !== undefined) updated.envelopeXdr = feeBumpData.envelopeXdr;
    if (feeBumpData.stellarTxId !== undefined) updated.stellarTxId = feeBumpData.stellarTxId;

    _store.set(id, updated);
    _persist(updated);
    return updated;
  }

  static getByStatus(status) {
    return Array.from(_store.values()).filter(t => t.status === status);
  }

  static getByStellarTxId(stellarTxId) {
    for (const tx of _store.values()) {
      if (tx.stellarTxId === stellarTxId) return tx;
    }
    return undefined;
  }

  static getDailyTotalByDonor(donor, date = new Date()) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return Array.from(_store.values())
      .filter(t => {
        const txDate = new Date(t.timestamp);
        return t.donor === donor &&
          txDate >= startOfDay && txDate <= endOfDay &&
          t.status !== 'failed' && t.status !== 'cancelled';
      })
      .reduce((total, t) => total + t.amount, 0);
  }

  static updateNftData(id, nftData) {
    const tx = _store.get(id);
    if (!tx) throw new Error(`Transaction not found: ${id}`);

    const updated = { ...tx };
    const fields = ['nft_asset_code', 'nft_issuer', 'nft_tx_hash', 'nft_minted_at', 'nft_mint_error'];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(nftData, field)) {
        updated[field] = nftData[field];
      }
    }

    _store.set(id, updated);
    _persist(updated);
    return updated;
  }

  /** Test helper — wipe all in-memory and SQLite donation data. */
  static _clearAllData() {
    _store.clear();
    _loaded = true;
    const Database = require('../utils/database');
    Database.run('DELETE FROM donations_store').catch(err =>
      log.error('TRANSACTION_MODEL', 'Failed to clear donations_store', { error: err.message })
    );
  }

  /**
   * Reload the in-memory store from SQLite.
   * Useful after test setup or data import.
   */
  static async _reloadFromDb() {
    _loaded = false;
    _store.clear();
    await _ensureLoaded();
  }
}

Transaction.eventEmitter = donationEvents;

module.exports = Transaction;
