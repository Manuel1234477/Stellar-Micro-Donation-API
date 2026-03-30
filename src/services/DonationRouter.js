/**
 * DonationRouter - Service Layer
 *
 * RESPONSIBILITY: Orchestrate recipient selection from a pool using a named strategy,
 *                 persist the routing decision, and return the selected recipient.
 * OWNER: Backend Team
 * DEPENDENCIES: RecipientPoolRepository, RoutingDecisionRepository,
 *               RoundRobinStateRepository, DonationTotalsRepository, strategy classes
 */

const { ValidationError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');
const HighestNeedStrategy = require('./routing/HighestNeedStrategy');
const GeographicStrategy = require('./routing/GeographicStrategy');
const CampaignUrgencyStrategy = require('./routing/CampaignUrgencyStrategy');
const RoundRobinStrategy = require('./routing/RoundRobinStrategy');

const VALID_STRATEGIES = ['highest-need', 'geographic', 'campaign-urgency', 'round-robin'];

// Default lookback window: 30 days
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

class DonationRouter {
  /**
   * @param {Object} deps
   * @param {import('./RecipientPoolRepository')} deps.recipientPoolRepo
   * @param {import('./RoutingDecisionRepository')} deps.routingDecisionRepo
   * @param {import('./RoundRobinStateRepository')} deps.roundRobinStateRepo
   * @param {import('./DonationTotalsRepository')} deps.donationTotalsRepo
   */
  constructor({ recipientPoolRepo, routingDecisionRepo, roundRobinStateRepo, donationTotalsRepo }) {
    this.recipientPoolRepo = recipientPoolRepo;
    this.routingDecisionRepo = routingDecisionRepo;
    this.roundRobinStateRepo = roundRobinStateRepo;
    this.donationTotalsRepo = donationTotalsRepo;

    this._strategies = {
      'highest-need': new HighestNeedStrategy(),
      'geographic': new GeographicStrategy(),
      'campaign-urgency': new CampaignUrgencyStrategy(),
      'round-robin': new RoundRobinStrategy(),
    };
  }

  /**
   * Select a recipient from the named pool using the given strategy.
   *
   * @param {Object} params
   * @param {string} params.poolName
   * @param {string} params.routingStrategy
   * @param {{ lat: number, lon: number }|null} [params.donorCoordinates]
   * @param {string} params.donationId
   * @param {Date} [params.now]
   * @returns {Promise<{ recipientId: string, recipientName: string, routingDecisionId: string }>}
   */
  async route({ poolName, routingStrategy, donorCoordinates, donationId, now }) {
    // Validate strategy name
    if (!VALID_STRATEGIES.includes(routingStrategy)) {
      throw new ValidationError(
        `Unrecognized routing strategy '${routingStrategy}'. Supported: ${VALID_STRATEGIES.join(', ')}`,
        null,
        ERROR_CODES.INVALID_ROUTING_STRATEGY
      );
    }

    // Load pool members
    const pool = await this.recipientPoolRepo.listMembers(poolName);

    if (pool.length === 0) {
      throw new BusinessLogicError(
        ERROR_CODES.POOL_EMPTY,
        `Pool '${poolName}' is empty — no recipients available for routing`
      );
    }

    const decidedAt = now instanceof Date ? now : (now ? new Date(now) : new Date());

    // Build strategy context and run selection
    let result;
    let currentIndex = null;

    if (routingStrategy === 'highest-need') {
      const donationTotals = await this.donationTotalsRepo.getTotalsForPool(
        pool.map(r => r.id),
        DEFAULT_LOOKBACK_MS
      );
      result = this._strategies['highest-need'].select(pool, { donationTotals });

    } else if (routingStrategy === 'geographic') {
      result = this._strategies['geographic'].select(pool, {
        donorLat: donorCoordinates ? donorCoordinates.lat : null,
        donorLon: donorCoordinates ? donorCoordinates.lon : null,
      });

    } else if (routingStrategy === 'campaign-urgency') {
      result = this._strategies['campaign-urgency'].select(pool, { now: decidedAt });

    } else if (routingStrategy === 'round-robin') {
      currentIndex = await this.roundRobinStateRepo.incrementAndWrap(poolName, pool.length);
      result = this._strategies['round-robin'].select(pool, { currentIndex });
    }

    const { selectedId, excludedIds } = result;

    // Build excluded array with reasons
    const excluded = excludedIds.map(id => ({
      id,
      reason: this._exclusionReason(routingStrategy),
    }));

    // Persist routing decision
    const routingDecisionId = await this.routingDecisionRepo.create({
      donationId,
      poolName,
      strategy: routingStrategy,
      selectedId,
      candidates: pool.map(r => r.id),
      excluded,
      decidedAt: decidedAt.toISOString(),
    });

    // Resolve display name
    const selectedMember = pool.find(r => r.id === selectedId);
    const recipientName = selectedMember ? (selectedMember.displayName || selectedId) : selectedId;

    return { recipientId: selectedId, recipientName, routingDecisionId };
  }

  _exclusionReason(strategy) {
    if (strategy === 'geographic') return 'missing coordinates';
    if (strategy === 'campaign-urgency') return 'missing or expired campaign deadline';
    return 'excluded';
  }
}

module.exports = DonationRouter;
