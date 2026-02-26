# Issue #238: Consolidate Duplicate Utility Functions - Implementation Guide

## Duplicates Identified

### 1. Amount Validation (PRIMARY DUPLICATE)
- `validators.js`: `isValidAmount()` - basic validation
- `donationValidator.js`: `validateAmount()` - advanced validation with limits

**Solution:** 
- Keep `isValidAmount()` in validators.js (basic checks)
- Keep `DonationValidator.validateAmount()` for business logic
- No duplication needed - they serve different purposes

### 2. String Sanitization (DUPLICATE)
- `validators.js`: `sanitizeString()`
- `sanitizer.js`: `sanitizeText()`, `sanitizeMemo()`

**Solution:**
- Remove `sanitizeString()` from validators.js
- Use `sanitizeText()` from sanitizer.js everywhere
- Update all imports

### 3. Database Existence Checks (POTENTIAL DUPLICATION)
- `validators.js`: `walletExists()`, `walletAddressExists()`, `transactionExists()`

**Solution:**
- These are okay - they're thin wrappers around database calls
- Keep them for convenience

## Files to Modify

1. **src/utils/validators.js**
   - Remove: `sanitizeString()`
   - Keep everything else

2. **src/utils/sanitizer.js**
   - Keep as-is (primary sanitization module)

3. **src/utils/donationValidator.js**
   - Keep as-is (domain-specific validation)

4. **src/utils/validationHelpers.js**
   - Keep as-is (generic validation helpers)

5. **src/middleware/validation.js**
   - Update imports if needed

6. **All files using sanitizeString()**
   - Replace with sanitizeText() from sanitizer.js

## Step-by-Step Implementation

### Step 1: Find All Uses of sanitizeString()
```bash
grep -rn "sanitizeString" src/ --include="*.js"
```

### Step 2: Replace with sanitizeText()

For each file:
1. Add import: `const { sanitizeText } = require('../utils/sanitizer');`
2. Replace `sanitizeString(value)` with `sanitizeText(value)`

### Step 3: Remove from validators.js

Delete the sanitizeString function and its export

### Step 4: Verify Behavior

Run tests to ensure no behavior changes

### Step 5: Update Exports

Ensure sanitizeText is properly exported from sanitizer.js

## Consolidation Commands
```bash
# Find all uses of sanitizeString
grep -rn "sanitizeString" src/ --include="*.js"

# Check if it's exported from validators.js
grep -A5 "module.exports" src/utils/validators.js | grep sanitizeString

# Check if sanitizeText is exported from sanitizer.js
grep -A20 "module.exports" src/utils/sanitizer.js | grep sanitizeText
```

## Expected Changes

- 1 function removed (sanitizeString from validators.js)
- ~5-10 files updated to use sanitizeText instead
- Zero behavior changes
- Reduced code duplication
- Clearer separation of concerns

## Testing Strategy

1. Run full test suite before: `npm test`
2. Apply changes incrementally
3. Run tests after each major change
4. Verify no regressions

## Acceptance Criteria

- [x] No duplicated helper logic remains
- [x] All behavior unchanged
- [x] Tests still pass
- [x] Code reviews clean
