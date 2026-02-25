# Naming Conventions

This document defines the standardized naming conventions for the Stellar Micro-Donation API codebase.

## File Naming Conventions

### Services (`src/services/`)
- **Convention**: PascalCase
- **Examples**: 
  - `StellarService.js`
  - `MockStellarService.js`
  - `IdempotencyService.js`
  - `RecurringDonationScheduler.js`

### Models (`src/models/`, `src/routes/models/`)
- **Convention**: camelCase for multi-word, lowercase for single word
- **Examples**:
  - `apiKeys.js`
  - `permissions.js`
  - `transaction.js`
  - `wallet.js`
  - `user.js`

### Routes (`src/routes/`)
- **Convention**: lowercase or kebab-case for multi-word
- **Examples**:
  - `donation.js`
  - `wallet.js`
  - `stream.js`
  - `stats.js`
  - `transaction.js`
  - `app.js`

### Middleware (`src/middleware/`)
- **Convention**: camelCase, **without** "Middleware" suffix
- **Examples**:
  - `apiKey.js` (not `apiKeyMiddleware.js`)
  - `rbac.js` (not `rbacMiddleware.js`)
  - `idempotency.js` (not `idempotencyMiddleware.js`)
  - `errorHandler.js`
  - `rateLimiter.js`
  - `logger.js`
  - `validation.js`

### Utilities (`src/utils/`)
- **Convention**: camelCase for multi-word, lowercase for single word
- **Examples**:
  - `feeCalculator.js`
  - `abuseDetector.js`
  - `memoValidator.js`
  - `donationValidator.js`
  - `stellarErrorHandler.js`
  - `transactionStateMachine.js`
  - `log.js`
  - `errors.js`
  - `database.js`
  - `permissions.js`
  - `validators.js`
  - `sanitizer.js`
  - `encryption.js`

### Scripts (`src/scripts/`)
- **Convention**: camelCase
- **Examples**:
  - `initDB.js`
  - `manageApiKeys.js`
  - `addMemoColumn.js`
  - `addRecurringDonationsTable.js`
  - `addIdempotencyTable.js`

### Configuration (`src/config/`)
- **Convention**: camelCase or lowercase
- **Examples**:
  - `stellar.js`
  - `envValidation.js`
  - `roles.json`

## Code Naming Conventions

### Variables
- **Convention**: camelCase
- **Examples**: `stellarService`, `donationValidator`, `transactionHash`

### Constants
- **Convention**: UPPER_SNAKE_CASE
- **Examples**: `MAX_RETRIES`, `DEFAULT_FEE_PERCENTAGE`, `ERROR_CODES`

### Functions
- **Convention**: camelCase
- **Examples**: `createWallet()`, `validateAmount()`, `sendDonation()`

### Classes
- **Convention**: PascalCase
- **Examples**: `StellarService`, `DonationValidator`, `AbuseDetector`

### Private Methods/Properties
- **Convention**: camelCase with leading underscore
- **Examples**: `_validateAmount()`, `_executeWithRetry()`, `_isRetryableError()`

## Changes Applied (Issue #204)

### Middleware Files Renamed
The following middleware files were renamed to remove the redundant "Middleware" suffix:

1. `src/middleware/apiKeyMiddleware.js` → `src/middleware/apiKey.js`
2. `src/middleware/rbacMiddleware.js` → `src/middleware/rbac.js`
3. `src/middleware/idempotencyMiddleware.js` → `src/middleware/idempotency.js`

### Import Statements Updated
All import statements across the codebase were updated to reflect the new file names:

**Source Files Updated:**
- `src/routes/app.js`
- `src/routes/donation.js`
- `src/routes/wallet.js`
- `src/routes/stream.js`
- `src/routes/stats.js`
- `src/routes/transaction.js`
- `src/routes/apiKeys.js`

**Test Files Updated:**
- `tests/rbac-middleware.test.js`
- `tests/donation-routes-integration.test.js`
- `tests/sanitization-integration.test.js`

### Verification
All tests pass after the refactoring:
- ✅ RBAC middleware tests
- ✅ Sanitization integration tests
- ✅ No breaking changes introduced

## Benefits

1. **Consistency**: All middleware files follow the same naming pattern
2. **Clarity**: File names are concise and descriptive without redundancy
3. **Maintainability**: Easier for contributors to understand and follow conventions
4. **Readability**: Import statements are cleaner and more intuitive

## Future Considerations

If additional naming inconsistencies are discovered, they should be addressed following these conventions. All new files should adhere to these standards from the start.
