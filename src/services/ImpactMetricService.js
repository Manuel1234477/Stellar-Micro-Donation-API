/**
 * Impact Metric Service - Business Logic Layer
 *
 * RESPONSIBILITY: CRUD for impact metrics and impact calculation against donations
 * OWNER: Backend Team
 * DEPENDENCIES: Database, errors
 *
 * Allows organisations to define impact metrics per campaign (e.g. "$10 = 1 meal")
 * and calculates the real-world impact of individual donations or entire campaigns.
 */

const Database = require('../utils/database');
const { NotFoundError, ValidationError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

/**
 * UN Sustainable Development Goals — 17 SDGs with codes and descriptions.
 * @type {Array<{code: string, goal: number, title: string, description: string}>}
 */
const SDG_CATEGORIES = [
  { code: 'SDG1',  goal: 1,  title: 'No Poverty',                description: 'End poverty in all its forms everywhere' },
  { code: 'SDG2',  goal: 2,  title: 'Zero Hunger',               description: 'End hunger, achieve food security and improved nutrition' },
  { code: 'SDG3',  goal: 3,  title: 'Good Health and Well-being', description: 'Ensure healthy lives and promote well-being for all' },
  { code: 'SDG4',  goal: 4,  title: 'Quality Education',          description: 'Ensure inclusive and equitable quality education' },
  { code: 'SDG5',  goal: 5,  title: 'Gender Equality',            description: 'Achieve gender equality and empower all women and girls' },
  { code: 'SDG6',  goal: 6,  title: 'Clean Water and Sanitation', description: 'Ensure availability and sustainable management of water' },
  { code: 'SDG7',  goal: 7,  title: 'Affordable and Clean Energy', description: 'Ensure access to affordable, reliable, sustainable energy' },
  { code: 'SDG8',  goal: 8,  title: 'Decent Work and Economic Growth', description: 'Promote sustained, inclusive economic growth' },
  { code: 'SDG9',  goal: 9,  title: 'Industry, Innovation and Infrastructure', description: 'Build resilient infrastructure and foster innovation' },
  { code: 'SDG10', goal: 10, title: 'Reduced Inequalities',       description: 'Reduce inequality within and among countries' },
  { code: 'SDG11', goal: 11, title: 'Sustainable Cities and Communities', description: 'Make cities inclusive, safe, resilient and sustainable' },
  { code: 'SDG12', goal: 12, title: 'Responsible Consumption and Production', description: 'Ensure sustainable consumption and production patterns' },
  { code: 'SDG13', goal: 13, title: 'Climate Action',             description: 'Take urgent action to combat climate change' },
  { code: 'SDG14', goal: 14, title: 'Life Below Water',           description: 'Conserve and sustainably use the oceans and marine resources' },
  { code: 'SDG15', goal: 15, title: 'Life on Land',               description: 'Protect, restore and promote sustainable use of terrestrial ecosystems' },
  { code: 'SDG16', goal: 16, title: 'Peace, Justice and Strong Institutions', description: 'Promote peaceful and inclusive societies' },
  { code: 'SDG17', goal: 17, title: 'Partnerships for the Goals', description: 'Strengthen the means of implementation and revitalize global partnerships' },
];

const VALID_SDG_CODES = new Set(SDG_CATEGORIES.map(s => s.code));

/**
 * Validate an array of SDG category codes.
 * @param {string[]} codes
 * @returns {{ valid: boolean, invalid: string[] }}
 */
function validateSdgCodes(codes) {
  if (!Array.isArray(codes)) return { valid: false, invalid: [] };
  const invalid = codes.filter(c => !VALID_SDG_CODES.has(c));
  return { valid: invalid.length === 0, invalid };
}

const SDG_INFO = {
  1:  { name: 'No Poverty', icon: '🎯' },
  2:  { name: 'Zero Hunger', icon: '🍲' },
  3:  { name: 'Good Health and Well-being', icon: '🏥' },
  4:  { name: 'Quality Education', icon: '🎓' },
  5:  { name: 'Gender Equality', icon: '⚖️' },
  6:  { name: 'Clean Water and Sanitation', icon: '💧' },
  7:  { name: 'Affordable and Clean Energy', icon: '⚡' },
  8:  { name: 'Decent Work and Economic Growth', icon: '📈' },
  9:  { name: 'Industry, Innovation and Infrastructure', icon: '🏗️' },
  10: { name: 'Reduced Inequalities', icon: '🤝' },
  11: { name: 'Sustainable Cities and Communities', icon: '🏙️' },
  12: { name: 'Responsible Consumption and Production', icon: '🔄' },
  13: { name: 'Climate Action', icon: '🌍' },
  14: { name: 'Life Below Water', icon: '🐟' },
  15: { name: 'Life on Land', icon: '🌳' },
  16: { name: 'Peace, Justice and Strong Institutions', icon: '🕊️' },
  17: { name: 'Partnerships for the Goals', icon: '🌐' },
};

const DEFAULT_MAPPINGS = [
  { tag: 'education', sdgId: 4 },
  { tag: 'clean-water', sdgId: 6 },
  { tag: 'health', sdgId: 3 },
  { tag: 'climate', sdgId: 13 },
];

let _inMemoryMappings = new Map(DEFAULT_MAPPINGS.map(m => [m.tag, m.sdgId]));
let _mappingCache = null;
let _mappingCacheExpiry = 0;
const SDG_CACHE_MAX_AGE_SEC = 300; // 5 minutes
const SDG_CACHE_TTL_MS = SDG_CACHE_MAX_AGE_SEC * 1000;

class ImpactMetricService {
  /**
   * Ensure sdg_mappings table exists
   */
  static async _ensureSdgTable() {
    try {
      await Database.run(`
        CREATE TABLE IF NOT EXISTS sdg_mappings (
          tag TEXT PRIMARY KEY,
          sdg_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (_) {}
  }

  /**
   * Get SDG info helper
   * @param {number} sdgId
   * @returns {{ sdgId: number, sdgName: string, sdgIcon: string }}
   */
  static getSdgInfo(sdgId) {
    const id = Number(sdgId);
    const info = SDG_INFO[id] || { name: `SDG ${id}`, icon: '🎯' };
    return {
      sdgId: id,
      sdgName: info.name,
      sdgIcon: info.icon,
    };
  }

  /**
   * Invalidate SDG mapping cache
   */
  static invalidateMappingCache() {
    _mappingCache = null;
    _mappingCacheExpiry = 0;
  }

  /**
   * Get all SDG mappings with 5-minute caching
   * @returns {Promise<Array<{tag: string, sdgId: number, sdgName: string, sdgIcon: string}>>}
   */
  static async getAllSdgMappings() {
    const now = Date.now();
    if (_mappingCache && now < _mappingCacheExpiry) {
      return _mappingCache;
    }

    await this._ensureSdgTable();

    try {
      const rows = await Database.query('SELECT tag, sdg_id FROM sdg_mappings');
      if (rows && rows.length > 0) {
        _inMemoryMappings = new Map(rows.map(r => [r.tag, r.sdg_id]));
      } else if (_inMemoryMappings.size === 0) {
        _inMemoryMappings = new Map(DEFAULT_MAPPINGS.map(m => [m.tag, m.sdgId]));
      }
    } catch (_) {}

    const result = Array.from(_inMemoryMappings.entries()).map(([tag, sdgId]) => {
      const info = this.getSdgInfo(sdgId);
      return {
        tag,
        sdgId: info.sdgId,
        sdgName: info.sdgName,
        sdgIcon: info.sdgIcon,
      };
    });

    _mappingCache = result;
    _mappingCacheExpiry = now + SDG_CACHE_TTL_MS;

    return result;
  }

  /**
   * Set or update SDG mapping for a tag
   * @param {string} tag
   * @param {number} sdgId
   * @returns {Promise<{ created: boolean, mapping: { tag: string, sdgId: number, sdgName: string, sdgIcon: string } }>}
   */
  static async setSdgMapping(tag, sdgId) {
    if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
      throw new ValidationError('Tag is required and must be a non-empty string');
    }
    const id = Number(sdgId);
    if (isNaN(id) || !Number.isInteger(id) || id < 1 || id > 17) {
      throw new ValidationError('sdgId must be an integer between 1 and 17');
    }

    const cleanTag = tag.trim();
    const isNew = !_inMemoryMappings.has(cleanTag);

    _inMemoryMappings.set(cleanTag, id);
    this.invalidateMappingCache();

    await this._ensureSdgTable();
    try {
      await Database.run(
        `INSERT INTO sdg_mappings (tag, sdg_id, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(tag) DO UPDATE SET sdg_id = excluded.sdg_id, updated_at = CURRENT_TIMESTAMP`,
        [cleanTag, id]
      );
    } catch (_) {}

    const info = this.getSdgInfo(id);
    const mapping = {
      tag: cleanTag,
      sdgId: info.sdgId,
      sdgName: info.sdgName,
      sdgIcon: info.sdgIcon,
    };

    return { created: isNew, mapping };
  }

  /**
   * Delete SDG mapping for a tag
   * @param {string} tag
   * @returns {Promise<boolean>}
   */
  static async deleteSdgMapping(tag) {
    if (!tag) return false;
    const cleanTag = String(tag).trim();

    await this._ensureSdgTable();
    let deleted = false;

    if (_inMemoryMappings.has(cleanTag)) {
      _inMemoryMappings.delete(cleanTag);
      deleted = true;
    }

    try {
      const res = await Database.run('DELETE FROM sdg_mappings WHERE tag = ?', [cleanTag]);
      if (res && res.changes > 0) {
        deleted = true;
      }
    } catch (_) {}

    if (deleted) {
      this.invalidateMappingCache();
    }

    return deleted;
  }

  /**
   * Create a new impact metric for a campaign.
   *
   * @param {Object} params
   * @param {number} params.campaign_id - ID of the campaign this metric belongs to
   * @param {string} params.unit - Human-readable unit label (e.g. "meal", "book")
   * @param {number} params.amount_per_unit - Donation amount required to deliver one unit
   * @param {string} [params.description] - Optional longer description
   * @returns {Promise<Object>} Created impact metric record
   * @throws {ValidationError} If campaign does not exist
   */
  static async create({ campaign_id, unit, amount_per_unit, description = null }) {
    const campaign = await Database.get('SELECT id FROM campaigns WHERE id = ?', [campaign_id]);
    if (!campaign) {
      throw new ValidationError('Campaign not found', null, ERROR_CODES.NOT_FOUND);
    }

    const result = await Database.run(
      `INSERT INTO impact_metrics (campaign_id, unit, amount_per_unit, description)
       VALUES (?, ?, ?, ?)`,
      [campaign_id, unit, amount_per_unit, description]
    );

    const metric = await Database.get('SELECT * FROM impact_metrics WHERE id = ?', [result.id]);

    log.info('IMPACT_METRIC', 'Created impact metric', {
      id: result.id,
      campaign_id,
      unit,
      amount_per_unit,
    });

    return metric;
  }

  /**
   * Get a single impact metric by ID.
   *
   * @param {number} id - Impact metric ID
   * @returns {Promise<Object>} Impact metric record
   * @throws {NotFoundError} If metric does not exist
   */
  static async getById(id) {
    const metric = await Database.get('SELECT * FROM impact_metrics WHERE id = ?', [id]);
    if (!metric) {
      throw new NotFoundError('Impact metric not found', ERROR_CODES.NOT_FOUND);
    }
    return metric;
  }

  /**
   * Get all impact metrics for a campaign.
   *
   * @param {number} campaign_id - Campaign ID
   * @returns {Promise<Array>} List of impact metrics ordered by amount_per_unit ascending
   */
  static async getByCampaign(campaign_id) {
    return Database.query(
      'SELECT * FROM impact_metrics WHERE campaign_id = ? ORDER BY amount_per_unit ASC',
      [campaign_id]
    );
  }

  /**
   * Calculate the impact of a single donation amount against a campaign's metrics.
   *
   * For each metric defined on the campaign, the number of units delivered is
   * floor(donation_amount / amount_per_unit), supporting fractional amounts.
   *
   * @param {number} donationAmount - Donation amount (e.g. in XLM or USD)
   * @param {number} campaign_id - Campaign ID to look up metrics for
   * @returns {Promise<Array<{unit: string, units_delivered: number, description: string|null}>>}
   *   Impact breakdown per metric
   */
  static async calculateDonationImpact(donationAmount, campaign_id) {
    const metrics = await this.getByCampaign(campaign_id);

    return metrics.map(metric => ({
      unit: metric.unit,
      amount_per_unit: metric.amount_per_unit,
      units_delivered: Math.floor(donationAmount / metric.amount_per_unit),
      description: metric.description,
    }));
  }

  /**
   * Calculate the aggregate impact for an entire campaign based on its total donations.
   *
   * @param {number} campaign_id - Campaign ID
   * @returns {Promise<{campaign_id: number, total_donated: number, impact: Array}>}
   *   Aggregate impact summary
   */
  static async calculateCampaignImpact(campaign_id) {
    const campaign = await Database.get('SELECT id, current_amount FROM campaigns WHERE id = ?', [campaign_id]);
    if (!campaign) {
      throw new NotFoundError('Campaign not found', ERROR_CODES.NOT_FOUND);
    }

    const totalDonated = campaign.current_amount || 0;
    const impact = await this.calculateDonationImpact(totalDonated, campaign_id);

    return {
      campaign_id,
      total_donated: totalDonated,
      impact,
    };
  }
}

module.exports = ImpactMetricService;
module.exports.SDG_CATEGORIES = SDG_CATEGORIES;
module.exports.VALID_SDG_CODES = VALID_SDG_CODES;
module.exports.validateSdgCodes = validateSdgCodes;
module.exports.SDG_INFO = SDG_INFO;
module.exports.SDG_CACHE_MAX_AGE_SEC = SDG_CACHE_MAX_AGE_SEC;
