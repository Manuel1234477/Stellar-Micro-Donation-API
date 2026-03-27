/**
 * Signing Provider Factory
 * 
 * RESPONSIBILITY: Create and configure signing providers
 * OWNER: Security Team
 */

const SoftwareSigningProvider = require('./SoftwareSigningProvider');
const HSMSigningProvider = require('./HSMSigningProvider');
const log = require('../../utils/log');

/**
 * Get the configured signing provider based on environment
 * @returns {SigningProvider} Configured signing provider instance
 */
function getSigningProvider() {
  const providerType = process.env.SIGNING_PROVIDER || 'software';
  
  switch (providerType.toLowerCase()) {
    case 'software':
      log.info('SIGNING', 'Using software signing provider');
      return new SoftwareSigningProvider();
      
    case 'hsm':
      log.info('SIGNING', 'Using HSM signing provider');
      return new HSMSigningProvider();
      
    default:
      log.warn('SIGNING', `Unknown provider type: ${providerType}, falling back to software`);
      return new SoftwareSigningProvider();
  }
}

module.exports = {
  getSigningProvider,
  SoftwareSigningProvider,
  HSMSigningProvider,
};
