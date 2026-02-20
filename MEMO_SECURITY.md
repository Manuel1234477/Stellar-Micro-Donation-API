# Memo Feature Security Documentation

## Security Overview

This document outlines the security considerations, measures, and best practices for the transaction memo feature.

## Security Measures Implemented

### 1. Input Validation

#### Length Validation
- **Maximum Length**: 28 bytes (Stellar protocol limit)
- **Enforcement**: Server-side validation before storage
- **Byte-level checking**: Uses `Buffer.byteLength()` for accurate UTF-8 byte counting
- **Prevents**: Buffer overflow, excessive storage usage

```javascript
// Validation enforced in MemoValidator.validate()
if (byteLength > MAX_MEMO_LENGTH) {
  return { valid: false, code: 'MEMO_TOO_LONG' };
}
```

#### Type Validation
- **Expected Type**: String
- **Enforcement**: Type checking before processing
- **Prevents**: Type confusion attacks, injection attempts

```javascript
if (typeof memo !== 'string') {
  return { valid: false, code: 'INVALID_MEMO_TYPE' };
}
```

#### Content Validation
- **Null Byte Check**: Rejects memos containing `\0`
- **Prevents**: Null byte injection, string truncation attacks
- **Enforcement**: Content scanning before storage

```javascript
if (sanitized.includes('\0')) {
  return { valid: false, code: 'INVALID_MEMO_CONTENT' };
}
```

### 2. Input Sanitization

#### Whitespace Trimming
- **Action**: Removes leading/trailing whitespace
- **Purpose**: Normalize input, prevent whitespace-based attacks
- **Implementation**: `memo.trim()`

#### Null Byte Removal
- **Action**: Removes all null bytes from input
- **Purpose**: Prevent null byte injection
- **Implementation**: `memo.replace(/\0/g, '')`

### 3. SQL Injection Prevention

#### Parameterized Queries
- **Method**: Uses SQLite parameterized queries
- **Implementation**: All database operations use parameter binding
- **Prevents**: SQL injection attacks

```javascript
// Safe parameterized query
db.run(
  'INSERT INTO transactions (senderId, receiverId, amount, memo) VALUES (?, ?, ?, ?)',
  [senderId, receiverId, amount, memo]
);
```

#### No String Concatenation
- **Rule**: Never concatenate user input into SQL queries
- **Enforcement**: Code review, linting rules
- **Prevents**: SQL injection

### 4. XSS Prevention

#### JSON Encoding
- **Method**: All API responses use proper JSON encoding
- **Implementation**: Express.js automatic JSON serialization
- **Prevents**: Cross-site scripting (XSS) attacks

#### Content-Type Headers
- **Header**: `Content-Type: application/json`
- **Purpose**: Ensures proper content interpretation
- **Prevents**: MIME type confusion attacks

### 5. Data Privacy

#### Public Nature Warning
- **Documentation**: Clear warnings that memos are public
- **Blockchain**: Memos are visible on Stellar blockchain
- **Recommendation**: Never include sensitive data in memos

#### No Encryption
- **Current State**: Memos stored in plaintext
- **Rationale**: Stellar blockchain stores memos in plaintext
- **Future Enhancement**: Optional encryption layer for database storage

### 6. Rate Limiting (Recommended)

While not implemented in this feature, production deployments should include:

```javascript
// Example rate limiting middleware (not included)
const rateLimit = require('express-rate-limit');

const donationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many donation requests, please try again later'
});

app.use('/donations', donationLimiter);
```

## Threat Model

### Threats Mitigated

| Threat | Mitigation | Severity |
|--------|-----------|----------|
| SQL Injection | Parameterized queries | High |
| XSS | JSON encoding, Content-Type headers | High |
| Buffer Overflow | Length validation (28 bytes) | Medium |
| Null Byte Injection | Content validation, sanitization | Medium |
| Type Confusion | Type validation | Low |
| Excessive Storage | Length limits | Low |

### Threats Not Mitigated

| Threat | Status | Recommendation |
|--------|--------|----------------|
| Rate Limiting | Not implemented | Add rate limiting middleware |
| DDoS | Not implemented | Use reverse proxy (nginx, Cloudflare) |
| Data Privacy | Partial | Educate users, consider encryption |
| Spam Memos | Not implemented | Add content filtering, moderation |

## Security Best Practices

### For Developers

1. **Never Trust User Input**
   - Always validate memo input
   - Use MemoValidator for all memo operations
   - Never bypass validation

2. **Use Parameterized Queries**
   - Never concatenate user input into SQL
   - Use parameter binding for all database operations
   - Review all database code for injection vulnerabilities

3. **Sanitize Before Storage**
   - Always sanitize memos before database storage
   - Use MemoValidator.sanitize()
   - Remove potentially harmful characters

4. **Test Edge Cases**
   - Test maximum length (28 bytes)
   - Test multi-byte UTF-8 characters
   - Test special characters and symbols
   - Test null bytes and control characters

5. **Keep Dependencies Updated**
   - Regularly update npm packages
   - Monitor security advisories
   - Run `npm audit` regularly

### For API Consumers

1. **Don't Include Sensitive Data**
   - Memos are public on blockchain
   - Never include passwords, keys, or PII
   - Consider data privacy regulations

2. **Validate Client-Side**
   - Check memo length before submission
   - Provide user feedback on validation errors
   - Handle error responses gracefully

3. **Handle Errors Properly**
   - Check for validation error responses
   - Display user-friendly error messages
   - Don't expose internal error details to end users

4. **Use HTTPS**
   - Always use HTTPS for API requests
   - Verify SSL certificates
   - Protect data in transit

## Compliance Considerations

### GDPR (General Data Protection Regulation)

- **Data Minimization**: Only collect necessary memo data
- **Right to Erasure**: Note that blockchain data cannot be deleted
- **Transparency**: Inform users that memos are public and permanent
- **Consent**: Obtain explicit consent for public memo storage

### PCI DSS (Payment Card Industry Data Security Standard)

- **No Card Data**: Never include credit card numbers in memos
- **No CVV**: Never include security codes in memos
- **No PII**: Avoid personally identifiable information

### CCPA (California Consumer Privacy Act)

- **Disclosure**: Inform users about memo data collection
- **Opt-Out**: Provide option to not include memos
- **Data Access**: Allow users to access their memo data

## Incident Response

### If SQL Injection is Suspected

1. **Immediate Actions**
   - Review database logs for suspicious queries
   - Check for unauthorized data access
   - Isolate affected systems if necessary

2. **Investigation**
   - Review all memo-related database operations
   - Check for parameterized query usage
   - Audit recent code changes

3. **Remediation**
   - Fix any non-parameterized queries
   - Update validation rules if needed
   - Deploy security patches

### If XSS is Suspected

1. **Immediate Actions**
   - Review API responses for unescaped content
   - Check Content-Type headers
   - Verify JSON encoding

2. **Investigation**
   - Test memo display in all contexts
   - Check for script injection attempts
   - Review client-side rendering code

3. **Remediation**
   - Ensure proper JSON encoding
   - Add Content-Security-Policy headers
   - Update sanitization rules

## Security Testing

### Manual Testing

```bash
# Test SQL injection attempts
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "recipient": "...", "memo": "test\"; DROP TABLE transactions; --"}'

# Test XSS attempts
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "recipient": "...", "memo": "<script>alert(1)</script>"}'

# Test null byte injection
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "recipient": "...", "memo": "test\u0000memo"}'

# Test length overflow
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "recipient": "...", "memo": "'$(python3 -c 'print("a"*1000)')'"}'
```

### Automated Testing

```bash
# Run security-focused tests
npm test tests/memo-validation.test.js

# Run SQL injection tests
npm test tests/memo-integration.test.js

# Run npm security audit
npm audit

# Check for known vulnerabilities
npm audit --production
```

## Security Checklist

Before deploying to production:

- [ ] All database queries use parameterized statements
- [ ] Input validation is enforced server-side
- [ ] Memo length is limited to 28 bytes
- [ ] Null bytes are rejected/removed
- [ ] Type validation is performed
- [ ] JSON responses are properly encoded
- [ ] Content-Type headers are set correctly
- [ ] HTTPS is enforced
- [ ] Security tests pass
- [ ] npm audit shows no high/critical vulnerabilities
- [ ] Documentation warns about public nature of memos
- [ ] Error messages don't expose sensitive information
- [ ] Logging doesn't include sensitive data
- [ ] Rate limiting is configured (recommended)
- [ ] Monitoring/alerting is set up

## Security Contacts

For security issues or vulnerabilities:

1. **Do not** open public GitHub issues
2. **Do not** discuss in public channels
3. **Do** report privately to security team
4. **Do** provide detailed reproduction steps

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Stellar Security Guidelines](https://developers.stellar.org/docs/building-apps/security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## Version History

- **v1.0.0** (2026-02-20): Initial security documentation
  - Input validation
  - SQL injection prevention
  - XSS prevention
  - Data privacy considerations
