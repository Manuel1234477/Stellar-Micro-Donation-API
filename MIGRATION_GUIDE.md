# Error Handling Migration Guide

## Overview

This guide helps you migrate existing routes and services to use the unified error handling system.

## Quick Start

### 1. Import Error Classes

Add this to the top of your route or service file:

```javascript
const { 
  ValidationError, 
  NotFoundError, 
  UnauthorizedError,
  ForbiddenError,
  BusinessLogicError,
  InternalError,
  ERROR_CODES 
} = require('../utils/errors');
```

### 2. Update Route Handlers

Change from manual error responses to throwing error classes:

#### Before:
```javascript
router.get('/:id', async (req, res) => {
  try {
    const item = await getItem(req.params.id);
    
    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }
    
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get item',
      message: error.message
    });
  }
});
```

#### After:
```javascript
router.get('/:id', async (req, res, next) => {
  try {
    const item = await getItem(req.params.id);
    
    if (!item) {
      throw new NotFoundError('Item not found', ERROR_CODES.NOT_FOUND);
    }
    
    res.json({ success: true, data: item });
  } catch (error) {
    next(error); // Pass to global error handler
  }
});
```

### 3. Update Services

Services should throw error classes instead of generic Error objects:

#### Before:
```javascript
async getWallet(publicKey) {
  const wallet = this.wallets.get(publicKey);
  
  if (!wallet) {
    throw new Error(`Wallet not found: ${publicKey}`);
  }
  
  return wallet;
}
```

#### After:
```javascript
async getWallet(publicKey) {
  const wallet = this.wallets.get(publicKey);
  
  if (!wallet) {
    throw new NotFoundError(
      `Wallet not found: ${publicKey}`,
      ERROR_CODES.WALLET_NOT_FOUND
    );
  }
  
  return wallet;
}
```

## Migration Patterns

### Pattern 1: Validation Errors

#### Before:
```javascript
if (!amount) {
  return res.status(400).json({
    error: 'Amount is required'
  });
}

if (isNaN(amount) || amount <= 0) {
  return res.status(400).json({
    success: false,
    error: {
      code: 'INVALID_AMOUNT',
      message: 'Amount must be positive'
    }
  });
}
```

#### After:
```javascript
if (!amount) {
  throw new ValidationError(
    'Amount is required',
    null,
    ERROR_CODES.MISSING_REQUIRED_FIELD
  );
}

if (isNaN(amount) || amount <= 0) {
  throw new ValidationError(
    'Amount must be positive',
    null,
    ERROR_CODES.INVALID_AMOUNT
  );
}
```

### Pattern 2: Not Found Errors

#### Before:
```javascript
const user = await User.findById(id);

if (!user) {
  return res.status(404).json({
    error: 'User not found'
  });
}
```

#### After:
```javascript
const user = await User.findById(id);

if (!user) {
  throw new NotFoundError('User not found', ERROR_CODES.USER_NOT_FOUND);
}
```

### Pattern 3: Authorization Errors

#### Before:
```javascript
if (!req.user) {
  return res.status(401).json({ error: 'Unauthorized' });
}

if (!hasPermission(req.user, 'admin')) {
  return res.status(403).json({ error: 'Access denied' });
}
```

#### After:
```javascript
if (!req.user) {
  throw new UnauthorizedError();
}

if (!hasPermission(req.user, 'admin')) {
  throw new ForbiddenError('Insufficient permissions for this action');
}
```

### Pattern 4: Business Logic Errors

#### Before:
```javascript
if (balance < amount) {
  return res.status(400).json({
    error: 'Insufficient balance'
  });
}
```

#### After:
```javascript
if (balance < amount) {
  throw new BusinessLogicError(
    ERROR_CODES.INSUFFICIENT_BALANCE,
    'Insufficient balance for this transaction',
    { required: amount, available: balance }
  );
}
```

### Pattern 5: Database Errors

#### Before:
```javascript
db.query(sql, params, (err, rows) => {
  if (err) {
    reject(err);
  } else {
    resolve(rows);
  }
});
```

#### After:
```javascript
db.query(sql, params, (err, rows) => {
  if (err) {
    reject(new DatabaseError('Database query failed', err));
  } else {
    resolve(rows);
  }
});
```

### Pattern 6: Generic Catch Blocks

#### Before:
```javascript
try {
  // ... operation
} catch (error) {
  res.status(500).json({
    error: 'Operation failed',
    message: error.message
  });
}
```

#### After:
```javascript
try {
  // ... operation
} catch (error) {
  next(error); // Let middleware handle it
}
```

## Route-by-Route Migration Checklist

### For Each Route File:

- [ ] Import error classes at the top
- [ ] Add `next` parameter to all route handlers
- [ ] Replace all `res.status(4xx).json()` with `throw new ErrorClass()`
- [ ] Replace all `res.status(500).json()` with `next(error)`
- [ ] Remove try-catch blocks that only format errors
- [ ] Keep try-catch blocks that need cleanup logic
- [ ] Update tests to expect new error format

### For Each Service File:

- [ ] Import error classes at the top
- [ ] Replace `throw new Error()` with specific error classes
- [ ] Add error codes to all thrown errors
- [ ] Update JSDoc comments to document thrown errors
- [ ] Update tests to expect new error types

## Files to Migrate

### Priority 1 (Core Routes)
- [x] `src/routes/donation.js` - ✅ Migrated
- [ ] `src/routes/wallet.js`
- [ ] `src/routes/transaction.js`
- [ ] `src/routes/stats.js`
- [ ] `src/routes/stream.js`

### Priority 2 (Services)
- [x] `src/services/MockStellarService.js` - ✅ Migrated
- [ ] `src/services/StellarService.js`
- [ ] `src/services/RecurringDonationScheduler.js`

### Priority 3 (Middleware)
- [x] `src/middleware/rbacMiddleware.js` - ✅ Migrated
- [x] `src/middleware/errorHandler.js` - ✅ Created

### Priority 4 (Utilities)
- [x] `src/utils/database.js` - ✅ Migrated
- [ ] `src/utils/feeCalculator.js`
- [ ] `src/utils/permissions.js`

## Testing Your Migration

### 1. Unit Tests

Update your tests to check for error classes:

```javascript
it('should throw ValidationError for invalid amount', async () => {
  await expect(
    service.process({ amount: -10 })
  ).rejects.toThrow(ValidationError);
});
```

### 2. Integration Tests

Verify error response format:

```javascript
it('should return 400 with correct error format', async () => {
  const response = await request(app)
    .post('/api/endpoint')
    .send({ invalid: 'data' });
  
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({
    success: false,
    error: {
      code: expect.any(String),
      message: expect.any(String),
      timestamp: expect.any(String)
    }
  });
});
```

### 3. Manual Testing

Test each endpoint with:
- Valid data (should work as before)
- Invalid data (should return new error format)
- Missing data (should return new error format)
- Unauthorized access (should return new error format)

## Common Pitfalls

### ❌ Don't Do This:

```javascript
// Don't mix old and new patterns
if (!data) {
  return res.status(400).json({ error: 'Bad request' });
}
throw new ValidationError('Invalid data');
```

```javascript
// Don't catch and re-throw without adding value
try {
  await operation();
} catch (error) {
  throw error; // Unnecessary
}
```

```javascript
// Don't forget to pass error to next()
try {
  await operation();
} catch (error) {
  console.error(error); // Error is lost!
}
```

### ✅ Do This Instead:

```javascript
// Use consistent error handling
if (!data) {
  throw new ValidationError('Data is required');
}
```

```javascript
// Only catch if you need to add context or cleanup
try {
  await operation();
} catch (error) {
  await cleanup();
  throw new InternalError('Operation failed', error);
}
```

```javascript
// Always pass errors to middleware
try {
  await operation();
} catch (error) {
  console.error(error); // Log if needed
  next(error); // Then pass to handler
}
```

## Rollback Plan

If you need to rollback:

1. Keep old error handling code commented out during migration
2. Test thoroughly before removing old code
3. Use feature flags to toggle between old and new error handling
4. Monitor error logs after deployment

## Support

If you encounter issues during migration:

1. Check `ERROR_HANDLING.md` for documentation
2. Review `src/routes/donation.js` for reference implementation
3. Check error utility: `src/utils/errors.js`
4. Review error middleware: `src/middleware/errorHandler.js`

## Completion Checklist

- [x] Error utility created (`src/utils/errors.js`)
- [x] Error middleware created (`src/middleware/errorHandler.js`)
- [x] App.js updated to use error middleware
- [x] Documentation created (`ERROR_HANDLING.md`)
- [x] Migration guide created (`MIGRATION_GUIDE.md`)
- [x] Example route migrated (`src/routes/donation.js`)
- [x] Example service migrated (`src/services/MockStellarService.js`)
- [x] Database utility migrated (`src/utils/database.js`)
- [x] RBAC middleware migrated (`src/middleware/rbacMiddleware.js`)
- [ ] All routes migrated
- [ ] All services migrated
- [ ] All tests updated
- [ ] Integration tests passing
- [ ] Documentation reviewed
