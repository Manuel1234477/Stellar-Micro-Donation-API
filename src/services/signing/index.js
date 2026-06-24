'use strict';

const SoftwareSigningProvider = require('./SoftwareSigningProvider');
const log = require('../../utils/log');

/**
 * Return the configured signing provider.
 * SIGNING_PROVIDER env var: 'software' (default) | 'hsm'
 *
 * If 'hsm' is configured, HSMSigningProvider constructor throws HsmNotImplementedError
 * immediately so the process fails at startup rather than silently at payment time.
 * There is NO automatic fallback to software signing for HSM — that would destroy
 * the key-custody guarantee. Any fallback must be an explicit opt-in.
 */
function getSigningProvider() {
  const providerType = (process.env.SIGNING_PROVIDER || 'software').toLowerCase();

  if (providerType === 'software') {
    log.info('SIGNING', 'Using software signing provider');
    return new SoftwareSigningProvider();
  }

  if (providerType === 'hsm') {
    // Intentionally NOT wrapped in try/catch — the HsmNotImplementedError must
    // propagate to the caller so startup fails loudly.
    const HSMSigningProvider = require('./HSMSigningProvider');
    log.info('SIGNING', 'Initialising HSM signing provider');
    return new HSMSigningProvider();
  }

  // Unknown provider — fail loudly; do not silently degrade.
  throw new Error(
    `Unknown SIGNING_PROVIDER value: "${providerType}". ` +
    'Valid values: "software", "hsm".'
  );
}

module.exports = {
  getSigningProvider,
  SoftwareSigningProvider,
  get HSMSigningProvider() { return require('./HSMSigningProvider'); },
};
