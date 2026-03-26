# Audit Logging for Security-Sensitive Actions

## Overview

The Stellar Micro-Donation API implements comprehensive audit logging for all security-sensitive operations. Audit logs provide an immutable, tamper-evident trail for compliance, security monitoring, and incident investigation.

## Features

- **Immutable Storage**: Audit logs are write-once and cannot be modified
- **Integrity Verification**: Each log entry includes a cryptographic hash for tamper detection
- **Sensitive Data Masking**: Automatic sanitization prevents exposure of secrets and PII
- **Structured Logging**: Consistent format with standard fields for easy querying
- **Real-time Monitoring**: High-severity events are logged to application logs for alerting
- **Query API**: Flexible filtering and pagination for audit trail analysis

## Architecture

### Components

1. **AuditLogService** (`src/services/AuditLogService.js`)
   - Core audit logging functionality
   - Integrity hash generation and verification
   - Query and statistics APIs

2. **Database Table** (`audit_logs`)
   - Immutable storage for audit entries
   - Indexed for efficient querying
   - Includes integrity hash for tamper detection

3. **Integration Points**
   - API Key Middleware (`src/middleware/apiKey.js`)
   - RBAC Middleware (`src/middleware/rbac.js`)
   - API Keys Routes (`src/routes/apiKeys.js`)
   - Rate Limiter (`src/middleware/rateLimiter.js`)
   - Abuse Detection (`src/middleware/abuseDetection.js`)

## Security-Sensitive Operations

### Authentication (HIGH Severity)
- API key validation (success/failure)
- Missing API key attempts
- Legacy key usage
- Invalid/expired key attempts

### Authorization (HIGH Severity)
- Permission checks (granted/denied)
- Admin access attempts (granted/denied)
- Role-based access control violations

### API Key Management (HIGH Severity)
- API key creation
- API key deprecation
- API key revocation
- API key listing (MEDIUM severity)

### Financial Operations (HIGH Severity)
- Donation creation
- Donation verification
- Transaction recording
- Donation status updates

### Rate Limiting (HIGH/MEDIUM Severity)
- Rate limit exceeded events
- Burst detection
- Repeated failures

### Abuse Detection (HIGH Severity)
- IP flagging
- Suspicious activity patterns
- Replay detection

## Audit Log Structure

Each audit log entry contains:

```javascript
{
  id: 123,                          // Auto-increment ID
  timestamp: "2024-01-15T10:30:00Z", // ISO 8601 timestamp
  category: "AUTHENTICATION",        // Event category
  action: "API_KEY_VALIDATED",       // Specific action
  severity: "HIGH",                  // HIGH, MEDIUM, or LOW
  result: "SUCCESS",                 // SUCCESS or FAILURE
  userId: "user-123",                // User/API key identifier
  requestId: "req-456",              // Request correlation ID
  ipAddress: "192.168.1.1",          // Client IP
  resource: "/api/v1/donations",     // Resource accessed
  reason: "Invalid credentials",     // Failure reason (optional)
  details: {                         // Additional context (sanitized)
    role: "user",
    method: "POST"
  },
  integrityHash: "abc123...",        // SHA-256 hash for tamper detection
  createdAt: "2024-01-15T10:30:00Z"  // Database timestamp
}
```

## Usage

### Creating Audit Logs

```javascript
const AuditLogService = require('../services/AuditLogService');

// Log a security-sensitive operation
await AuditLogService.log({
  category: AuditLogService.CATEGORY.AUTHENTICATION,
  action: AuditLogService.ACTION.API_KEY_VALIDATED,
  severity: AuditLogService.SEVERITY.HIGH,
  result: 'SUCCESS',
  userId: 'user-123',
  requestId: req.id,
  ipAddress: req.ip,
  resource: req.path,
  details: {
    role: 'admin',
    keyPrefix: 'sk_live_abc...'
  }
});
```

### Querying Audit Logs

```javascript
// Query with filters
const logs = await AuditLogService.query({
  category: AuditLogService.CATEGORY.AUTHENTICATION,
  severity: AuditLogService.SEVERITY.HIGH,
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-01-31T23:59:59Z',
  limit: 100,
  offset: 0
});

// Get statistics
const stats = await AuditLogService.getStatistics({
  category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
  startDate: '2024-01-01T00:00:00Z'
});
```

### Verifying Integrity

```javascript
// Verify an audit log entry hasn't been tampered with
const entry = await Database.get('SELECT * FROM audit_logs WHERE id = ?', [123]);
const isValid = AuditLogService.verifyIntegrity(entry);

if (!isValid) {
  console.error('Audit log tampering detected!');
}
```

## Constants

### Severity Levels

```javascript
AuditLogService.SEVERITY.HIGH    // Critical security events
AuditLogService.SEVERITY.MEDIUM  // Important operations
AuditLogService.SEVERITY.LOW     // Informational events
```

### Categories

```javascript
AuditLogService.CATEGORY.AUTHENTICATION
AuditLogService.CATEGORY.AUTHORIZATION
AuditLogService.CATEGORY.API_KEY_MANAGEMENT
AuditLogService.CATEGORY.FINANCIAL_OPERATION
AuditLogService.CATEGORY.WALLET_OPERATION
AuditLogService.CATEGORY.CONFIGURATION
AuditLogService.CATEGORY.RATE_LIMITING
AuditLogService.CATEGORY.ABUSE_DETECTION
AuditLogService.CATEGORY.DATA_ACCESS
```

### Actions

```javascript
// Authentication
AuditLogService.ACTION.API_KEY_VALIDATED
AuditLogService.ACTION.API_KEY_VALIDATION_FAILED
AuditLogService.ACTION.LEGACY_KEY_USED

// Authorization
AuditLogService.ACTION.PERMISSION_GRANTED
AuditLogService.ACTION.PERMISSION_DENIED
AuditLogService.ACTION.ADMIN_ACCESS_GRANTED
AuditLogService.ACTION.ADMIN_ACCESS_DENIED

// API Key Management
AuditLogService.ACTION.API_KEY_CREATED
AuditLogService.ACTION.API_KEY_LISTED
AuditLogService.ACTION.API_KEY_DEPRECATED
AuditLogService.ACTION.API_KEY_REVOKED

// Financial Operations
AuditLogService.ACTION.DONATION_CREATED
AuditLogService.ACTION.DONATION_VERIFIED
AuditLogService.ACTION.DONATION_STATUS_UPDATED
AuditLogService.ACTION.TRANSACTION_RECORDED

// Rate Limiting & Abuse
AuditLogService.ACTION.RATE_LIMIT_EXCEEDED
AuditLogService.ACTION.ABUSE_DETECTED
AuditLogService.ACTION.IP_FLAGGED
AuditLogService.ACTION.REPLAY_DETECTED
```

## Database Schema

```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  severity TEXT NOT NULL,
  result TEXT NOT NULL,
  userId TEXT,
  requestId TEXT,
  ipAddress TEXT,
  resource TEXT,
  reason TEXT,
  details TEXT,
  integrityHash TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_category ON audit_logs(category);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX idx_audit_logs_userId ON audit_logs(userId);
CREATE INDEX idx_audit_logs_requestId ON audit_logs(requestId);
```

## Migration

Run the migration to create the audit logs table:

```bash
node src/scripts/migrations/addAuditLogsTable.js
```

## Best Practices

### 1. Always Log Security-Sensitive Operations

```javascript
// ✅ Good: Log both success and failure
if (isValid) {
  await AuditLogService.log({ /* success */ });
  return next();
} else {
  await AuditLogService.log({ /* failure */ });
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### 2. Use Appropriate Severity Levels

- **HIGH**: Authentication failures, permission denials, API key operations
- **MEDIUM**: Configuration changes, wallet operations, rate limiting
- **LOW**: Successful authentication, read operations

### 3. Include Contextual Information

```javascript
// ✅ Good: Rich context for investigation
await AuditLogService.log({
  category: AuditLogService.CATEGORY.AUTHENTICATION,
  action: AuditLogService.ACTION.API_KEY_VALIDATION_FAILED,
  severity: AuditLogService.SEVERITY.HIGH,
  result: 'FAILURE',
  userId: null,
  requestId: req.id,
  ipAddress: req.ip,
  resource: req.path,
  reason: 'Invalid API key format',
  details: {
    keyPrefix: apiKey.substring(0, 8) + '...',
    userAgent: req.get('User-Agent'),
    method: req.method
  }
});
```

### 4. Never Log Sensitive Data

```javascript
// ❌ Bad: Exposes sensitive data
details: {
  apiKey: 'sk_live_1234567890',
  password: 'secret123'
}

// ✅ Good: Sanitized automatically by AuditLogService
details: {
  keyPrefix: 'sk_live_12...',
  role: 'admin'
}
```

### 5. Handle Audit Logging Failures Gracefully

```javascript
// ✅ Good: Don't block operations if audit logging fails
try {
  await AuditLogService.log({ /* ... */ });
} catch (error) {
  console.error('Audit log failed:', error);
  // Continue with operation
}

// Or use .catch() for non-blocking
AuditLogService.log({ /* ... */ }).catch(err => {
  console.error('Audit log failed:', err);
});
```

## Monitoring and Alerting

### High-Severity Events

Monitor these events for security incidents:

1. **Multiple Failed Authentication Attempts**
   - Action: `API_KEY_VALIDATION_FAILED`
   - Threshold: 5+ failures from same IP in 5 minutes

2. **Admin Access Denials**
   - Action: `ADMIN_ACCESS_DENIED`
   - Alert on any occurrence

3. **API Key Revocations**
   - Action: `API_KEY_REVOKED`
   - Alert on any occurrence

4. **Rate Limit Exceeded**
   - Action: `RATE_LIMIT_EXCEEDED`
   - Threshold: 10+ occurrences from same IP

5. **IP Flagging**
   - Action: `IP_FLAGGED`
   - Alert on any occurrence

### Query Examples

```javascript
// Find failed authentication attempts in last hour
const failedAuth = await AuditLogService.query({
  category: AuditLogService.CATEGORY.AUTHENTICATION,
  result: 'FAILURE',
  startDate: new Date(Date.now() - 3600000).toISOString()
});

// Find all admin operations today
const adminOps = await AuditLogService.query({
  action: AuditLogService.ACTION.ADMIN_ACCESS_GRANTED,
  startDate: new Date().toISOString().split('T')[0] + 'T00:00:00Z'
});

// Get security statistics for the month
const stats = await AuditLogService.getStatistics({
  severity: AuditLogService.SEVERITY.HIGH,
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-01-31T23:59:59Z'
});
```

## Compliance

Audit logs support compliance with:

- **SOC 2**: Security monitoring and incident response
- **PCI DSS**: Access control and audit trail requirements
- **GDPR**: Data access logging and breach detection
- **ISO 27001**: Information security management

### Retention Policy

- **Minimum**: 90 days for operational security
- **Recommended**: 1 year for compliance
- **Long-term**: Archive to cold storage for legal requirements

## Testing

Run audit log tests:

```bash
npm test tests/audit-logs.test.js
```

Tests cover:
- Audit log creation with integrity hashing
- Query and filtering capabilities
- Sensitive data masking
- Immutability verification
- Statistics generation

## Troubleshooting

### Audit Logs Not Being Created

1. Check database table exists:
   ```bash
   node src/scripts/migrations/addAuditLogsTable.js
   ```

2. Verify database permissions

3. Check application logs for errors

### Integrity Verification Failures

If `verifyIntegrity()` returns false:

1. **Database tampering detected** - Investigate immediately
2. Check for database corruption
3. Review database access logs
4. Consider forensic analysis

### Performance Issues

If audit logging impacts performance:

1. Ensure indexes are created (see migration script)
2. Use `.catch()` for non-blocking audit logs
3. Consider async queue for high-volume operations
4. Archive old logs to separate table

## Future Enhancements

- [ ] Export audit logs to external SIEM systems
- [ ] Real-time alerting for high-severity events
- [ ] Audit log visualization dashboard
- [ ] Automated compliance reporting
- [ ] Blockchain-based immutability (Stellar ledger)
- [ ] Machine learning for anomaly detection

## Support

For questions or issues:
- Review this documentation
- Check test files for examples
- Open an issue on GitHub
- Contact the security team
