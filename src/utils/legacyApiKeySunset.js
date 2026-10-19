/**
 * Legacy API Key Sunset
 *
 * RESPONSIBILITY: Decide whether environment-based (legacy) API keys are still accepted.
 * OWNER: Platform Team
 * DEPENDENCIES: none
 *
 * The sunset date defaults to 2026-12-31 and can be overridden with
 * LEGACY_API_KEYS_DISABLED_AFTER (YYYY-MM-DD, UTC). Once the date has passed
 * (inclusive of that whole day), legacy keys are rejected with 401.
 *
 * See docs/MIGRATION_LEGACY_API_KEYS.md for the migration procedure.
 */

const DEFAULT_SUNSET_DATE = '2026-12-31';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the configured sunset date as a YYYY-MM-DD string.
 * Invalid overrides fall back to the default so a typo cannot silently disable enforcement.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string}
 */
function getLegacyKeySunsetDate(env = process.env) {
  const raw = (env.LEGACY_API_KEYS_DISABLED_AFTER || '').trim();
  if (ISO_DATE_PATTERN.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    return raw;
  }
  return DEFAULT_SUNSET_DATE;
}

/**
 * True once the current UTC day is strictly after the sunset date.
 * @param {Date} [now=new Date()]
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {boolean}
 */
function isLegacyKeyDisabled(now = new Date(), env = process.env) {
  const sunsetDay = Date.parse(`${getLegacyKeySunsetDate(env)}T23:59:59.999Z`);
  return now.getTime() > sunsetDay;
}

module.exports = {
  DEFAULT_SUNSET_DATE,
  getLegacyKeySunsetDate,
  isLegacyKeyDisabled,
};
