'use strict';

/**
 * Geo-rules Admin Routes
 *
 * RESPONSIBILITY: CRUD management of geo-blocking rules at runtime
 * OWNER: Security Team
 * DEPENDENCIES: GeoRuleService, geoBlock middleware, RBAC, AuditLogService
 *
 * Endpoints:
 *   GET    /admin/geo-rules
 *   POST   /admin/geo-rules
 *   PATCH  /admin/geo-rules/:id
 *   DELETE /admin/geo-rules/:id
 *   POST   /admin/geo-rules/test
 */

const express = require('express');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const GeoRuleService = require('../../services/GeoRuleService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');
const { geoBlockMiddleware } = require('../../middleware/geoBlock');

const router = express.Router();

function getActorId(req) {
  return req.user?.id?.toString() || req.apiKey?.id?.toString() || null;
}

function respondSuccess(res, payload, status = 200) {
  return res.status(status).json({ success: true, data: payload });
}

function respondError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

const auth = [requireApiKey, requireAdmin()];

/**
 * GET /admin/geo-rules
 * List all geo-blocking rules.
 */
router.get('/', ...auth, async (req, res, next) => {
  try {
    const rules = await GeoRuleService.loadRules({ forceRefresh: true });
    const shaped = rules.map((r) => ({
      id: r.id,
      countryCode: r.countryCode,
      action: r.ruleType,
      active: r.active,
      createdAt: r.createdAt,
      description: r.description || null,
    }));
    return respondSuccess(res, shaped);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/geo-rules
 * Create a new geo-blocking rule.
 * Body: { countryCode: string, action: "block"|"allow", description?: string }
 */
router.post('/', ...auth, async (req, res, next) => {
  try {
    const { countryCode, action, description } = req.body || {};

    if (!countryCode || !GeoRuleService.isValidCountryCode(GeoRuleService.normalizeCountryCode(countryCode))) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'countryCode must be a valid ISO 3166-1 alpha-2 code');
    }

    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['block', 'allow'].includes(normalizedAction)) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'action must be "block" or "allow"');
    }

    try {
      const rule = await GeoRuleService.addRule(
        normalizedAction,
        countryCode,
        getActorId(req),
        description || null
      );

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.CONFIGURATION,
        action: 'GEO_RULE_CREATED',
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: getActorId(req),
        requestId: req.id || null,
        ipAddress: req.ip || null,
        resource: req.originalUrl || req.path,
        details: { ruleId: rule.id, countryCode: rule.countryCode, action: rule.ruleType },
      });

      log.info('GEO_RULES', 'Geo rule created', { id: rule.id, countryCode: rule.countryCode, action: rule.ruleType });

      return respondSuccess(res, {
        id: rule.id,
        countryCode: rule.countryCode,
        action: rule.ruleType,
        active: rule.active,
        createdAt: rule.createdAt,
        description: rule.description || null,
      }, 201);
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('Duplicate'))) {
        return respondError(res, 409, 'DUPLICATE_GEO_RULE', `A ${normalizedAction} rule for ${GeoRuleService.normalizeCountryCode(countryCode)} already exists`);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/geo-rules/:id
 * Update a geo rule (toggle active, change description).
 * Body: { active?: boolean, description?: string }
 */
router.patch('/:id', ...auth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'id must be a positive integer');
    }

    const updates = {};
    if (typeof req.body?.active === 'boolean') {
      updates.active = req.body.active;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'description')) {
      updates.description = req.body.description;
    }

    const updated = await GeoRuleService.updateById(id, updates);
    if (!updated) {
      return respondError(res, 404, 'NOT_FOUND', `Geo rule ${id} not found`);
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'GEO_RULE_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: getActorId(req),
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: req.originalUrl || req.path,
      details: { ruleId: id, updates },
    });

    log.info('GEO_RULES', 'Geo rule updated', { id, updates });

    return respondSuccess(res, {
      id: updated.id,
      countryCode: updated.countryCode,
      action: updated.ruleType,
      active: updated.active,
      createdAt: updated.createdAt,
      description: updated.description || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/geo-rules/:id
 * Remove a geo rule by ID.
 */
router.delete('/:id', ...auth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'id must be a positive integer');
    }

    const changes = await GeoRuleService.removeById(id);
    if (!changes) {
      return respondError(res, 404, 'NOT_FOUND', `Geo rule ${id} not found`);
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'GEO_RULE_DELETED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: getActorId(req),
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: req.originalUrl || req.path,
      details: { ruleId: id },
    });

    log.info('GEO_RULES', 'Geo rule deleted', { id });

    return respondSuccess(res, { id, removed: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/geo-rules/test
 * Test whether an IP address would be blocked under current rules.
 * Body: { ip: string }
 * Returns: { allowed: boolean, country: string|null, countryName: string|null, matchedRule: Object|null, defaultAction: string }
 */
router.post('/test', ...auth, async (req, res, next) => {
  try {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'ip is required');
    }

    // Validate IP format (basic check). Fixed {3} repetition — linear, not ReDoS-prone.
    // eslint-disable-next-line security/detect-unsafe-regex
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      return respondError(res, 400, 'INVALID_IP_FORMAT', 'ip must be a valid IPv4 address');
    }

    // Check if it's a private/reserved IP
    if (isPrivateIP(ip)) {
      return respondSuccess(res, {
        allowed: true,
        country: null,
        countryName: null,
        matchedRule: null,
        defaultAction: 'allow'
      });
    }

    const databaseRules = await GeoRuleService.loadRules();
    const ruleState = geoBlockMiddleware.buildRuleState(databaseRules);
    const countryCode = geoBlockMiddleware.getCountryCode(ip);
    const decision = geoBlockMiddleware.shouldBlock(ip, ruleState);

    // Get country name from country code
    const countryName = countryCode ? getCountryName(countryCode) : null;

    // Determine matched rule details
    let matchedRule = null;
    if (decision.matchedRule) {
      const rule = databaseRules.find(r => r.countryCode === decision.matchedRule.countryCode && r.ruleType === decision.matchedRule.type);
      if (rule) {
        matchedRule = {
          id: rule.id,
          action: rule.ruleType,
          description: rule.description || null
        };
      }
    }

    return respondSuccess(res, {
      allowed: !decision.block,
      country: countryCode,
      countryName,
      matchedRule,
      defaultAction: 'allow'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Check if IP is private/reserved (RFC 1918)
 * @param {string} ip - IP address
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Get country name from ISO country code
 * @param {string} countryCode - ISO 3166-1 alpha-2 code
 * @returns {string|null}
 */
function getCountryName(countryCode) {
  const countryNames = {
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'JP': 'Japan',
    'CN': 'China',
    'IN': 'India',
    'BR': 'Brazil',
    'RU': 'Russia',
    'MX': 'Mexico',
    'IT': 'Italy',
    'ES': 'Spain',
    'KR': 'South Korea',
    'NL': 'Netherlands',
    'SE': 'Sweden',
    'CH': 'Switzerland',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'PL': 'Poland',
    'TR': 'Turkey',
    'SG': 'Singapore',
    'HK': 'Hong Kong',
    'NZ': 'New Zealand',
    'ZA': 'South Africa',
    'AE': 'United Arab Emirates',
    'SA': 'Saudi Arabia',
    'IL': 'Israel',
    'TH': 'Thailand',
    'MY': 'Malaysia',
    'ID': 'Indonesia',
    'PH': 'Philippines',
    'VN': 'Vietnam',
    'NG': 'Nigeria',
    'EG': 'Egypt',
    'KE': 'Kenya',
    'AR': 'Argentina',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'UA': 'Ukraine',
    'CZ': 'Czech Republic',
    'GR': 'Greece',
    'PT': 'Portugal',
    'BE': 'Belgium',
    'AT': 'Austria',
    'IE': 'Ireland',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'SI': 'Slovenia',
    'SK': 'Slovakia',
    'LT': 'Lithuania',
    'LV': 'Latvia',
    'EE': 'Estonia',
    'IS': 'Iceland',
    'LU': 'Luxembourg',
    'MT': 'Malta',
    'CY': 'Cyprus',
    'GE': 'Georgia',
    'KZ': 'Kazakhstan',
    'UZ': 'Uzbekistan',
    'TM': 'Turkmenistan',
    'KG': 'Kyrgyzstan',
    'TJ': 'Tajikistan',
    'AF': 'Afghanistan',
    'PK': 'Pakistan',
    'BD': 'Bangladesh',
    'LK': 'Sri Lanka',
    'NP': 'Nepal',
    'BT': 'Bhutan',
    'MM': 'Myanmar',
    'LA': 'Laos',
    'KH': 'Cambodia',
    'TW': 'Taiwan',
    'MO': 'Macau',
    'JO': 'Jordan',
    'LB': 'Lebanon',
    'SY': 'Syria',
    'IQ': 'Iraq',
    'IR': 'Iran',
    'OM': 'Oman',
    'QA': 'Qatar',
    'BH': 'Bahrain',
    'KW': 'Kuwait',
    'YE': 'Yemen',
    'PS': 'Palestine',
    'LY': 'Libya',
    'TN': 'Tunisia',
    'DZ': 'Algeria',
    'MA': 'Morocco',
    'SD': 'Sudan',
    'ET': 'Ethiopia',
    'SO': 'Somalia',
    'DJ': 'Djibouti',
    'ER': 'Eritrea',
    'UG': 'Uganda',
    'TZ': 'Tanzania',
    'RW': 'Rwanda',
    'BW': 'Botswana',
    'NA': 'Namibia',
    'ZM': 'Zambia',
    'ZW': 'Zimbabwe',
    'MW': 'Malawi',
    'MZ': 'Mozambique',
    'AO': 'Angola',
    'CG': 'Congo',
    'CD': 'Democratic Republic of the Congo',
    'GA': 'Gabon',
    'CM': 'Cameroon',
    'GH': 'Ghana',
    'CI': 'Ivory Coast',
    'SN': 'Senegal',
    'ML': 'Mali',
    'BF': 'Burkina Faso',
    'NE': 'Niger',
    'TD': 'Chad',
    'CF': 'Central African Republic',
    'BJ': 'Benin',
    'TG': 'Togo',
    'LR': 'Liberia',
    'SL': 'Sierra Leone',
    'GM': 'Gambia',
    'GW': 'Guinea-Bissau',
    'GN': 'Guinea',
    'MR': 'Mauritania',
    'CV': 'Cape Verde',
    'SC': 'Seychelles',
    'MU': 'Mauritius',
    'MG': 'Madagascar',
    'KM': 'Comoros',
    'FJ': 'Fiji',
    'PG': 'Papua New Guinea',
    'SB': 'Solomon Islands',
    'VU': 'Vanuatu',
    'WS': 'Samoa',
    'KI': 'Kiribati',
    'TO': 'Tonga',
    'PW': 'Palau',
    'MH': 'Marshall Islands',
    'FM': 'Micronesia',
    'NR': 'Nauru',
    'TV': 'Tuvalu',
  };
  return countryNames[countryCode] || null;
}

module.exports = router;
