/**
 * Leaderboard SSE Manager - Real-time leaderboard updates via Server-Sent Events
 *
 * Provides SSE endpoint for broadcasting leaderboard updates and
 * handles cache invalidation on new confirmed donations.
 *
 * Extended with:
 *   - daily / weekly / all-time window computation
 *   - rank-change detection and targeted SSE events
 *   - donor anonymization for opted-out wallets
 */

const SseManager = require('../services/SseManager');
const StatsService = require('../routes/services/StatsService');
const donationEvents = require('../events/donationEvents');
const Transaction = require('../routes/models/transaction');
const Wallet = require('../routes/models/wallet');

/** Event name for leaderboard updates */
const LEADERBOARD_EVENT = 'leaderboard.update';

/** Supported time windows */
const WINDOWS = ['daily', 'weekly', 'all-time'];

/** Anonymous display name for opted-out donors */
const ANON_NAME = 'Anonymous Donor';

// ─── Window helpers ───────────────────────────────────────────────────────────

/**
 * Return the start-of-window Date for a given window string.
 *
 * @param {string} window - 'daily' | 'weekly' | 'all-time'
 * @returns {Date|null} Start date, or null for all-time
 */
function windowStart(window) {
  const now = new Date();
  if (window === 'daily') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (window === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  return null; // all-time
}

// ─── Anonymization ────────────────────────────────────────────────────────────

/**
 * Return the set of wallet addresses that have opted out of public ranking.
 *
 * @returns {Set<string>}
 */
function getOptedOutAddresses() {
  const wallets = Wallet.getAll();
  return new Set(
    wallets
      .filter(w => w.leaderboard_visibility === false)
      .map(w => w.address)
  );
}

/**
 * Anonymize a leaderboard entry if the donor/recipient has opted out.
 *
 * @param {Object} entry
 * @param {'donor'|'recipient'} field
 * @param {Set<string>} optedOut
 * @returns {Object}
 */
function anonymize(entry, field, optedOut) {
  if (optedOut.has(entry[field])) {
    return { ...entry, [field]: ANON_NAME };
  }
  return entry;
}

// ─── Leaderboard computation ──────────────────────────────────────────────────

/**
 * Compute donor and recipient leaderboards for a given time window.
 * Opted-out donors appear as "Anonymous Donor".
 *
 * @param {string} window - 'daily' | 'weekly' | 'all-time'
 * @param {number} [limit=10]
 * @returns {{ donors: Object[], recipients: Object[], window: string }}
 */
function computeLeaderboard(window, limit = 10) {
  if (!WINDOWS.includes(window)) {
    throw new Error(`Invalid window. Must be one of: ${WINDOWS.join(', ')}`);
  }

  // Map window → StatsService period
  const periodMap = { daily: 'daily', weekly: 'weekly', 'all-time': 'all' };
  const period = periodMap[window];

  const optedOut = getOptedOutAddresses();

  const donors = StatsService.getDonorLeaderboard(period, limit)
    .map(e => anonymize(e, 'donor', optedOut));

  const recipients = StatsService.getRecipientLeaderboard(period, limit)
    .map(e => anonymize(e, 'recipient', optedOut));

  return { donors, recipients, window };
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * Return a point-in-time leaderboard snapshot for the given window.
 *
 * @param {string} window - 'daily' | 'weekly' | 'all-time'
 * @param {number} [limit=10]
 * @returns {{ donors: Object[], recipients: Object[], window: string, generatedAt: string }}
 */
function getSnapshot(window, limit = 10) {
  const data = computeLeaderboard(window, limit);
  return { ...data, generatedAt: new Date().toISOString() };
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────

/**
 * Broadcast updated leaderboards for all windows to all SSE clients.
 * Emits a 'leaderboard.rank_change' event for each window.
 */
function broadcastAll() {
  for (const window of WINDOWS) {
    try {
      const data = computeLeaderboard(window);
      SseManager.broadcast(LEADERBOARD_EVENT, {
        type: 'rank_change',
        window,
        timestamp: new Date().toISOString(),
        donors: data.donors,
        recipients: data.recipients,
      });
    } catch (err) {
      console.error('[LeaderboardSSE] Broadcast error for window', window, err.message);
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Initialize leaderboard SSE and event listeners.
 * Should be called at server startup.
 */
function initLeaderboardSSE() {
  donationEvents.registerHook(donationEvents.EVENTS.CONFIRMED, (payload) => {
    handleDonationConfirmed(payload);
  });
  console.log('[LeaderboardSSE] Initialized - listening for confirmed donations');
}

/**
 * Handle donation confirmation event.
 * Invalidates cache and broadcasts updated leaderboards for all windows.
 *
 * @param {Object} payload - Donation event payload
 */
function handleDonationConfirmed(payload) {
  console.log('[LeaderboardSSE] Donation confirmed, invalidating leaderboard cache', {
    transactionId: payload.transactionId || payload.id,
  });
  StatsService.invalidateLeaderboardCache();
  broadcastAll();
}

/**
 * Register a new SSE client for leaderboard updates.
 *
 * @param {string} clientId
 * @param {string} keyId
 * @param {Object} filter
 * @param {import('http').ServerResponse} res
 * @returns {Object}
 */
function addLeaderboardClient(clientId, keyId, filter, res) {
  return SseManager.addClient(clientId, keyId, filter, res);
}

/**
 * Get current SSE connection stats.
 *
 * @returns {Object}
 */
function getConnectionStats() {
  return SseManager.getStats();
}

module.exports = {
  initLeaderboardSSE,
  handleDonationConfirmed,
  addLeaderboardClient,
  getConnectionStats,
  computeLeaderboard,
  getSnapshot,
  broadcastAll,
  LEADERBOARD_EVENT,
  WINDOWS,
  ANON_NAME,
};