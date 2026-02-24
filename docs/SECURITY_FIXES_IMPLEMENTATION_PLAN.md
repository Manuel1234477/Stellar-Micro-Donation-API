# Security Fixes Implementation Plan

## Overview
This document provides a prioritized, actionable plan to address the security vulnerabilities identified in the donation flow audit.

---

## Phase 1: Critical Fixes (Week 1) - IMMEDIATE ACTION REQUIRED

### Fix 1.1: Add Authentication to /donations/send
**File**: `src/routes/donation.js`  
**Priority**: P0 - CRITICAL

```javascript
// BEFORE (VULNERABLE)
router.post('/send', async (req, res) => {

// AFTER (SECURE)
router.post('/send', 
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  checkWalletOwnership, // New middleware
  async (req, res) => {
```

**New Middleware** (`src/middleware/walletOwnership.js`):
```javascript
async function checkWalletOwnership(req, res, next) {
  const { senderId } = req.body;
  const userId = req.user.id;
  
  const wallet = await Database.get(
    'SELECT userId FROM users WHERE id = ?',
    [senderId]
  );
  
  if (!wallet || wallet.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: 'You do not own this wallet'
    });
  }
  
  next();
}
```

---

### Fix 1.2: Implement Idempotency Key Checking
**File**: `src/routes/donation.js`  
**Priority**: P0 - CRITICAL

```javascript
// Add to POST /donations endpoint
const idempotencyKey = req.headers['idempotency-key'];

if (!idempotencyKey) {
  return res.status(400).json({
    success: false,
    error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency key is required' }
  });
}

// CHECK IF KEY WAS ALREADY USED
const existingTransaction = await Transaction.getByIdempotencyKey(idempotencyKey);
if (existingTransaction) {
  // Return existing transaction (idempotent response)
  return res.status(200).json({
    success: true,
    data: existingTransaction,
    message: 'Transaction already processed (idempotent)'
  });
}
```

**Update Transaction Model** (`src/routes/models/transaction.js`):
```javascript
static getByIdempotencyKey(key) {
  const transactions = this.getAll();
  return transactions.find(tx => tx.idempotencyKey === key);
}
```

---

### Fix 1.3: Add Rate Limiting
**File**: `src/routes/app.js`  
**Priority**: P0 - CRITICAL

```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for donation endpoints
const donationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 donations per minute
  message: 'Too many donation requests, please slow down',
  keyGenerator: (req) => {
    // Rate limit by user ID if authenticated, otherwise by IP
    return req.user?.id || req.ip;
  }
});

// Apply limiters
app.use('/api/', apiLimiter);
app.use('/donations', donationLimiter);
```

---

### Fix 1.4: Add Balance Check Before Transaction
**File**: `src/routes/donation.js`  
**Priority**: P0 - CRITICAL

```javascript
// Add before Stellar transaction
const STELLAR_BASE_FEE = 0.00001; // 100 stroops
const balance = await stellarService.getBalance(sender.publicKey);
const balanceNum = parseFloat(balance.balance);
const amountNum = parseFloat(amount);
const totalRequired = amountNum + STELLAR_BASE_FEE;

if (balanceNum < totalRequired) {
  return res.status(400).json({
    success: false,
    error: {
      code: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient balance to complete transaction',
      required: totalRequired,
      available: balanceNum,
      fee: STELLAR_BASE_FEE
    }
  });
}
```

---

### Fix 1.5: Implement Transaction Atomicity
**File**: `src/routes/donation.js`  
**Priority**: P0 - CRITICAL

```javascript
// Wrap in try-catch with proper rollback
try {
  // 1. Create pending transaction record
  const pendingTx = await Database.run(
    `INSERT INTO transactions 
     (senderId, receiverId, amount, memo, status, timestamp) 
     VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    [senderId, receiverId, amount, memo]
  );

  // 2. Execute Stellar transaction
  let stellarResult;
  try {
    stellarResult = await stellarService.sendDonation({
      sourceSecret: secret,
      destinationPublic: receiver.publicKey,
      amount: amount,
      memo: memo
    });
  } catch (stellarError) {
    // Update status to failed
    await Database.run(
      'UPDATE transactions SET status = ?, errorMessage = ? WHERE id = ?',
      ['failed', stellarError.message, pendingTx.id]
    );
    throw stellarError;
  }

  // 3. Update transaction to confirmed
  await Database.run(
    `UPDATE transactions 
     SET status = 'confirmed', 
         stellarTxId = ?, 
         ledger = ?,
         confirmedAt = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [stellarResult.transactionId, stellarResult.ledger, pendingTx.id]
  );

  // 4. Return success
  res.status(201).json({
    success: true,
    data: {
      id: pendingTx.id,
      stellarTxId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
      amount: amount,
      status: 'confirmed'
    }
  });
} catch (error) {
  console.error('Transaction failed:', error);
  res.status(500).json({
    success: false,
    error: {
      code: 'TRANSACTION_FAILED',
      message: 'Failed to process transaction'
    }
  });
}
```

---

### Fix 1.6: Enhanced Amount Validation
**File**: `src/routes/donation.js`  
**Priority**: P0 - CRITICAL

```javascript
function validateAmount(amount) {
  // Parse amount
  const amountNum = parseFloat(amount);
  
  // Check if finite number
  if (!Number.isFinite(amountNum)) {
    return {
      valid: false,
      error: 'Amount must be a finite number'
    };
  }
  
  // Check if positive
  if (amountNum <= 0) {
    return {
      valid: false,
      error: 'Amount must be greater than zero'
    };
  }
  
  // Check if within safe integer range
  if (amountNum > Number.MAX_SAFE_INTEGER) {
    return {
      valid: false,
      error: 'Amount exceeds maximum safe value'
    };
  }
  
  // Check Stellar minimum (0.0000001 XLM = 1 stroop)
  if (amountNum < 0.0000001) {
    return {
      valid: false,
      error: 'Amount below Stellar minimum (0.0000001 XLM)'
    };
  }
  
  // Check decimal precision (Stellar max 7 decimals)
  const amountStr = amount.toString();
  const decimals = amountStr.split('.')[1];
  if (decimals && decimals.length > 7) {
    return {
      valid: false,
      error: 'Amount cannot have more than 7 decimal places'
    };
  }
  
  // Check for scientific notation
  if (amountStr.toLowerCase().includes('e')) {
    return {
      valid: false,
      error: 'Scientific notation not allowed'
    };
  }
  
  return { valid: true, amount: amountNum };
}

// Use in endpoint
const validation = validateAmount(amount);
if (!validation.valid) {
  return res.status(400).json({
    success: false,
    error: validation.error
  });
}
```

---

### Fix 1.7: Add Transaction Timeout
**File**: `src/routes/donation.js`  
**Priority**: P0 - CRITICAL

```javascript
const TRANSACTION_TIMEOUT = 30000; // 30 seconds

try {
  const stellarResult = await Promise.race([
    stellarService.sendDonation({
      sourceSecret: secret,
      destinationPublic: receiver.publicKey,
      amount: amount,
      memo: memo
    }),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Transaction timeout')), TRANSACTION_TIMEOUT)
    )
  ]);
  
  // Process result...
} catch (error) {
  if (error.message === 'Transaction timeout') {
    return res.status(408).json({
      success: false,
      error: {
        code: 'TRANSACTION_TIMEOUT',
        message: 'Transaction timed out after 30 seconds'
      }
    });
  }
  throw error;
}
```

---

### Fix 1.8: Improve Encryption Key Management
**File**: `src/utils/encryption.js`  
**Priority**: P0 - CRITICAL

```javascript
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment
 * MUST be set in production, no fallback
 */
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  
  // NO FALLBACK - Always require key
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  
  // Validate key format (should be base64 encoded 32-byte key)
  let keyBuffer;
  try {
    keyBuffer = Buffer.from(key, 'base64');
  } catch (error) {
    throw new Error('ENCRYPTION_KEY must be base64 encoded');
  }
  
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (base64 encoded)`);
  }
  
  return keyBuffer;
};

// Generate new key (for initial setup)
const generateEncryptionKey = () => {
  const key = crypto.randomBytes(KEY_LENGTH);
  return key.toString('base64');
};

module.exports = {
  encrypt,
  decrypt,
  generateEncryptionKey // For setup only
};
```

**Setup Script** (`scripts/generate-encryption-key.js`):
```javascript
const { generateEncryptionKey } = require('../src/utils/encryption');

console.log('Generated Encryption Key (add to .env):');
console.log('ENCRYPTION_KEY=' + generateEncryptionKey());
console.log('\n⚠️  IMPORTANT: Store this key securely and never commit it to version control!');
```

---

### Fix 1.9: Add Request Size Limits
**File**: `src/routes/app.js`  
**Priority**: P0 - CRITICAL

```javascript
// Limit request body size
app.use(express.json({ 
  limit: '10kb',
  strict: true
}));

// Limit URL-encoded data
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10kb' 
}));

// Add parameter pollution protection
const hpp = require('hpp');
app.use(hpp());
```

---

### Fix 1.10: Implement CSRF Protection
**File**: `src/routes/app.js`  
**Priority**: P0 - CRITICAL

```bash
npm install csurf cookie-parser
```

```javascript
const csrf = require('csurf');
const cookieParser = require('cookie-parser');

// Enable cookie parser
app.use(cookieParser());

// CSRF protection
const csrfProtection = csrf({ 
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
});

// Apply to state-changing routes
app.use('/donations', csrfProtection);
app.use('/wallets', csrfProtection);
app.use('/stream', csrfProtection);

// Endpoint to get CSRF token
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Error handler for CSRF failures
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'INVALID_CSRF_TOKEN',
        message: 'Invalid or missing CSRF token'
      }
    });
  }
  next(err);
});
```

---

## Phase 2: High Priority Fixes (Week 2-4)

### Fix 2.1: Implement Audit Logging
**File**: `src/utils/auditLog.js` (new file)

```javascript
const Database = require('./database');

class AuditLog {
  static async log(action, details) {
    await Database.run(
      `INSERT INTO audit_logs 
       (timestamp, action, userId, details, ipAddress, userAgent) 
       VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
      [
        action,
        details.userId || null,
        JSON.stringify(details),
        details.ipAddress || null,
        details.userAgent || null
      ]
    );
  }
  
  static async logDonation(req, transaction) {
    await this.log('DONATION_CREATED', {
      userId: req.user?.id,
      transactionId: transaction.id,
      amount: transaction.amount,
      sender: transaction.sender,
      receiver: transaction.receiver,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
  }
}

module.exports = AuditLog;
```

**Migration** (`src/scripts/addAuditLogsTable.js`):
```javascript
const Database = require('../utils/database');

async function addAuditLogsTable() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      action VARCHAR(50) NOT NULL,
      userId INTEGER,
      details TEXT,
      ipAddress VARCHAR(45),
      userAgent TEXT,
      INDEX idx_timestamp (timestamp),
      INDEX idx_action (action),
      INDEX idx_userId (userId)
    )
  `);
  
  console.log('Audit logs table created successfully');
}

addAuditLogsTable().catch(console.error);
```

---

### Fix 2.2: Improve Error Handling
**File**: `src/routes/donation.js`

```javascript
// Production-safe error handler
function handleError(error, req, res) {
  // Log full error internally
  console.error('[Donation Error]', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  });
  
  // Return safe error to client
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({
      success: false,
      error: {
        code: 'TRANSACTION_ERROR',
        message: 'Transaction failed. Please try again later.',
        timestamp: new Date().toISOString()
      }
    });
  } else {
    // Detailed errors in development
    res.status(500).json({
      success: false,
      error: {
        code: error.code || 'TRANSACTION_ERROR',
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }
    });
  }
}
```

---

### Fix 2.3: Add Concurrent Transaction Protection
**File**: `src/utils/transactionLock.js` (new file)

```bash
npm install redis
```

```javascript
const redis = require('redis');
const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.connect();

class TransactionLock {
  static async acquireLock(walletId, timeout = 30000) {
    const lockKey = `lock:wallet:${walletId}`;
    const lockValue = Date.now() + timeout;
    
    const acquired = await client.set(lockKey, lockValue, {
      NX: true, // Only set if not exists
      PX: timeout // Expire after timeout
    });
    
    return acquired !== null;
  }
  
  static async releaseLock(walletId) {
    const lockKey = `lock:wallet:${walletId}`;
    await client.del(lockKey);
  }
  
  static async withLock(walletId, operation) {
    const acquired = await this.acquireLock(walletId);
    
    if (!acquired) {
      throw new Error('Another transaction is in progress for this wallet');
    }
    
    try {
      return await operation();
    } finally {
      await this.releaseLock(walletId);
    }
  }
}

module.exports = TransactionLock;
```

**Usage in donation endpoint**:
```javascript
const TransactionLock = require('../utils/transactionLock');

router.post('/send', async (req, res) => {
  const { senderId } = req.body;
  
  try {
    const result = await TransactionLock.withLock(senderId, async () => {
      // Execute transaction logic here
      // ...
    });
    
    res.json(result);
  } catch (error) {
    if (error.message.includes('in progress')) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TRANSACTION_IN_PROGRESS',
          message: 'Another transaction is already in progress for this wallet'
        }
      });
    }
    throw error;
  }
});
```

---

## Phase 3: Testing & Validation

### Security Test Suite
**File**: `tests/security.test.js` (new file)

```javascript
const request = require('supertest');
const app = require('../src/routes/app');

describe('Security Tests', () => {
  describe('Authentication', () => {
    it('should block unauthenticated donation requests', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: 1,
          receiverId: 2,
          amount: 10
        });
      
      expect(response.status).toBe(403);
    });
  });
  
  describe('Rate Limiting', () => {
    it('should rate limit excessive requests', async () => {
      const requests = [];
      for (let i = 0; i < 15; i++) {
        requests.push(
          request(app)
            .post('/donations')
            .set('x-api-key', 'test-key')
            .send({ amount: 1, recipient: 'GTEST' })
        );
      }
      
      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
  
  describe('Input Validation', () => {
    it('should reject invalid amounts', async () => {
      const invalidAmounts = [
        'Infinity',
        '-1',
        '1e100',
        '0.00000001', // Too many decimals
        'NaN',
        null,
        undefined
      ];
      
      for (const amount of invalidAmounts) {
        const response = await request(app)
          .post('/donations')
          .set('x-api-key', 'test-key')
          .send({ amount, recipient: 'GTEST' });
        
        expect(response.status).toBe(400);
      }
    });
  });
  
  describe('Idempotency', () => {
    it('should prevent duplicate transactions', async () => {
      const idempotencyKey = 'test-' + Date.now();
      
      const response1 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({ amount: 10, recipient: 'GTEST' });
      
      const response2 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({ amount: 10, recipient: 'GTEST' });
      
      expect(response1.status).toBe(201);
      expect(response2.status).toBe(200);
      expect(response1.body.data.id).toBe(response2.body.data.id);
    });
  });
});
```

---

## Implementation Checklist

### Week 1 (Critical Fixes)
- [ ] Add authentication to /donations/send
- [ ] Implement idempotency key checking
- [ ] Add rate limiting
- [ ] Add balance checks
- [ ] Implement transaction atomicity
- [ ] Enhanced amount validation
- [ ] Add transaction timeout
- [ ] Improve encryption key management
- [ ] Add request size limits
- [ ] Implement CSRF protection

### Week 2-4 (High Priority)
- [ ] Implement audit logging
- [ ] Improve error handling
- [ ] Add concurrent transaction protection
- [ ] Add ownership verification middleware
- [ ] Implement transaction status validation
- [ ] Add security test suite

### Testing
- [ ] Run security test suite
- [ ] Perform penetration testing
- [ ] Load testing with rate limits
- [ ] Test idempotency handling
- [ ] Test concurrent transactions

### Documentation
- [ ] Update API documentation
- [ ] Document security controls
- [ ] Create runbook for incidents
- [ ] Update deployment guide

---

## Deployment Plan

### Pre-Deployment
1. Review all code changes
2. Run full test suite
3. Perform security scan
4. Update environment variables
5. Backup database

### Deployment Steps
1. Deploy to staging environment
2. Run smoke tests
3. Perform security validation
4. Deploy to production (off-peak hours)
5. Monitor for 24 hours

### Post-Deployment
1. Verify all endpoints working
2. Check audit logs
3. Monitor error rates
4. Review security alerts
5. Document any issues

---

## Success Criteria

- [ ] All critical vulnerabilities fixed
- [ ] Security test suite passing
- [ ] No regression in functionality
- [ ] Performance within acceptable limits
- [ ] Audit logging operational
- [ ] Rate limiting effective
- [ ] Zero security incidents in first week

---

**Document Version**: 1.0  
**Last Updated**: February 22, 2026  
**Next Review**: After Phase 1 completion
