# Input Sanitization Implementation

## Overview

This document describes the input sanitization implementation to prevent injection attacks and logging issues in the Stellar Micro-Donation API.

## Security Threats Addressed

### 1. Log Injection
Attackers can inject newline characters and control sequences to create fake log entries or hide malicious activity.

**Example Attack:**
```
memo: "legitimate\n[2024-01-01] [ERROR] [ADMIN] Fake security alert"
```

**Prevention:** Remove all control characters including newlines from user input before logging.

### 2. Null Byte Injection
Null bytes (`\x00`) can truncate strings in some contexts and bypass security checks.

**Example Attack:**
```
label: "safe\x00<malicious>"
```

**Prevention:** Strip all null bytes from user input.

### 3. ANSI Escape Code Injection
ANSI escape sequences can manipulate terminal output, hide text, or create misleading displays.

**Example Attack:**
```
ownerName: "\x1B[2J\x1B[HCleared screen"
```

**Prevention:** Remove all ANSI escape sequences from user input.

### 4. Cross-Site Scripting (XSS)
If metadata is displayed in web interfaces without proper encoding, script tags could execute.

**Example Attack:**
```
donor: "<script>alert('XSS')</script>"
```

**Prevention:** Remove or escape special characters, especially for identifiers.

## Implementation

### Core Sanitization Utility

Location: `src/utils/sanitizer.js`

#### Functions

1. **sanitizeText(input, options)**
   - General-purpose text sanitization
   - Removes control characters, null bytes, ANSI codes
   - Configurable length limits and character restrictions

2. **sanitizeMemo(memo)**
   - Specialized for Stellar transaction memos
   - 28-byte limit (Stellar MEMO_TEXT specification)
   - Removes all control characters

3. **sanitizeLabel(label)**
   - For wallet labels
   - 100-character limit
   - Allows most characters but removes control codes

4. **sanitizeName(name)**
   - For owner names
   - 100-character limit
   - Removes control characters

5. **sanitizeIdentifier(identifier)**
   - For donor/recipient identifiers
   - Strict character restrictions (alphanumeric, basic punctuation only)
   - Prevents injection in identifiers

6. **sanitizeForLogging(data)**
   - Recursively sanitizes objects/arrays for safe logging
   - Prevents log injection attacks
   - Handles nested structures

7. **sanitizeRequestBody(body, fieldConfig)**
   - Batch sanitization for request bodies
   - Field-specific sanitization based on configuration

### Integration Points

#### 1. Donation Routes (`src/routes/donation.js`)

**Sanitized Fields:**
- `memo` - Transaction memo
- `donor` - Donor identifier
- `recipient` - Recipient identifier

**Implementation:**
```javascript
const { sanitizeIdentifier } = require('../utils/sanitizer');

// Sanitize identifiers
const sanitizedDonor = donor ? sanitizeIdentifier(donor) : '';
const sanitizedRecipient = sanitizeIdentifier(recipient);

// Sanitize memo (via memoValidator)
const sanitizedMemo = memo ? memoValidator.sanitize(memo) : '';
```

#### 2. Wallet Routes (`src/routes/wallet.js`)

**Sanitized Fields:**
- `label` - Wallet label
- `ownerName` - Wallet owner name

**Implementation:**
```javascript
const { sanitizeLabel, sanitizeName } = require('../utils/sanitizer');

// On wallet creation
const sanitizedLabel = label ? sanitizeLabel(label) : null;
const sanitizedOwnerName = ownerName ? sanitizeName(ownerName) : null;

// On wallet update
if (label !== undefined) updates.label = sanitizeLabel(label);
if (ownerName !== undefined) updates.ownerName = sanitizeName(ownerName);
```

#### 3. Logging Utility (`src/utils/log.js`)

**Implementation:**
```javascript
const { sanitizeForLogging } = require('./sanitizer');

function safeStringify(value) {
  try {
    const sanitized = sanitizeForLogging(value);
    return JSON.stringify(sanitized);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

function formatMessage(level, scope, message, meta) {
  // Sanitize scope and message
  const sanitizedScope = typeof scope === 'string' ? scope.replace(/[\x00-\x1F\x7F]/g, '') : scope;
  const sanitizedMessage = typeof message === 'string' ? message.replace(/[\x00-\x1F\x7F]/g, '') : message;
  // ... rest of implementation
}
```

#### 4. Memo Validator (`src/utils/memoValidator.js`)

Updated to use centralized sanitization:
```javascript
const { sanitizeMemo } = require('./sanitizer');

static sanitize(memo) {
  return sanitizeMemo(memo);
}
```

## User-Controlled Fields

### Complete List

| Field | Location | Sanitization Function | Max Length | Notes |
|-------|----------|----------------------|------------|-------|
| `memo` | Donation creation | `sanitizeMemo()` | 28 bytes | Stellar MEMO_TEXT limit |
| `donor` | Donation creation | `sanitizeIdentifier()` | 100 chars | Strict character set |
| `recipient` | Donation creation | `sanitizeIdentifier()` | 100 chars | Strict character set |
| `label` | Wallet create/update | `sanitizeLabel()` | 100 chars | Allows most characters |
| `ownerName` | Wallet create/update | `sanitizeName()` | 100 chars | Allows most characters |

### Validation Flow

```
User Input → Type Validation → Sanitization → Business Logic Validation → Storage
```

1. **Type Validation**: Ensure correct data types
2. **Sanitization**: Remove dangerous characters
3. **Business Logic Validation**: Check against business rules (e.g., amount limits)
4. **Storage**: Save sanitized data

## Testing

### Unit Tests

Location: `tests/sanitizer.test.js`

**Test Coverage:**
- Basic sanitization (whitespace, null bytes, control characters)
- ANSI escape sequence removal
- Length truncation
- Character restriction modes
- Nested object/array sanitization
- Security attack scenarios

### Integration Tests

Location: `tests/sanitization-integration.test.js`

**Test Coverage:**
- Donation endpoint sanitization
- Wallet endpoint sanitization
- Log injection prevention
- XSS prevention
- Null byte injection prevention

### Running Tests

```bash
# Run all sanitization tests
npm test -- sanitizer

# Run unit tests only
npm test -- sanitizer.test.js

# Run integration tests only
npm test -- sanitization-integration.test.js
```

## Security Best Practices

### Defense in Depth

1. **Input Sanitization** (this implementation)
   - First line of defense
   - Removes dangerous characters

2. **Parameterized Queries**
   - Already implemented via SQLite prepared statements
   - Prevents SQL injection

3. **Output Encoding**
   - Should be implemented in frontend/API consumers
   - Context-specific encoding (HTML, JSON, etc.)

4. **Content Security Policy**
   - Should be implemented in web interfaces
   - Restricts script execution

### What This Does NOT Prevent

1. **SQL Injection**: Prevented by parameterized queries (already implemented)
2. **Command Injection**: Not applicable (no shell command execution with user input)
3. **Path Traversal**: Not applicable (no file path operations with user input)
4. **Business Logic Attacks**: Requires separate validation (amount limits, rate limiting, etc.)

## Acceptance Criteria

✅ **User-controlled fields identified:**
- memo, donor, recipient, label, ownerName

✅ **Sanitization before processing:**
- All fields sanitized before business logic
- Sanitization applied at route level

✅ **Sanitization before logging:**
- Logging utility sanitizes all data
- Prevents log injection attacks

✅ **Sanitization before storage:**
- All user input sanitized before database writes
- No unsafe strings stored

✅ **No unsafe strings logged:**
- Control characters removed from logs
- ANSI codes stripped
- Newlines removed to prevent log injection

## Maintenance

### Adding New User Input Fields

When adding new endpoints or fields that accept user input:

1. Identify the field type (text, identifier, memo, etc.)
2. Choose appropriate sanitization function
3. Apply sanitization before processing
4. Add tests for the new field
5. Update this documentation

### Example

```javascript
// New endpoint with user input
router.post('/new-endpoint', (req, res) => {
  const { userInput } = req.body;
  
  // Sanitize based on field type
  const sanitized = sanitizeText(userInput, {
    maxLength: 200,
    allowNewlines: false,
    allowSpecialChars: true
  });
  
  // Process sanitized input
  // ...
});
```

## References

- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP Log Injection](https://owasp.org/www-community/attacks/Log_Injection)
- [Stellar Memo Specification](https://developers.stellar.org/docs/glossary/transactions/#memo)
- [CWE-117: Improper Output Neutralization for Logs](https://cwe.mitre.org/data/definitions/117.html)
