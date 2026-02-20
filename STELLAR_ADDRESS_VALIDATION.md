# Stellar Address Validation Implementation

## Overview
Implemented comprehensive Stellar address validation to ensure destination addresses are valid before sending XLM transactions.

## Implementation Details

### 1. Validation Utility (`src/utils/stellarValidation.js`)
Created a dedicated validation module that uses the Stellar SDK to validate addresses:

- **validateStellarAddress(address)**: Validates Stellar public keys (addresses)
  - Checks if address is provided and is a string
  - Verifies address starts with 'G' (Stellar public key prefix)
  - Validates length is exactly 56 characters
  - Uses Stellar SDK's `StrKey.isValidEd25519PublicKey()` for checksum validation
  - Returns `{valid: boolean, error?: string}`

- **validateStellarSecretKey(secretKey)**: Validates Stellar secret keys
  - Checks if secret key is provided and is a string
  - Verifies secret key starts with 'S' (Stellar secret key prefix)
  - Validates length is exactly 56 characters
  - Uses Stellar SDK's `StrKey.isValidEd25519SecretSeed()` for checksum validation
  - Returns `{valid: boolean, error?: string}`

### 2. MockStellarService Integration
Updated `src/services/MockStellarService.js` to validate addresses early:

- **sendDonation()**: Validates destination address and source secret key before processing
- **getBalance()**: Validates public key before retrieving balance
- **fundTestnetWallet()**: Validates public key before funding
- **isAccountFunded()**: Validates public key before checking funding status
- **getTransactionHistory()**: Validates public key before retrieving history
- **streamTransactions()**: Validates public key before setting up stream

All methods now use the Stellar SDK's `Keypair.random()` to generate valid addresses with proper checksums.

### 3. StellarService Integration
Updated `src/services/StellarService.js` to include validation stubs:

- Added validation to all methods that accept public keys or secret keys
- Validation occurs before the "not yet implemented" error is thrown
- Ready for real Stellar network implementation

### 4. Donation Route Integration
Updated `src/routes/donation.js` to validate addresses at the API level:

- **POST /donations**: 
  - Validates recipient address (required)
  - Validates donor address (if provided and not "Anonymous")
  - Returns clear error messages with error codes:
    - `INVALID_RECIPIENT_ADDRESS`: When recipient address is invalid
    - `INVALID_DONOR_ADDRESS`: When donor address is invalid

## Error Messages

The validation provides clear, specific error messages:

- "Address is required"
- "Address must be a string"
- "Address cannot be empty"
- "Invalid Stellar address format. Public keys must start with 'G'"
- "Invalid Stellar address length. Expected 56 characters, got X"
- "Invalid Stellar address. Checksum validation failed"
- "Invalid Stellar secret key format. Secret keys must start with 'S'"
- "Invalid Stellar secret key length. Expected 56 characters, got X"
- "Invalid Stellar secret key. Checksum validation failed"

## Testing

### Unit Tests (`tests/stellar-validation.test.js`)
- 14 tests covering all validation scenarios
- Tests for valid addresses, invalid formats, wrong lengths, invalid checksums
- Tests for null, undefined, and empty values
- All tests passing ✓

### Integration Tests (`tests/address-validation-integration.test.js`)
- 13 tests covering validation in MockStellarService
- Tests validation in all service methods
- Tests error handling for various invalid address formats
- Tests successful transactions with valid addresses
- All tests passing ✓

## Acceptance Criteria

✅ **Invalid addresses rejected early**: Validation occurs at multiple layers:
   - API route level (donation.js)
   - Service level (MockStellarService.js, StellarService.js)
   - Before any blockchain operations

✅ **Clear error messages returned**: 
   - Specific error messages for each validation failure
   - Structured error responses with error codes
   - User-friendly messages explaining what's wrong

## Usage Example

```javascript
const { validateStellarAddress } = require('./src/utils/stellarValidation');

// Valid address
const result1 = validateStellarAddress('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H');
// { valid: true }

// Invalid address
const result2 = validateStellarAddress('INVALID');
// { valid: false, error: 'Invalid Stellar address length. Expected 56 characters, got 7' }
```

## API Response Examples

### Valid Request
```bash
POST /api/v1/donations
{
  "amount": "10",
  "recipient": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
}

Response: 201 Created
{
  "success": true,
  "data": { ... }
}
```

### Invalid Recipient Address
```bash
POST /api/v1/donations
{
  "amount": "10",
  "recipient": "INVALID"
}

Response: 400 Bad Request
{
  "success": false,
  "error": {
    "code": "INVALID_RECIPIENT_ADDRESS",
    "message": "Invalid Stellar address length. Expected 56 characters, got 7"
  }
}
```

## Dependencies
- `stellar-sdk`: Used for cryptographic validation of addresses and checksums
