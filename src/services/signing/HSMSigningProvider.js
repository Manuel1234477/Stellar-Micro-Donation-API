/**
 * HSM Signing Provider
 *
 * IMPORTANT: This provider is NOT yet implemented (PKCS#11 integration pending).
 * Selecting it will throw a HsmNotImplementedError at startup so operators
 * receive an explicit failure instead of a silent fallback to software signing.
 *
 * There is NO automatic fallback to software signing. Any fallback must be an
 * explicit, separately-configured opt-in.
 *
 * PKCS#11 implementation checklist (for the future implementer):
 *   [ ] Load PKCS#11 library via HSM_LIBRARY_PATH
 *   [ ] Open session with HSM_SLOT_ID + HSM_PIN
 *   [ ] Locate signing key by HSM_KEY_IDENTIFIER
 *   [ ] Sign the Stellar transaction hash (CKM_ECDSA)
 *   [ ] Assert private key is non-extractable (CKA_EXTRACTABLE = false)
 *   [ ] Handle CKR_SESSION_HANDLE_INVALID / token disconnect — re-open session
 *   [ ] Serialise concurrent sign requests (one session per slot)
 *   [ ] Verify produced signature against Stellar SDK before returning
 *   [ ] Implement health check as a real test-sign or session ping
 */

'use strict';

const SigningProvider = require('./SigningProvider');

class HsmNotImplementedError extends Error {
  constructor() {
    super(
      'HSM signing provider is not yet implemented. ' +
      'Configure SIGNING_PROVIDER=software to use software signing, ' +
      'or implement the PKCS#11 integration before enabling HSM in production.'
    );
    this.name = 'HsmNotImplementedError';
    this.code = 'HSM_NOT_IMPLEMENTED';
  }
}

class HSMSigningProvider extends SigningProvider {
  constructor(config = {}) {
    super();
    // Fail immediately at construction time so the error surfaces at startup,
    // not at the moment a payment is being signed.
    throw new HsmNotImplementedError();
  }

  // The methods below are never reached; they exist for documentation only.

  async sign(_transaction, _keyIdentifier) {
    throw new HsmNotImplementedError();
  }

  async getPublicKey(_keyIdentifier) {
    throw new HsmNotImplementedError();
  }

  async healthCheck() {
    return false;
  }
}

module.exports = HSMSigningProvider;
module.exports.HsmNotImplementedError = HsmNotImplementedError;
