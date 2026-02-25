# Constants Centralization - Issue #203

## Summary
Centralized all shared constants across the codebase to eliminate magic strings and improve maintainability.

## Changes Made

### 1. Created Centralized Constants File
**File**: `src/constants/index.js`

Contains all shared constants organized by category:
- `RESPONSE_STATUS` - API response status (true/false)
- `DONATION_FREQUENCIES` - Recurring donation frequencies (daily, weekly, monthly)
- `VALID_FREQUENCIES` - Array for validation
- `SCHEDULE_STATUS` - Schedule/subscription statuses (active, paused, cancelled, completed)
- `API_KEY_STATUS` - API key statuses (active, deprecated, revoked)
- `STELLAR_NETWORKS` - Network types (testnet, mainnet, futurenet)
- `VALID_STELLAR_NETWORKS` - Array for validation
- `STATS_PERIODS` - Time periods for statistics
- `HORIZON_URLS` - Default Horizon URLs for each network
- `HTTP_STATUS` - Common HTTP status codes

### 2. Refactored Files

#### Models
- ✅ `src/models/apiKeys.js` - Uses `API_KEY_STATUS`

#### Routes
- ✅ `src/routes/stream.js` - Uses `VALID_FREQUENCIES`, `SCHEDULE_STATUS`

#### Services
- ✅ `src/services/StellarService.js` - Uses `STELLAR_NETWORKS`, `HORIZON_URLS`
- ✅ `src/services/TransactionSyncService.js` - Uses `HORIZON_URLS`
- ✅ `src/services/RecurringDonationScheduler.js` - Uses `SCHEDULE_STATUS`, `DONATION_FREQUENCIES`

#### Configuration
- ✅ `src/config/stellar.js` - Uses `STELLAR_NETWORKS`, `HORIZON_URLS`
- ✅ `src/config/envValidation.js` - Uses `VALID_STELLAR_NETWORKS`

### 3. Constants Eliminated

**Before** (duplicated across files):
```javascript
// In multiple files:
'active', 'deprecated', 'revoked'
'daily', 'weekly', 'monthly'
'testnet', 'mainnet', 'futurenet'
'https://horizon-testnet.stellar.org'
'pending', 'completed', 'failed'
```

**After** (single source of truth):
```javascript
const { 
  API_KEY_STATUS,
  DONATION_FREQUENCIES,
  STELLAR_NETWORKS,
  HORIZON_URLS 
} = require('../constants');
```

## Benefits

1. **Single Source of Truth**: All constants defined in one place
2. **Type Safety**: Object.freeze() prevents accidental modifications
3. **Consistency**: No risk of typos or inconsistent values
4. **Maintainability**: Easy to update values across entire codebase
5. **Discoverability**: Developers can see all available constants in one file
6. **Documentation**: Constants are logically grouped and documented

## Testing

✅ All 439 tests pass
✅ No functional behavior changes
✅ Backward compatible

## Acceptance Criteria

✅ No duplicated magic strings remain (for covered constants)
✅ No functional behavior changes
✅ Constants are logically grouped and documented

## Future Improvements

Additional constants that could be centralized:
- Response message templates
- Error messages
- Log scopes
- Database table names
- Environment variable names

## Usage Example

```javascript
// Before
if (status === 'active') {
  // ...
}

// After
const { SCHEDULE_STATUS } = require('../constants');
if (status === SCHEDULE_STATUS.ACTIVE) {
  // ...
}
```

## Files Changed

- **Created**: 1 file (`src/constants/index.js`)
- **Modified**: 7 files
  - `src/models/apiKeys.js`
  - `src/routes/stream.js`
  - `src/services/StellarService.js`
  - `src/services/TransactionSyncService.js`
  - `src/services/RecurringDonationScheduler.js`
  - `src/config/stellar.js`
  - `src/config/envValidation.js`
