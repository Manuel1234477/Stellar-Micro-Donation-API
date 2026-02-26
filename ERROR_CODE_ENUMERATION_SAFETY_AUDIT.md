# Error Code Enumeration Safety Audit

## Issue Summary
Review error codes for enumeration safety to ensure they don't leak internal structure or allow inference attacks.

## Audit Findings

### 1. Error Code Structure Issues

**Current State:**
- ERROR_CODES defined as simple strings (e.g., `VALIDATION_ERROR: 'VALIDATION_ERROR'`)
- Tests expect structured objects with numeric codes
- Mismatch between implementation and tests

**Security Concerns:**
- String-only error codes can reveal internal categorization
- No stable numeric codes for API consumers
- Inconsistent error code structure across the codebase

### 2. Information Leakage Vectors

#### High Priority:
1. **Stellar Error Handler** (`src/utils/stellarErrorHandler.js`)
   - Exposes detailed Stellar SDK error messages
   - Reveals network topology (ENOTFOUND, ECONNREFUSED)
   - Leaks internal error patterns

2. **Validation Middleware** (`src/middleware/validation.js`)
   - Returns `allowedFields` array in error responses
   - Enables field enumeration attacks
   - Exposes internal field schemas

3. **Error Details in Responses**
   - Some errors include `details` object with sensitive info
   - Database error messages may leak schema information
   - File paths and internal structure in stack traces

#### Medium Priority:
4. **Validator Error Messages**
   - Donation validator exposes min/max amounts
   - Memo validator reveals byte length constraints
   - Amount validator shows precision limits

5. **Rate Limit Errors**
   - Exposes exact rate limit values
   - Reveals reset timestamps
   - Could enable timing attacks

### 3. Inconsistent Error Codes

**Missing from ERROR_CODES constant:**
- RATE_LIMIT_EXCEEDED
- MISSING_API_KEY
- INVALID_API_KEY
- MISSING_FIELD
- UNKNOWN_FIELDS
- INVALID_STELLAR_ADDRESS
- INVALID_TRANSACTION_HASH
- INVALID_DATE_RANGE
- INVALID_PAGINATION
- MISSING_PUBLIC_KEY
- NETWORK_ERROR
- NETWORK_TIMEOUT
- ACCOUNT_NOT_FUNDED
- INVALID_DESTINATION
- INVALID_CREDENTIALS
- STELLAR_ERROR
- INVALID_MEMO_TYPE
- MEMO_TOO_LONG
- INVALID_MEMO_CONTENT
- INVALID_MEMO_FORMAT
- INVALID_AMOUNT_TYPE
- INVALID_AMOUNT_PRECISION
- AMOUNT_TOO_LOW
- AMOUNT_BELOW_MINIMUM
- AMOUNT_EXCEEDS_MAXIMUM
- DAILY_LIMIT_EXCEEDED

## Recommended Changes

### 1. Implement Structured Error Codes with Numeric IDs

```javascript
const ERROR_CODES = {
  // Validation errors (1000-1099)
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', numeric: 1000 },
  INVALID_REQUEST: { code: 'INVALID_REQUEST', numeric: 1001 },
  // ... etc
};
```

**Numeric Code Ranges:**
- 1000-1099: Validation errors
- 2000-2099: Authentication/Authorization errors
- 3000-3099: Not found errors
- 4000-4099: Conflict/Duplicate errors
- 5000-5099: Business logic errors
- 6000-6099: Rate limiting errors
- 7000-7099: Stellar/Blockchain errors
- 8000-8099: Network/Infrastructure errors
- 9000-9099: Internal server errors

### 2. Normalize Error Messages

**Principles:**
- Generic messages in production
- No internal structure details
- No field enumeration
- No constraint values
- Consistent format

**Example:**
```javascript
// Before (leaks info)
{ code: 'UNKNOWN_FIELDS', unknownFields: ['hacker'], allowedFields: ['amount', 'donor'] }

// After (safe)
{ code: 'VALIDATION_ERROR', message: 'Invalid request format' }
```

### 3. Sanitize Stellar Errors

- Map all Stellar errors to generic codes
- Remove network topology details
- Hide infrastructure information
- Use generic "service unavailable" messages

### 4. Remove Sensitive Details

- No `allowedFields` in production
- No constraint values (min/max amounts)
- No rate limit values
- No internal timestamps
- No database error details

## Implementation Tasks

1. ✅ Update ERROR_CODES to structured format with numeric codes
2. ✅ Add missing error codes to central registry
3. ✅ Update error handler to sanitize messages in production
4. ✅ Remove allowedFields from validation errors
5. ✅ Sanitize Stellar error messages
6. ✅ Update validator error responses
7. ✅ Update rate limit error responses
8. ✅ Update tests to match new structure
9. ✅ Update documentation

## Acceptance Criteria

- ✅ All error codes have numeric IDs
- ✅ No internal structure leaked in error messages
- ✅ No field enumeration possible
- ✅ Stellar errors properly sanitized
- ✅ All tests passing
- ✅ Documentation updated
- ✅ Production error messages are generic
- ✅ Development error messages remain detailed for debugging
