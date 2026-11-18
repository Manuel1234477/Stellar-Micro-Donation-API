# TypeScript Type Checking for JavaScript

This document describes how to enable and use TypeScript type checking for JavaScript files without a full TypeScript rewrite.

## Overview

The project uses TypeScript's `checkJs` mode to provide type safety for JavaScript code through JSDoc annotations. This approach:

- **No language change**: JavaScript files remain unchanged; type info lives in JSDoc comments
- **Opt-in**: Gradual adoption — add types where most valuable
- **IDE support**: Full IntelliSense and type error detection in VS Code and other IDEs
- **CI integration**: Type checking runs in the CI pipeline to catch errors early
- **Zero runtime cost**: Types are stripped during compilation (JSDoc only)

## Configuration

### TypeScript Configuration

**File**: `tsconfig.json`

Key settings:
- `"checkJs": false` — Require per-file opt-in for JavaScript checking
- `// @ts-check` — Enable strict checking for an individual JavaScript file
- `"strict": true` — Strict mode for maximum safety
- `"noEmit": true` — Don't transpile, only check types
- `"skipLibCheck": true` — Skip third-party type checking (faster)

The initial checked slice is `src/utils/money.js` and
`src/utils/feeCalculator.js`. Shared Express request metadata is declared in
`src/types.d.ts`.

## Running Type Checks

### Local Development

Check opted-in types before committing:

```bash
npm run typecheck
```

Only files marked with `// @ts-check` participate in JavaScript semantic checking.
TypeScript still parses included source files, so syntax errors anywhere in `src/`
must be fixed before this command can succeed.

Example diagnostics:
```
src/services/DonationService.js(234,26): error TS2322: Type 'undefined' is not assignable to type 'string'.
src/utils/validators.js(45,8): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
```

### In CI Pipeline

Type checking runs automatically as part of CI (to be integrated into your CI workflow):

```bash
npm run typecheck
```

Failures block PR merge if branch protection is enabled.

## JSDoc Annotation Patterns

### Function Parameters and Returns

```javascript
/**
 * Create a donation record in the database.
 *
 * @param {Object} params - Donation parameters
 * @param {string} params.donorPublicKey - Stellar public key of donor (G...)
 * @param {string} params.recipientPublicKey - Stellar public key of recipient
 * @param {number} params.amountXlm - Amount in XLM (e.g., 10.5)
 * @param {string} [params.memo] - Optional transaction memo
 * @param {string} [params.idempotencyKey] - Optional idempotency key
 * @returns {Promise<{id: number, transactionHash: string}>} Created donation record
 * @throws {ValidationError} When inputs are invalid
 * @throws {BusinessLogicError} When donation exceeds limits
 */
async createDonation({ donorPublicKey, recipientPublicKey, amountXlm, memo, idempotencyKey }) {
  // Implementation
}
```

### Object Type Definitions

```javascript
/**
 * @typedef {Object} DonationRecord
 * @property {number} id - Unique donation identifier
 * @property {string} donorPublicKey - Donor's Stellar public key
 * @property {string} recipientPublicKey - Recipient's Stellar public key
 * @property {number} amountXlm - Amount in XLM
 * @property {string} [memo] - Optional memo
 * @property {'pending'|'completed'|'failed'} status - Donation status
 * @property {string} transactionHash - Stellar transaction hash (64 hex chars)
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} [verifiedAt] - Verification timestamp
 */

/**
 * Retrieve a donation by ID.
 *
 * @param {number} donationId - Donation identifier
 * @returns {Promise<DonationRecord|null>} Donation record or null if not found
 */
async getDonationById(donationId) {
  // Implementation
}
```

### Async/Promise Types

```javascript
/**
 * List all donations with pagination.
 *
 * @param {Object} options - Query options
 * @param {number} [options.limit=50] - Max results
 * @param {number} [options.offset=0] - Pagination offset
 * @returns {Promise<{total: number, donations: DonationRecord[]}>} Paginated results
 */
async listDonations({ limit = 50, offset = 0 }) {
  // Implementation
}
```

### Union and Literal Types

```javascript
/**
 * Verify a donation on the blockchain.
 *
 * @param {string} transactionHash - Stellar transaction hash
 * @param {Object} [options] - Verification options
 * @param {number} [options.maxRetries=5] - Max retry attempts
 * @param {boolean} [options.throwOnNotFound=true] - Throw if not found vs return null
 * @returns {Promise<{status: 'success'|'failed'|'pending', confirmations: number}>}
 */
async verifyDonation(transactionHash, options = {}) {
  // Implementation
}
```

### Optional and Nullable Types

```javascript
/**
 * Update donation memo (if allowed).
 *
 * @param {number} donationId - Donation identifier
 * @param {string|null} newMemo - New memo (null to clear)
 * @returns {Promise<void>}
 * @throws {ValidationError} If memo is invalid
 * @throws {NotFoundError} If donation not found
 */
async updateDonationMemo(donationId, newMemo) {
  // Implementation
}
```

### Class Types

```javascript
/**
 * Get or create a Stellar wallet service.
 *
 * @param {string} publicKey - Stellar public key
 * @returns {WalletService} Wallet service instance
 */
getWalletService(publicKey) {
  // Implementation
}
```

## Core Service Type Definitions

### DonationService

```javascript
/**
 * @typedef {Object} CreateDonationParams
 * @property {string} donorPublicKey - Donor's Stellar public key
 * @property {string} recipientPublicKey - Recipient's Stellar public key
 * @property {number} amountXlm - Amount in XLM (validated by rules)
 * @property {string} [memo] - Optional transaction memo
 * @property {string} [idempotencyKey] - Optional idempotency key
 * @property {string} [asset] - Optional asset specification (default: XLM)
 */

/**
 * @typedef {Object} DonationRecord
 * @property {number} id - Database record ID
 * @property {string} donorPublicKey - Donor Stellar address
 * @property {string} recipientPublicKey - Recipient Stellar address
 * @property {number} amountXlm - Amount in XLM
 * @property {string} [memo] - Optional memo
 * @property {string} transactionHash - Stellar transaction hash
 * @property {'pending'|'completed'|'failed'|'cancelled'} status - Current status
 * @property {Date} createdAt - Creation timestamp
 * @property {Date|null} verifiedAt - Verification timestamp
 */
```

**Key Public Methods to Document**:
- `createDonation(params)` — Create and submit a donation
- `verifyDonation(transactionHash)` — Verify a donation on blockchain
- `getDonationById(id)` — Retrieve a single donation
- `listDonations(options)` — List donations with pagination
- `updateDonationStatus(id, status)` — Update donation status

### WalletService

```javascript
/**
 * @typedef {Object} WalletMetadata
 * @property {string} publicKey - Stellar public key (immutable)
 * @property {string} [label] — Friendly name
 * @property {string} [description] - Notes about the wallet
 * @property {boolean} [isCustodial] - Whether API holds private key
 * @property {string[]} [tags] - Labels for organization
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */

/**
 * @typedef {Object} WalletBalance
 * @property {string} publicKey - Wallet's Stellar public key
 * @property {number} balanceXlm - XLM balance
 * @property {string[]} trustlines - List of trusted asset codes
 * @property {Date} queriedAt - When balance was fetched
 * @property {boolean} isFunded - Whether account has minimum reserve
 */
```

**Key Public Methods to Document**:
- `createWallet(publicKey, metadata)` — Register a wallet
- `getWallet(publicKey)` — Retrieve wallet metadata
- `updateWallet(publicKey, updates)` — Update wallet metadata
- `getBalance(publicKey)` — Query current balance on Stellar
- `getTransactionHistory(publicKey, options)` — List transactions for a wallet

### StatsService

```javascript
/**
 * @typedef {Object} DailyStat
 * @property {Date} date - Date in UTC
 * @property {number} donationCount - Number of donations that day
 * @property {number} totalAmount - Total XLM donated
 * @property {number} uniqueDonors - Count of unique donors
 * @property {number} uniqueRecipients - Count of unique recipients
 * @property {number} averageAmount - Mean donation amount
 * @property {number} medianAmount - Median donation amount
 */

/**
 * @typedef {Object} StatsAggregate
 * @property {Date} from - Start of period
 * @property {Date} to - End of period
 * @property {number} totalDonations - Sum of all donations
 * @property {number} totalAmount - Total XLM
 * @property {number} donorCount - Unique donors in period
 * @property {number} recipientCount - Unique recipients in period
 * @property {number} averageDonation - Mean donation amount
 * @property {DailyStat[]} daily - Daily breakdown
 */
```

**Key Public Methods to Document**:
- `getDailyStats(date)` — Get stats for a single day
- `getWeeklyStats(startDate)` — Get stats for a week
- `getMonthlyStats(year, month)` — Get stats for a month
- `getSummary(options)` — Get overall summary statistics
- `getDonorStats(publicKey)` — Get statistics for a specific donor

## Type Checking Best Practices

### 1. Nullable Values

Mark optional values explicitly:

```javascript
/**
 * @param {string|null} memoField - Memo field (null if not provided)
 * @returns {string|null} - Normalized memo or null
 */
function normalizeMemo(memoField) {
  if (memoField === null) return null;
  // ...
}
```

### 2. Strict Parameter Validation

Specify exact types for parameters to catch misuse:

```javascript
/**
 * WRONG: Too permissive
 * @param {*} amount - Amount to donate
 * 
 * CORRECT: Explicit type
 * @param {number} amount - Amount in XLM
 */
```

### 3. Promise Resolution Types

Always specify what the Promise resolves to:

```javascript
/**
 * WRONG: Missing return type
 * @returns {Promise} Result of operation
 * 
 * CORRECT: Specify resolved value
 * @returns {Promise<{success: boolean, id: number}>}
 */
```

### 4. Error Documentation

Document all errors a function can throw:

```javascript
/**
 * Update a donation memo.
 *
 * @param {number} donationId - Donation ID
 * @param {string} newMemo - New memo
 * @throws {NotFoundError} Donation not found
 * @throws {ValidationError} Memo format invalid
 * @throws {BusinessLogicError} Memo can't be changed (already verified)
 */
async updateDonationMemo(donationId, newMemo) {
  // Implementation
}
```

## IDE Integration

### VS Code

Type checking works automatically with VS Code's built-in TypeScript support:

1. Open a `.js` file
2. Hover over variables to see inferred types
3. `Cmd+K Cmd+I` (Mac) or `Ctrl+K Ctrl+I` (Windows) to view type information
4. `Cmd+Shift+M` (Mac) or `Ctrl+Shift+M` (Windows) to show all diagnostics in file

**Settings** (`.vscode/settings.json`):
```json
{
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll.eslint": true
    }
  }
}
```

### WebStorm / IntelliJ

- Automatically recognizes JSDoc type annotations
- Settings → Languages & Frameworks → JavaScript → Code Assistance → Enable type inference

## Gradual Adoption Strategy

### Phase 1: Core Services
Start with highest-impact services:
1. DonationService (core business logic)
2. WalletService (frequent user interactions)
3. StatsService (data correctness critical)
4. StellarService (external API integration)

### Phase 2: Utilities
Add types to utility libraries:
1. Validators (catch validation errors early)
2. Database queries (type-safe queries)
3. Formatters (ensure output shapes)

### Phase 3: Controllers
Add types to HTTP request handlers:
1. Check request parameter types
2. Verify response shapes
3. Catch missing fields in JSON

## Running Type Checks in CI

Add to your CI pipeline (e.g., `.github/workflows/ci.yml`):

```yaml
- name: Type checking
  run: npm run typecheck
  
- name: Report type errors
  if: failure()
  run: npm run typecheck 2>&1 | tee typecheck-results.txt
```

## Common Type Check Errors and Fixes

### Error: "Type 'undefined' is not assignable to type 'string'"

**Problem**: Function expects string but might receive undefined

```javascript
// WRONG
/**
 * @param {string} email - User email
 */
function sendEmail(email) {
  // email could be undefined
}

// CORRECT
/**
 * @param {string|undefined} email - User email (optional)
 */
function sendEmail(email) {
  // Type checker knows email could be undefined
}
```

### Error: "Property 'id' does not exist on type 'Object'"

**Problem**: Object shape not defined

```javascript
// WRONG
/**
 * @param {Object} donation - Donation object
 */
function processDonation(donation) {
  console.log(donation.id); // Error: 'id' is unknown
}

// CORRECT
/**
 * @typedef {Object} Donation
 * @property {number} id - Donation ID
 * 
 * @param {Donation} donation - Donation object
 */
function processDonation(donation) {
  console.log(donation.id); // OK: 'id' is known
}
```

### Error: "No overload matches this call"

**Problem**: Function called with wrong parameter types

```javascript
// WRONG
/**
 * @param {number} amount - Amount in XLM
 */
function validateAmount(amount) {
  // amount is a number
}

validateAmount("10.5"); // Error: passing string, expecting number

// CORRECT
validateAmount(10.5); // OK: passing number
```

## Resources

- [TypeScript JSDoc Reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
- [VS Code JavaScript Type Checking](https://code.visualstudio.com/docs/nodejs/working-with-javascript#_type-checking)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)

## See Also

- [Contributing Guide](./CONTRIBUTING.md) — Add types when submitting PRs
- [Development Guide](./DEVELOPER_TROUBLESHOOTING_GUIDE.md) — Troubleshooting type errors
