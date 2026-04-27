/**
 * CampaignUrgencyStrategy
 *
 * Selects the recipient whose campaign deadline is nearest to but not before `now`.
 * Recipients without a deadline are excluded.
 * Tiebreaks by lexicographically smallest id.
 */

const { BusinessLogicError, ERROR_CODES } = require('../../utils/errors');

class CampaignUrgencyStrategy {
  /**
   * @param {Array<{id: string, campaignDeadline: string|null}>} pool
   * @param {{ now: Date }} context
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, { now }) {
    const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    const excludedIds = [];
    let minDiff = Infinity;
    let selectedId = null;

    for (const recipient of pool) {
      if (!recipient.campaignDeadline) {
        excludedIds.push(recipient.id);
        continue;
      }

      const deadlineMs = new Date(recipient.campaignDeadline).getTime();
      if (deadlineMs < nowMs) {
        // Deadline has passed — exclude
        excludedIds.push(recipient.id);
        continue;
      }

      const diff = deadlineMs - nowMs;
      if (
        diff < minDiff ||
        (diff === minDiff && recipient.id < selectedId)
      ) {
        minDiff = diff;
        selectedId = recipient.id;
      }
    }

    if (selectedId === null) {
      throw new BusinessLogicError(
        ERROR_CODES.NO_ACTIVE_CAMPAIGNS,
        'No active campaigns found in pool — all deadlines have passed or no deadlines are set'
      );
    }

    return { selectedId, excludedIds };
  }
}

module.exports = CampaignUrgencyStrategy;
