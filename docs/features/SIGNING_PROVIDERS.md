# Stellar Transaction Signing Providers

## Overview

Hardware wallet signing support allows high-security deployments to sign Stellar transactions using Hardware Security Modules (HSMs) or hardware wallets (Ledger, Trezor) instead of storing private keys in software.

## Features

- **SigningProvider Interface**: Pluggable signing architecture
- **Software Provider**: Default in-memory key signing
- **HSM Provider**: PKCS#11 interface for hardware security modules
- **Transaction Separation**: Clean separation of building and signing
- **Provider Configuration**: Environment-based provider selection

## Implementation Status

This feature is in progress. The following components need to be implemented:

1. Define `SigningProvider` interface in `src/services/signing/SigningProvider.js`
2. Implement `SoftwareSigningProvider` (current behavior as default)
3. Implement `HSMSigningProvider` stub with PKCS#11 interface
4. Add `SIGNING_PROVIDER` environment variable
5. Separate transaction building from signing in StellarService
6. Add provider compliance tests

## Architecture

```
┌─────────────────────┐
│  StellarService     │
│  (builds tx)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  SigningProvider    │
│  (interface)        │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐ ┌─────────┐
│Software │ │   HSM   │
│Provider │ │Provider │
└─────────┘ └─────────┘
```

## SigningProvider Interface

```javascript
class SigningProvider {
  /**
   * Sign a Stellar transaction
   * @param {Transaction} transaction - Built Stellar transaction
   * @param {string} publicKey - Signer public key
   * @returns {Promise<Transaction>} Signed transaction
   */
  async sign(transaction, publicKey) {
    throw new Error('Not implemented');
  }

  /**
   * Get public key for a signing identity
   * @param {string} identity - Provider-specific identity
   * @returns {Promise<string>} Stellar public key
   */
  async getPublicKey(identity) {
    throw new Error('Not implemented');
  }
}
```

## Configuration

```bash
# .env
SIGNING_PROVIDER=software  # or 'hsm'

# For HSM provider
HSM_LIBRARY_PATH=/usr/lib/softhsm/libsofthsm2.so
HSM_SLOT_ID=0
HSM_PIN=1234
```

## Usage

```javascript
const { getSigningProvider } = require('./src/services/signing');

// Get configured provider
const provider = getSigningProvider();

// Build transaction
const transaction = new StellarSdk.TransactionBuilder(...)
  .addOperation(...)
  .build();

// Sign with provider
const signedTx = await provider.sign(transaction, publicKey);

// Submit
await server.submitTransaction(signedTx);
```

## Security Considerations

- Keys never leave HSM
- Provider isolation and sandboxing
- Audit logging for all signing operations
- PIN/passphrase protection
- Transaction verification before signing

## Testing Requirements

- SigningProvider interface compliance verified
- SoftwareSigningProvider passes all existing tests
- HSM stub demonstrates integration pattern
- Transaction building/signing separation verified
- Provider switching without code changes
