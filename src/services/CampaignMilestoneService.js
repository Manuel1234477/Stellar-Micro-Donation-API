'use strict';

/**
 * CampaignMilestoneService
 * 
 * Detects when a campaign reaches funding milestones (25%, 50%, 75%, 100%)
 * and triggers webhook events and email notifications.
 */

const Database = require('../utils/database');
const log = require('../utils/log');
const EventEmitter = require('events');

/** Milestone percentages we track */
const MILESTONES = [
  { percent: 25, bitmask: 1 },
  { percent: 50, bitmask: 2 },
  { percent: 75, bitmask: 4 },
  { percent: 100, bitmask: 8 },
];

class CampaignMilestoneService extends EventEmitter {
  constructor() {
    super();
    
    // Wire up webhook delivery when milestones are reached
    this.on('campaign.milestone_reached', async (eventData) => {
      try {
        const WebhookService = require('./WebhookService');
        const webhookSvc = new WebhookService();
        await webhookSvc.deliver(eventData.event, eventData.data);
      } catch (error) {
        log.error('CAMPAIGN_MILESTONE', 'Failed to deliver webhook', {
          event: eventData.event,
          error: error.message,
        });
      }
    });
  }
  /**
   * Check if a campaign has crossed any new milestones after a donation.
   * Emits 'campaign.milestone_reached' event for each newly reached milestone.
   * 
   * @param {number} campaignId - Campaign ID
   * @param {Object} tx - Database transaction object
   * @returns {Promise<Array<Object>>} Array of newly reached milestones
   */
  async checkMilestones(campaignId, tx) {
    // Fetch campaign details
    const campaign = await (tx || Database).get(
      `SELECT id, name, goal_amount, current_amount, milestones_reached, notification_email
       FROM campaigns WHERE id = ? AND deleted_at IS NULL`,
      [campaignId]
    );

    if (!campaign || !campaign.goal_amount || campaign.goal_amount <= 0) {
      return [];
    }

    const currentPercent = (campaign.current_amount / campaign.goal_amount) * 100;
    const reachedMask = campaign.milestones_reached || 0;
    const newlyReached = [];

    for (const milestone of MILESTONES) {
      // Check if milestone is reached and not yet recorded
      if (currentPercent >= milestone.percent && !(reachedMask & milestone.bitmask)) {
        newlyReached.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          percent: milestone.percent,
          goalAmount: campaign.goal_amount,
          currentAmount: campaign.current_amount,
          notificationEmail: campaign.notification_email,
        });

        // Update bitmask
        const newMask = reachedMask | milestone.bitmask;
        await (tx || Database).run(
          'UPDATE campaigns SET milestones_reached = ? WHERE id = ?',
          [newMask, campaign.id]
        );

        log.info('CAMPAIGN_MILESTONE', `Campaign reached ${milestone.percent}% milestone`, {
          campaignId: campaign.id,
          campaignName: campaign.name,
          percent: milestone.percent,
          currentAmount: campaign.current_amount,
          goalAmount: campaign.goal_amount,
        });
      }
    }

    // Emit webhook events for newly reached milestones
    for (const milestone of newlyReached) {
      this.emit('campaign.milestone_reached', {
        event: 'campaign.milestone_reached',
        data: {
          campaignId: milestone.campaignId,
          campaignName: milestone.campaignName,
          milestonePercent: milestone.percent,
          currentAmount: milestone.currentAmount,
          goalAmount: milestone.goalAmount,
          percentageComplete: (milestone.currentAmount / milestone.goalAmount * 100).toFixed(2),
          timestamp: new Date().toISOString(),
        },
      });
    }

    return newlyReached;
  }

  /**
   * Send email notification for a milestone (if email is configured).
   * 
   * @param {Object} milestone - Milestone data
   * @returns {Promise<boolean>} True if email was sent
   */
  async sendMilestoneEmail(milestone) {
    if (!milestone.notificationEmail) {
      return false;
    }

    try {
      // Import email service dynamically to avoid circular dependency
      const emailService = require('../utils/emailService');
      
      if (!emailService || typeof emailService.sendMilestoneNotification !== 'function') {
        log.warn('CAMPAIGN_MILESTONE', 'Email service not available for milestone notification');
        return false;
      }

      await emailService.sendMilestoneNotification({
        to: milestone.notificationEmail,
        campaignName: milestone.campaignName,
        milestonePercent: milestone.percent,
        currentAmount: milestone.currentAmount,
        goalAmount: milestone.goalAmount,
      });

      log.info('CAMPAIGN_MILESTONE', 'Milestone email sent', {
        campaignId: milestone.campaignId,
        percent: milestone.percent,
        email: milestone.notificationEmail,
      });

      return true;
    } catch (error) {
      log.error('CAMPAIGN_MILESTONE', 'Failed to send milestone email', {
        campaignId: milestone.campaignId,
        percent: milestone.percent,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Reset milestones for a campaign (useful for testing or manual correction).
   * 
   * @param {number} campaignId
   * @returns {Promise<void>}
   */
  async resetMilestones(campaignId) {
    await Database.run(
      'UPDATE campaigns SET milestones_reached = 0 WHERE id = ?',
      [campaignId]
    );
    log.info('CAMPAIGN_MILESTONE', 'Campaign milestones reset', { campaignId });
  }
}

module.exports = new CampaignMilestoneService();
