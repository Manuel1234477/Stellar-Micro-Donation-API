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
/** @type {Map<string, object>} idempotencyKey -> transaction object */
const _idempotencyIndex = new Map();
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
  ).catch(err => {
    const isIdempotencyConflict = err && err.message && /UNIQUE constraint failed: donations_store\.idempotency_key/i.test(err.message);
    if (isIdempotencyConflict && _store.get(tx.id) === tx) {
      _store.delete(tx.id);
      if (tx.idempotencyKey && _idempotencyIndex.get(tx.idempotencyKey) === tx) {
        _idempotencyIndex.delete(tx.idempotencyKey);
      }
    }

    log.error('TRANSACTION_MODEL', 'SQLite persist failed', { id: tx.id, error: err.message });
  });
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
          if (tx.idempotencyKey) {
            _idempotencyIndex.set(tx.idempotencyKey, tx);
          }
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
      const existing = _idempotencyIndex.get(transactionData.idempotencyKey);
      if (existing) {
        return existing;
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
    if (newTransaction.idempotencyKey) {
      _idempotencyIndex.set(newTransaction.idempotencyKey, newTransaction);
    }
    _persist(newTransaction);

    if (Array.isArray(newTransaction.tags) && newTransaction.tags.length > 0) {
      try {
        const TagService = require('../services/TagService');
        TagService.associateTags(newTransaction.id, newTransaction.tags).catch(() => {});
      } catch (_) {}
    }

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

  /**
   * Cursor-paginated transaction list with multi-field compound filtering.
   *
   * Supported filters (all optional, combined with AND by default):
   *   fromAddress    — exact match on tx.donor
   *   toAddress      — exact match on tx.recipient
   *   senderPublicKey  — alias for fromAddress (legacy)
   *   recipientPublicKey — alias for toAddress (legacy)
   *   amountMin      — inclusive lower bound on amount
   *   amountMax      — inclusive upper bound on amount
   *   startDate / dateFrom — ISO date, inclusive lower bound on timestamp
   *   endDate / dateTo     — ISO date, inclusive upper bound on timestamp
   *   status         — exact match on status
   *   memoContains   — case-insensitive substring match on memo
   *   sort           — "field:asc" or "field:desc" (field: amount|timestamp|status)
   *   filterMode     — "all" (AND, default) | "any" (OR)
   *
   * All filter values are applied via parameterised in-memory comparisons — no
   * user input is ever interpolated into SQL strings.
   */
  static getCursorPaginated({
    limit = 20,
    cursor = null,
    // legacy aliases
    startDate, endDate,
    senderPublicKey, recipientPublicKey,
    // new compound-filter params
    fromAddress, toAddress,
    amountMin, amountMax,
    dateFrom, dateTo,
    status,
    memoContains,
    sort,
    filterMode = 'all',
  } = {}) {
    let cursorTime = null;
    let cursorId = null;

    // Resolve legacy aliases → canonical names
    const effectiveFrom = fromAddress || senderPublicKey;
    const effectiveTo = toAddress || recipientPublicKey;
    const effectiveStart = dateFrom || startDate;
    const effectiveEnd = dateTo || endDate;

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        if (decoded && typeof decoded.t === 'number') {
          cursorTime = decoded.t;
          cursorId = decoded.id;
        }
      } catch {
        const parts = cursor.split('_');
        if (parts.length >= 2) {
          cursorTime = parseInt(parts[0]);
          cursorId = parts.slice(1).join('_');
        }
      }
    }

    const all = Array.from(_store.values()).filter(t => !t.deleted_at);

    // Build a list of predicate functions from active filters.
    // Parameterised approach: values are captured in closures, never interpolated.
    const predicates = [];

    if (effectiveFrom) {
      predicates.push(t => t.donor === effectiveFrom);
    }
    if (effectiveTo) {
      predicates.push(t => t.recipient === effectiveTo);
    }
    if (amountMin != null) {
      const min = parseFloat(amountMin);
      predicates.push(t => t.amount >= min);
    }
    if (amountMax != null) {
      const max = parseFloat(amountMax);
      predicates.push(t => t.amount <= max);
    }
    if (effectiveStart) {
      const startMs = new Date(effectiveStart).getTime();
      predicates.push(t => new Date(t.timestamp).getTime() >= startMs);
    }
    if (effectiveEnd) {
      const endMs = new Date(effectiveEnd).getTime();
      predicates.push(t => new Date(t.timestamp).getTime() <= endMs);
    }
    if (status) {
      const normalizedStatus = status.toLowerCase();
      predicates.push(t => (t.status || '').toLowerCase() === normalizedStatus);
    }
    if (memoContains) {
      const needle = memoContains.toLowerCase();
      predicates.push(t => (t.memo || '').toLowerCase().includes(needle));
    }

    // Apply predicates: AND (all) or OR (any)
    let active;
    if (predicates.length === 0) {
      active = all;
    } else if (filterMode === 'any') {
      active = all.filter(t => predicates.some(fn => fn(t)));
    } else {
      active = all.filter(t => predicates.every(fn => fn(t)));
    }

    // Parse sort parameter: "field:asc" | "field:dir"
    const ALLOWED_SORT_FIELDS = new Set(['amount', 'timestamp', 'status']);
    let sortField = 'timestamp';
    let sortDir = 'desc';

    if (sort) {
      const [field, dir] = sort.split(':');
      if (field && ALLOWED_SORT_FIELDS.has(field.toLowerCase())) {
        sortField = field.toLowerCase();
      }
      if (dir && (dir.toLowerCase() === 'asc' || dir.toLowerCase() === 'desc')) {
        sortDir = dir.toLowerCase();
      }
    }

    const sorted = active.sort((a, b) => {
      let valA, valB;
      if (sortField === 'amount') {
        valA = a.amount ?? 0;
        valB = b.amount ?? 0;
      } else if (sortField === 'status') {
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
      } else {
        // timestamp (default)
        valA = new Date(a.timestamp).getTime();
        valB = new Date(b.timestamp).getTime();
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      // Stable tiebreaker: always descending by id
      return b.id.localeCompare(a.id);
    });

    // Cursor-based slicing
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

    // Build next cursor — carry active filters so subsequent pages are consistent.
    let nextCursor = null;
    if (hasMore && paginatedData.length > 0) {
      const lastItem = paginatedData[paginatedData.length - 1];
      const lastTimestamp = new Date(lastItem.timestamp).getTime();

      const hasFilters = effectiveFrom || effectiveTo || amountMin != null || amountMax != null ||
        effectiveStart || effectiveEnd || status || memoContains || sort || filterMode !== 'all';

      if (hasFilters) {
        const payload = { t: lastTimestamp, id: lastItem.id };
        if (effectiveFrom) payload.fa = effectiveFrom;
        if (effectiveTo) payload.ta = effectiveTo;
        if (amountMin != null) payload.amin = amountMin;
        if (amountMax != null) payload.amax = amountMax;
        if (effectiveStart) payload.sd = effectiveStart;
        if (effectiveEnd) payload.ed = effectiveEnd;
        if (status) payload.st = status;
        if (memoContains) payload.mc = memoContains;
        if (sort) payload.so = sort;
        if (filterMode && filterMode !== 'all') payload.fm = filterMode;
        nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
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

    try {
      assertValidTransition(currentStatus, nextStatus);
    } catch (transitionErr) {
      const AuditLogService = require('../services/AuditLogService');
      AuditLogService.log({
        category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
        action: 'ILLEGAL_STATE_TRANSITION_REJECTED',
        severity: AuditLogService.SEVERITY.HIGH,
        result: 'FAILURE',
        resource: `transaction:${id}`,
        details: {
          transactionId: id,
          fromState: currentStatus,
          toState: nextStatus,
        },
      }).catch(() => {});
      throw transitionErr;
    }

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

  /**
   * Record a signer approval on a donation awaiting multi-sig approval (#1498).
   * Does not itself advance `status` — the caller (DonationService) decides
   * whether the collected approvals meet the required threshold and, if so,
   * transitions the record via updateStatus() after submitting to Stellar.
   *
   * @param {string} id
   * @param {Object[]} approvals - Full updated approvals array
   * @returns {Object} Updated transaction
   */
  static updateApprovals(id, approvals) {
    const tx = _store.get(id);
    if (!tx) throw new Error(`Transaction not found: ${id}`);

    const updated = { ...tx, approvals };

    _store.set(id, updated);
    _persist(updated);
    return updated;
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
    _idempotencyIndex.clear();
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
    _idempotencyIndex.clear();
    await _ensureLoaded();
  }
}

Transaction.eventEmitter = donationEvents;

module.exports = Transaction;
