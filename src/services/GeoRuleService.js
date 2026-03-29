'use strict';

/**
 * Geo Rule Service
 *
 * RESPONSIBILITY: Persist and cache runtime-managed country allow/block rules
 * OWNER: Security Team
 * DEPENDENCIES: Database, config, log utility
 *
 * Stores country-level geo rules in SQLite and keeps an in-memory cache with
 * a 60-second TTL so request-time geo checks do not hit the database on every
 * request.
 */

const Database = require('../utils/database');
const config = require('../config');
const log = require('../utils/log');

const GEO_RULE_TYPES = {
  ALLOW: 'allow',
  BLOCK: 'block',
};

const GEO_RULE_CACHE_TTL_MS = 60 * 1000;

const _cache = {
  rules: null,
  expiresAt: 0,
  TTL_MS: GEO_RULE_CACHE_TTL_MS,
};

let ensureTablePromise = null;

/**
 * Normalize a country code to uppercase ISO-3166 alpha-2 format.
 *
 * @param {string} value - Raw country code.
 * @returns {string} Normalized country code.
 */
function normalizeCountryCode(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Check whether a country code is valid for geo rules.
 *
 * @param {string} value - Country code candidate.
 * @returns {boolean} True when the code is valid.
 */
function isValidCountryCode(value) {
  return /^[A-Z]{2}$/.test(normalizeCountryCode(value));
}

/**
 * Reset the in-memory geo rule cache.
 *
 * @returns {void}
 */
function invalidateCache() {
  _cache.rules = null;
  _cache.expiresAt = 0;
}

/**
 * Ensure the geo_rules table exists before use.
 *
 * @returns {Promise<void>}
 */
async function ensureTable() {
  if (ensureTablePromise) {
    return ensureTablePromise;
  }

  ensureTablePromise = (async () => {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS geo_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        countryCode TEXT NOT NULL,
        ruleType TEXT NOT NULL CHECK(ruleType IN ('allow', 'block')),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        createdBy TEXT,
        UNIQUE(countryCode, ruleType)
      )
    `);

    await Database.run(
      'CREATE INDEX IF NOT EXISTS idx_geo_rules_type_country ON geo_rules(ruleType, countryCode)'
    );
  })();

  try {
    await ensureTablePromise;
  } catch (error) {
    ensureTablePromise = null;
    throw error;
  }
}

/**
 * Return the currently cached database rules without reloading them.
 *
 * @returns {Array<Object>} Cached rules or an empty array.
 */
function getCachedRules() {
  return Array.isArray(_cache.rules) ? [..._cache.rules] : [];
}

/**
 * Load database-backed geo rules with a 60-second in-memory cache.
 *
 * @param {{ forceRefresh?: boolean }} [options={}] - Cache control options.
 * @returns {Promise<Array<Object>>} Normalized geo rules.
 */
async function loadRules(options = {}) {
  const { forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && Array.isArray(_cache.rules) && now < _cache.expiresAt) {
    return [..._cache.rules];
  }

  try {
    await ensureTable();
    const rows = await Database.query(
      `SELECT id, countryCode, ruleType, createdAt, createdBy
       FROM geo_rules
       ORDER BY countryCode ASC, ruleType ASC, id ASC`,
      []
    );

    const rules = rows.map((row) => ({
      ...row,
      countryCode: normalizeCountryCode(row.countryCode),
      ruleType: row.ruleType,
      source: 'database',
    }));

    _cache.rules = rules;
    _cache.expiresAt = now + _cache.TTL_MS;

    return [...rules];
  } catch (error) {
    log.warn('GEO_RULES', 'Failed to load geo rules from database', { error: error.message });
    return [];
  }
}

/**
 * Build allow/block sets from the database cache.
 *
 * @param {{ forceRefresh?: boolean }} [options={}] - Cache control options.
 * @returns {Promise<{ rules: Array<Object>, allow: Set<string>, block: Set<string> }>}
 */
async function getRuleSets(options = {}) {
  const rules = await loadRules(options);
  const allow = new Set();
  const block = new Set();

  for (const rule of rules) {
    if (rule.ruleType === GEO_RULE_TYPES.ALLOW) {
      allow.add(rule.countryCode);
    }

    if (rule.ruleType === GEO_RULE_TYPES.BLOCK) {
      block.add(rule.countryCode);
    }
  }

  return { rules, allow, block };
}

/**
 * List all active geo rules including static config-backed rules.
 *
 * @param {{ forceRefresh?: boolean }} [options={}] - Cache control options.
 * @returns {Promise<Object>} Active rule summary.
 */
async function listActiveRules(options = {}) {
  const { rules } = await getRuleSets(options);

  const configAllowRules = config.geoBlocking.allowedCountries.map((countryCode) => ({
    countryCode: normalizeCountryCode(countryCode),
    ruleType: GEO_RULE_TYPES.ALLOW,
    source: 'config',
  }));

  const configBlockRules = config.geoBlocking.blockedCountries.map((countryCode) => ({
    countryCode: normalizeCountryCode(countryCode),
    ruleType: GEO_RULE_TYPES.BLOCK,
    source: 'config',
  }));

  const databaseAllowCountries = rules
    .filter((rule) => rule.ruleType === GEO_RULE_TYPES.ALLOW)
    .map((rule) => rule.countryCode);

  const databaseBlockCountries = rules
    .filter((rule) => rule.ruleType === GEO_RULE_TYPES.BLOCK)
    .map((rule) => rule.countryCode);

  return {
    rules: [...rules, ...configAllowRules, ...configBlockRules],
    database: {
      rules,
      allowCountries: databaseAllowCountries,
      blockCountries: databaseBlockCountries,
    },
    config: {
      allowCountries: [...config.geoBlocking.allowedCountries],
      blockCountries: [...config.geoBlocking.blockedCountries],
      allowedIPs: [...config.geoBlocking.allowedIPs],
    },
    effective: {
      allowCountries: [...new Set([...config.geoBlocking.allowedCountries, ...databaseAllowCountries])],
      blockCountries: [...new Set([...config.geoBlocking.blockedCountries, ...databaseBlockCountries])],
    },
    cache: {
      ttlMs: _cache.TTL_MS,
      expiresAt: _cache.expiresAt,
    },
  };
}

/**
 * Insert a new geo rule into the database and invalidate the cache.
 *
 * @param {string} ruleType - Geo rule type.
 * @param {string} countryCode - ISO country code.
 * @param {string|null} [createdBy=null] - Actor creating the rule.
 * @returns {Promise<Object>} Created rule row.
 */
async function addRule(ruleType, countryCode, createdBy = null) {
  const normalizedType = String(ruleType || '').trim().toLowerCase();
  const normalizedCountryCode = normalizeCountryCode(countryCode);

  if (![GEO_RULE_TYPES.ALLOW, GEO_RULE_TYPES.BLOCK].includes(normalizedType)) {
    throw new Error('Invalid geo rule type');
  }

  if (!isValidCountryCode(normalizedCountryCode)) {
    throw new Error('Invalid country code');
  }

  await ensureTable();

  const result = await Database.run(
    'INSERT INTO geo_rules (countryCode, ruleType, createdBy) VALUES (?, ?, ?)',
    [normalizedCountryCode, normalizedType, createdBy]
  );

  invalidateCache();

  const row = await Database.get(
    `SELECT id, countryCode, ruleType, createdAt, createdBy
     FROM geo_rules
     WHERE id = ?`,
    [result.id]
  );

  return {
    ...row,
    countryCode: normalizeCountryCode(row.countryCode),
    source: 'database',
  };
}

/**
 * Delete a geo rule from the database and invalidate the cache.
 *
 * @param {string} ruleType - Geo rule type.
 * @param {string} countryCode - ISO country code.
 * @returns {Promise<number>} Number of deleted rows.
 */
async function removeRule(ruleType, countryCode) {
  const normalizedType = String(ruleType || '').trim().toLowerCase();
  const normalizedCountryCode = normalizeCountryCode(countryCode);

  if (![GEO_RULE_TYPES.ALLOW, GEO_RULE_TYPES.BLOCK].includes(normalizedType)) {
    throw new Error('Invalid geo rule type');
  }

  if (!isValidCountryCode(normalizedCountryCode)) {
    throw new Error('Invalid country code');
  }

  await ensureTable();

  const result = await Database.run(
    'DELETE FROM geo_rules WHERE countryCode = ? AND ruleType = ?',
    [normalizedCountryCode, normalizedType]
  );

  invalidateCache();

  return result.changes || 0;
}

module.exports = {
  GEO_RULE_TYPES,
  GEO_RULE_CACHE_TTL_MS,
  _cache,
  addRule,
  ensureTable,
  getCachedRules,
  getRuleSets,
  invalidateCache,
  isValidCountryCode,
  listActiveRules,
  loadRules,
  normalizeCountryCode,
  removeRule,
};
