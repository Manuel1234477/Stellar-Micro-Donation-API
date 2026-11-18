/**
 * SEP-10 Signing Key Resolution
 *
 * RESPONSIBILITY: Choose the single key that signs SEP-10 challenges, so the
 * SIGNING_KEY advertised in /.well-known/stellar.toml always matches the signer.
 * OWNER: Platform Team
 * DEPENDENCIES: none
 *
 * Resolution order:
 *   1. SEP10_SIGNING_KEY — dedicated, unfunded challenge-signing key (recommended)
 *   2. STELLAR_SECRET / SERVICE_SECRET_KEY — legacy fallback to the service account
 *
 * See issue #1888. The legacy fallback keeps existing deployments working; startup
 * checks warn when it is in use.
 */

/**
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ secret: string, dedicated: boolean }} `secret` is '' when no key is configured
 */
function resolveSep10SigningSecret(env = process.env) {
  const dedicated = (env.SEP10_SIGNING_KEY || '').trim();
  if (dedicated) {
    return { secret: dedicated, dedicated: true };
  }

  const legacy = (env.STELLAR_SECRET || env.SERVICE_SECRET_KEY || '').trim();
  return { secret: legacy, dedicated: false };
}

module.exports = { resolveSep10SigningSecret };
