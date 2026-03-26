/**
 * Leaderboard SSE Manager - Real-time leaderboard updates via Server-Sent Events
 * 
 * Provides SSE endpoint for broadcasting leaderboard updates and 
 * handles cache invalidation on new confirmed donations.
 */

const SseManager = require('../services/SseManager');
const StatsService = require('../routes/services/StatsService');
const donationEvents = require('../events/donationEvents');

/**
 * Event name for leaderboard updates
 */
const LEADERBOARD_EVENT = 'leaderboard.update';

/**
 * Initialize leaderboard SSE and event listeners
 * Should be called at server startup
 */
function initLeaderboardSSE() {
  // Register event listener for confirmed donations
  donationEvents.registerHook(donationEvents.EVENTS.CONFIRMED, (payload) => {
    handleDonationConfirmed(payload);
  });
  
  console.log('[LeaderboardSSE] Initialized - listening for confirmed donations');
}

/**
 * Handle donation confirmation event
 * Invalidates cache and broadcasts updated leaderboards
 * @param {Object} payload - Donation event payload
 */
function handleDonationConfirmed(payload) {
  console.log('[LeaderboardSSE] Donation confirmed, invalidating leaderboard cache', {
    transactionId: payload.transactionId || payload.id
  });
  
  // Invalidate all leaderboard caches
  StatsService.invalidateLeaderboardCache();
  
  // Get updated leaderboards and broadcast
  const periods = ['all', 'monthly', 'weekly', 'daily'];
  const limit = 10;
  
  periods.forEach(period => {
    try {
      const donorsLeaderboard = StatsService.getDonorLeaderboard(period, limit);
      const recipientsLeaderboard = StatsService.getRecipientLeaderboard(period, limit);
      
      const update = {
        type: 'leaderboard',
        period,
        timestamp: new Date().toISOString(),
        donors: donorsLeaderboard,
        recipients: recipientsLeaderboard
      };
      
      // Broadcast to all SSE clients
      SseManager.broadcast(LEADERBOARD_EVENT, update);
      
      console.log('[LeaderboardSSE] Broadcast leaderboard update', { period });
    } catch (error) {
      console.error('[LeaderboardSSE] Error broadcasting update:', error.message);
    }
  });
}

/**
 * Register a new SSE client for leaderboard updates
 * @param {string} clientId - Unique client identifier
 * @param {string} keyId - API key identifier
 * @param {Object} filter - Filter options (optional)
 * @param {import('http').ServerResponse} res - Response object
 * @returns {Object} Client object
 */
function addLeaderboardClient(clientId, keyId, filter, res) {
  return SseManager.addClient(clientId, keyId, filter, res);
}

/**
 * Get current SSE connection stats
 * @returns {Object} Connection statistics
 */
function getConnectionStats() {
  return SseManager.getStats();
}

module.exports = {
  initLeaderboardSSE,
  handleDonationConfirmed,
  addLeaderboardClient,
  getConnectionStats,
  LEADERBOARD_EVENT
};