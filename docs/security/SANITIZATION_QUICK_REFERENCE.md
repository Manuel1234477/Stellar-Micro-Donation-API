# Input Sanitization Quick Reference

## Quick Usage Guide

### Import Sanitization Functions

```javascript
const {
  sanitizeText,
  sanitizeMemo,
  sanitizeLabel,
  sanitizeName,
  sanitizeIdentifier,
  sanitizeForLogging
} = require('../utils/sanitizer');
```

### Common Patterns

#### Sanitize Donation Memo
```javascript
const sanitizedMemo = sanitizeMemo(req.body.memo);
// Max 28 bytes, no control characters
```

#### Sanitize Wallet Label
```javascript
const sanitizedLabel = sanitizeLabel(req.body.label);
// Max 100 chars, no control characters
```

#### Sanitize Owner Name
```javascript
const sanitizedName = sanitizeName(req.body.ownerName);
// Max 100 chars, no control characters
```

#### Sanitize Identifier (Donor/Recipient)
```javascript
const sanitizedDonor = sanitizeIdentifier(req.body.donor);
// Strict: alphanumeric + basic punctuation only
```

#### Sanitize for Logging
```javascript
log.info('SCOPE', 'Message', sanitizeForLogging(userData));
// Recursively sanitizes objects/arrays
```

#### Custom Text Sanitization
```javascript
const sanitized = sanitizeText(input, {
  maxLength: 200,           // Character limit
  allowNewlines: false,     // Remove newlines?
  allowSpecialChars: true   // Allow special chars?
});
```

## Field-Specific Rules

| Field Type | Function | Max Length | Special Chars | Use Case |
|------------|----------|------------|---------------|----------|
| Memo | `sanitizeMemo()` | 28 bytes | Yes | Transaction memos |
| Label | `sanitizeLabel()` | 100 chars | Yes | Wallet labels |
| Name | `sanitizeName()` | 100 chars | Yes | Owner names |
| Identifier | `sanitizeIdentifier()` | 100 chars | No | Donor/recipient IDs |
| General | `sanitizeText()` | Configurable | Configurable | Custom fields |

## What Gets Removed

### Always Removed
- Null bytes (`\x00`)
- Control characters (`\x01-\x1F`, `\x7F`)
- ANSI escape sequences (`\x1B[...`)
- Leading/trailing whitespace

### Conditionally Removed
- Newlines (`\n`, `\r`) - removed unless `allowNewlines: true`
- Special characters (`<>{}[]`) - removed if `allowSpecialChars: false`

## Security Checklist

When handling user input:

- [ ] Identify all user-controlled fields
- [ ] Choose appropriate sanitization function
- [ ] Apply sanitization BEFORE processing
- [ ] Apply sanitization BEFORE logging
- [ ] Apply sanitization BEFORE storage
- [ ] Add tests for new fields
- [ ] Update documentation

## Common Mistakes

### ❌ Don't Do This
```javascript
// Storing unsanitized input
const wallet = Wallet.create({ 
  label: req.body.label  // UNSAFE!
});

// Logging unsanitized data
log.info('USER', 'Data', req.body);  // UNSAFE!
```

### ✅ Do This Instead
```javascript
// Sanitize before storage
const wallet = Wallet.create({ 
  label: sanitizeLabel(req.body.label)  // SAFE
});

// Sanitize before logging
log.info('USER', 'Data', sanitizeForLogging(req.body));  // SAFE
```

## Testing Your Sanitization

### Test Cases to Include

```javascript
describe('Field Sanitization', () => {
  test('removes null bytes', () => {
    const input = 'safe\x00malicious';
    const sanitized = sanitizeText(input);
    expect(sanitized).not.toContain('\x00');
  });

  test('removes newlines', () => {
    const input = 'line1\nline2';
    const sanitized = sanitizeText(input);
    expect(sanitized).not.toContain('\n');
  });

  test('removes ANSI codes', () => {
    const input = '\x1B[31mRed\x1B[0m';
    const sanitized = sanitizeText(input);
    expect(sanitized).not.toContain('\x1B');
  });

  test('enforces length limit', () => {
    const input = 'a'.repeat(200);
    const sanitized = sanitizeText(input, { maxLength: 100 });
    expect(sanitized.length).toBe(100);
  });
});
```

## Attack Scenarios Prevented

### Log Injection
```javascript
// Attack attempt
const malicious = "user\n[2024-01-01] [ERROR] Fake log";

// After sanitization
const safe = sanitizeText(malicious);
// Result: "user[2024-01-01] [ERROR] Fake log"
```

### Null Byte Injection
```javascript
// Attack attempt
const malicious = "safe\x00<script>alert(1)</script>";

// After sanitization
const safe = sanitizeText(malicious);
// Result: "safe<script>alert(1)</script>"
// (Further XSS protection needed at output)
```

### ANSI Escape Code Injection
```javascript
// Attack attempt
const malicious = "\x1B[2J\x1B[HCleared screen";

// After sanitization
const safe = sanitizeText(malicious);
// Result: "Cleared screen"
```

## Integration Examples

### Express Route with Sanitization
```javascript
router.post('/endpoint', async (req, res) => {
  try {
    // 1. Validate types
    if (!req.body.field || typeof req.body.field !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // 2. Sanitize
    const sanitized = sanitizeText(req.body.field);

    // 3. Business logic validation
    if (sanitized.length < 3) {
      return res.status(400).json({ error: 'Too short' });
    }

    // 4. Process
    const result = await processData(sanitized);

    // 5. Log (with sanitization)
    log.info('ENDPOINT', 'Success', sanitizeForLogging({ 
      field: sanitized 
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    log.error('ENDPOINT', 'Error', sanitizeForLogging({ 
      error: error.message 
    }));
    res.status(500).json({ error: 'Internal error' });
  }
});
```

## Performance Considerations

- Sanitization is fast (regex-based)
- Minimal overhead for typical input sizes
- For large batches, consider caching sanitized values
- Sanitization happens once per request

## When to Use Each Function

```
User Input Type          → Sanitization Function
─────────────────────────────────────────────────
Transaction memo         → sanitizeMemo()
Wallet label            → sanitizeLabel()
Owner/user name         → sanitizeName()
Donor/recipient ID      → sanitizeIdentifier()
Log data (any type)     → sanitizeForLogging()
Custom field            → sanitizeText(input, options)
```

## Need Help?

- See full documentation: `docs/security/INPUT_SANITIZATION.md`
- Check tests: `tests/sanitizer.test.js`
- Review integration: `tests/sanitization-integration.test.js`
