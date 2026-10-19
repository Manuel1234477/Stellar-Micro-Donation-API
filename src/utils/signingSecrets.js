/**
 * Signing Secrets - Resolution of HMAC signing secrets without literal fallbacks
 *
 * RESPONSIBILITY: Provide HMAC secrets for token and export signing (#1872)
 * OWNER: Security Team
 * DEPENDENCIES: crypto, logger
 *
 * In production and staging a missing secret is an error. Anywhere else a random
 * per-process secret is generated (and a warning logged), so no source-code literal
 * can ever be used to forge a signature.
 */

const crypto = require('crypto');
const log = require('./log');

const STRICT_ENVIRONMENTS = ['production', 'staging'];
const generatedSecrets = new Map();

/**
 * @returns {boolean} True when missing secrets must abort instead of being generated
 */
function isStrictEnvironment() {
  return STRICT_ENVIRONMENTS.includes((process.env.NODE_ENV || '').toLowerCase());
}

/**
 * Resolves a signing secret from the first non-empty environment variable.
 * @param {string} name - Logical secret name, used in error and warning messages
 * @param {string[]} envVarNames - Environment variables to consult, in priority order
 * @returns {string} The configured secret, or a per-process random secret outside strict environments
 * @throws {Error} In production or staging when no variable is set
 */
function getSigningSecret(name, envVarNames) {
  for (const envVarName of envVarNames) {
    const value = process.env[envVarName];
    if (value && value.trim()) return value.trim();
  }

  if (isStrictEnvironment()) {
    throw new Error(
      `${name} is not configured. Set one of ${envVarNames.join(', ')} before starting in ${process.env.NODE_ENV}.`
    );
  }

  if (!generatedSecrets.has(name)) {
    generatedSecrets.set(name, crypto.randomBytes(32).toString('hex'));
    log.warn('SIGNING_SECRETS', `${name} not set; using a random per-process secret. Tokens will not survive a restart.`, {
      expectedEnvVars: envVarNames
    });
  }
  return generatedSecrets.get(name);
}

/**
 * Returns the names of required secrets that are missing. Used by startup checks.
 * @param {Array<{ name: string, envVarNames: string[] }>} requirements
 * @returns {string[]} Missing secret names
 */
function findMissingSigningSecrets(requirements) {
  return requirements
    .filter(({ envVarNames }) => !envVarNames.some(envVarName => (process.env[envVarName] || '').trim()))
    .map(({ name }) => name);
}

module.exports = {
  getSigningSecret,
  findMissingSigningSecrets,
  isStrictEnvironment
};
