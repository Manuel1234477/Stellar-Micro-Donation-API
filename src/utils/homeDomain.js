const { ValidationError } = require('./errors');

const HOME_DOMAIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function validateHomeDomain(homeDomain, { allowEmpty = false } = {}) {
  if (typeof homeDomain !== 'string' || (!allowEmpty && homeDomain.length === 0)) {
    throw new ValidationError('homeDomain must be a non-empty string');
  }

  if (Buffer.byteLength(homeDomain, 'utf8') > 32) {
    throw new ValidationError('homeDomain must be 32 bytes or fewer per Stellar spec');
  }

  if (homeDomain.length > 0 && !HOME_DOMAIN_PATTERN.test(homeDomain)) {
    throw new ValidationError('homeDomain must be a valid hostname with no protocol or path');
  }

  return homeDomain;
}

module.exports = { validateHomeDomain };
