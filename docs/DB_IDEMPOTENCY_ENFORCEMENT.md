# Database-Level Idempotency Enforcement

## Overview

This implementation adds database-level constraints to prevent duplicate donations, ensuring idempotency is enforced structurally rather than just logically.

## Implementation

### 1. Database Schema Changes

**Added to `transactions` table:**
- `idempotencyKey TEXT UNIQUE` - Ensures no duplicate donations can be persisted
- Index on `idempotencyKey` for fast lookups

**Migration:**
```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  senderId INTEGER NOT NULL,
  receiverId INTEGER NOT NULL,
  amount REAL NOT NULL,
  memo TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  idempotencyKey TEXT UNIQUE,  -- NEW: Enforces uniqueness at DB level
  FOREIGN KEY (senderId) REFERENCES users(id),
  FOREIGN KEY (receiverId) REFERENCES users(id)
);

CREATE INDEX idx_transactions_idempotency ON transactions(idempotencyKey);
```

### 2. Error Handling

**New Error Class:**
```javascript
class DuplicateError extends AppError {
  constructor(message = 'Duplicate entry detected', code = ERROR_CODES.DUPLICATE_DONATION) {
    super(code, message, 409);
  }
}
```

**Database Utility Enhancement:**
```javascript
static isUniqueConstraintError(err) {
  return err && err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE');
}
```

All database operations now detect UNIQUE constraint violations and throw `DuplicateError` with HTTP 409 status.

### 3. API Response on Conflict

**Success (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "stellarTxId": "abc123...",
    "amount": 50.0,
    "timestamp": "2024-02-25T10:00:00.000Z"
  }
}
```

**Duplicate Detected (409 Conflict):**
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_DONATION",
    "message": "Duplicate donation detected - this transaction has already been processed",
    "timestamp": "2024-02-25T10:00:01.000Z"
  }
}
```

## Idempotency Strategy

### Key Generation
- Client provides `Idempotency-Key` header (UUID recommended)
- Key is validated and stored with the transaction
- Same key = same transaction (idempotent)

### Enforcement Layers

**Layer 1: Application Logic (Existing)**
- Middleware checks for existing idempotency key
- Returns cached response if found
- Prevents duplicate processing

**Layer 2: Database Constraint (NEW)**
- UNIQUE constraint on `idempotencyKey` column
- Prevents duplicate persistence even if logic fails
- Last line of defense against race conditions

### Race Condition Protection

**Scenario:** Two identical requests arrive simultaneously

```
Request A ──┐
            ├──> Middleware (both pass) ──┐
Request B ──┘                             │
                                          ▼
                                    Database INSERT
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
                Request A: SUCCESS                  Request B: DUPLICATE
                (201 Created)                       (409 Conflict)
```

The database UNIQUE constraint ensures only one succeeds.

## Files Modified

### Database Schema
- ✅ `src/scripts/initDB.js` - Added idempotencyKey column with UNIQUE constraint
- ✅ `src/scripts/migrations/001_add_idempotency_constraint.js` - Migration for existing databases

### Error Handling
- ✅ `src/utils/errors.js` - Added `DuplicateError` class and `DUPLICATE_DONATION` code
- ✅ `src/utils/database.js` - Added UNIQUE constraint detection and error mapping

### API Routes
- ✅ `src/routes/donation.js` - Added idempotencyKey to INSERT, added conflict handling

### Middleware
- ✅ `src/middleware/errorHandler.js` - Already handles AppError (includes DuplicateError)

## Testing

### Manual Testing

**1. Create a donation:**
```bash
curl -X POST http://localhost:3000/donations/send \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "senderId": 1,
    "receiverId": 2,
    "amount": 50.0,
    "memo": "Test donation"
  }'
```

**Expected:** 201 Created

**2. Retry with same key:**
```bash
# Same request, same idempotency key
curl -X POST http://localhost:3000/donations/send \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-123" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "senderId": 1,
    "receiverId": 2,
    "amount": 50.0,
    "memo": "Test donation"
  }'
```

**Expected:** 409 Conflict with DUPLICATE_DONATION error

### Automated Testing

Run existing test suite:
```bash
npm test
```

All idempotency tests should pass with the new database-level enforcement.

## Migration Guide

### For New Installations
1. Run `npm run init-db` - Schema includes idempotency constraint

### For Existing Databases
1. Run migration:
   ```bash
   node src/scripts/migrations/001_add_idempotency_constraint.js
   ```
2. Verify:
   ```bash
   sqlite3 data/stellar_donations.db "PRAGMA table_info(transactions);"
   ```
3. Confirm `idempotencyKey` column exists with UNIQUE constraint

## Benefits

### 1. Data Integrity
- ✅ Impossible to persist duplicate donations
- ✅ Database enforces uniqueness regardless of application logic
- ✅ Protection against race conditions

### 2. Reliability
- ✅ Multiple layers of protection (middleware + database)
- ✅ Graceful error handling with clear messages
- ✅ Consistent behavior across all donation endpoints

### 3. Performance
- ✅ Index on idempotencyKey for fast lookups
- ✅ Database-level check is faster than application logic
- ✅ No additional network calls

### 4. Safety
- ✅ No breaking changes to API
- ✅ Backward compatible (idempotencyKey is optional for old records)
- ✅ Clear error responses guide clients

## Acceptance Criteria

✅ **Duplicate donations cannot be persisted**
- UNIQUE constraint on idempotencyKey prevents duplicates at database level
- Tested with concurrent requests

✅ **API responds safely on conflict**
- Returns 409 Conflict with clear error message
- Includes error code DUPLICATE_DONATION
- No data corruption or crashes

✅ **Idempotency key strategy designed**
- Client-provided UUID in Idempotency-Key header
- Stored with transaction
- Enforced at both application and database levels

✅ **Unique constraints added**
- idempotencyKey column with UNIQUE constraint
- Index for performance
- Migration script for existing databases

✅ **Conflict errors handled gracefully**
- DuplicateError class for type-safe handling
- Automatic detection in Database utility
- Consistent error responses across all endpoints

## Security Considerations

- Idempotency keys are not sensitive data (UUIDs)
- No PII stored in idempotency keys
- Keys expire with idempotency cache (24 hours default)
- Database constraint prevents timing attacks on duplicate detection

## Performance Impact

- **Minimal overhead**: Index lookup is O(log n)
- **Faster duplicate detection**: Database check vs application logic
- **No additional queries**: Constraint checked during INSERT
- **Improved throughput**: Prevents unnecessary processing of duplicates
