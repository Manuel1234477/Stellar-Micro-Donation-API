# Memo Feature Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the memo feature to production environments.

## Pre-Deployment Checklist

### Code Review
- [ ] All code changes reviewed and approved
- [ ] Security review completed
- [ ] Tests passing (unit, integration, E2E)
- [ ] Linting passes without errors
- [ ] Documentation updated

### Database
- [ ] Migration script tested on staging
- [ ] Backup strategy in place
- [ ] Rollback plan documented
- [ ] Database permissions verified

### Testing
- [ ] Unit tests pass: `npm test tests/memo-validation.test.js`
- [ ] Integration tests pass: `npm test tests/memo-integration.test.js`
- [ ] Manual testing completed
- [ ] Security testing completed
- [ ] Performance testing completed

### Dependencies
- [ ] All dependencies up to date
- [ ] No critical security vulnerabilities: `npm audit`
- [ ] Production dependencies verified
- [ ] Node.js version compatibility confirmed

## Deployment Steps

### Step 1: Backup Database

```bash
# Create backup of production database
DATE=$(date +%Y%m%d_%H%M%S)
cp data/stellar_donations.db data/backups/stellar_donations_${DATE}.db

# Verify backup
ls -lh data/backups/stellar_donations_${DATE}.db
```

### Step 2: Deploy Code

#### Option A: Git Deployment

```bash
# On production server
cd /path/to/stellar-micro-donation-api

# Fetch latest changes
git fetch origin

# Checkout specific version/tag
git checkout v1.1.0  # or specific commit/branch

# Install dependencies
npm ci --production

# Verify installation
npm list
```

#### Option B: Docker Deployment

```bash
# Build Docker image
docker build -t stellar-donation-api:1.1.0 .

# Tag for registry
docker tag stellar-donation-api:1.1.0 registry.example.com/stellar-donation-api:1.1.0

# Push to registry
docker push registry.example.com/stellar-donation-api:1.1.0

# Deploy on production
docker pull registry.example.com/stellar-donation-api:1.1.0
docker stop stellar-donation-api
docker run -d --name stellar-donation-api \
  -p 3000:3000 \
  -v /data:/app/data \
  registry.example.com/stellar-donation-api:1.1.0
```

### Step 3: Run Database Migration

```bash
# Run migration script
npm run migrate:memo

# Expected output:
# ✓ Connected to database
# ✓ Successfully added memo column to transactions table
# ✓ Memo column verified
# ✓ Migration completed successfully
```

#### Verify Migration

```bash
# Check database schema
sqlite3 data/stellar_donations.db "PRAGMA table_info(transactions);"

# Expected output should include:
# 4|memo|TEXT|0||0
```

### Step 4: Verify Deployment

```bash
# Test memo feature
npm run test:memo

# Test API endpoint
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: deploy-test-$(date +%s)" \
  -d '{
    "amount": 1.0,
    "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNOD...",
    "recipient": "GBBD47UZQ5EYJYJMZXZYDUC77SAZXSQEA7XJJG...",
    "memo": "Deployment test"
  }'
```

### Step 5: Monitor Application

```bash
# Check application logs
tail -f logs/app.log

# Monitor for errors
grep -i error logs/app.log

# Check system resources
top
df -h
```

### Step 6: Smoke Testing

Run these tests to verify basic functionality:

```bash
# Test 1: Create donation with memo
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-test-1" \
  -d '{"amount": 5.0, "recipient": "G...", "memo": "Test 1"}'

# Test 2: Create donation without memo
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-test-2" \
  -d '{"amount": 5.0, "recipient": "G..."}'

# Test 3: Retrieve donations
curl http://localhost:3000/donations

# Test 4: Test memo validation (should fail)
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-test-3" \
  -d '{"amount": 5.0, "recipient": "G...", "memo": "'$(python3 -c 'print("a"*50)')'"}'
```

## Rollback Procedure

If issues are detected after deployment:

### Step 1: Stop Application

```bash
# If using systemd
sudo systemctl stop stellar-donation-api

# If using Docker
docker stop stellar-donation-api

# If using PM2
pm2 stop stellar-donation-api
```

### Step 2: Restore Database

```bash
# Restore from backup
cp data/backups/stellar_donations_YYYYMMDD_HHMMSS.db data/stellar_donations.db

# Verify restoration
sqlite3 data/stellar_donations.db "SELECT COUNT(*) FROM transactions;"
```

### Step 3: Revert Code

```bash
# Checkout previous version
git checkout v1.0.0

# Reinstall dependencies
npm ci --production
```

### Step 4: Restart Application

```bash
# If using systemd
sudo systemctl start stellar-donation-api

# If using Docker
docker start stellar-donation-api

# If using PM2
pm2 start stellar-donation-api
```

### Step 5: Verify Rollback

```bash
# Test basic functionality
curl http://localhost:3000/donations

# Check logs
tail -f logs/app.log
```

## Environment-Specific Configurations

### Development

```bash
# .env.development
NODE_ENV=development
PORT=3000
DB_PATH=./data/stellar_donations.db
STELLAR_NETWORK=testnet
LOG_LEVEL=debug
```

### Staging

```bash
# .env.staging
NODE_ENV=staging
PORT=3000
DB_PATH=/var/lib/stellar-donation/stellar_donations.db
STELLAR_NETWORK=testnet
LOG_LEVEL=info
```

### Production

```bash
# .env.production
NODE_ENV=production
PORT=3000
DB_PATH=/var/lib/stellar-donation/stellar_donations.db
STELLAR_NETWORK=mainnet
LOG_LEVEL=warn
ENABLE_RATE_LIMITING=true
```

## Monitoring and Alerting

### Key Metrics to Monitor

1. **API Response Times**
   - Endpoint: POST /donations
   - Target: < 200ms p95
   - Alert: > 500ms p95

2. **Error Rates**
   - Target: < 1% error rate
   - Alert: > 5% error rate

3. **Database Performance**
   - Query time: < 50ms average
   - Alert: > 200ms average

4. **Memo Validation Failures**
   - Track MEMO_TOO_LONG errors
   - Track INVALID_MEMO_TYPE errors
   - Alert: Sudden spike in validation errors

### Log Monitoring

```bash
# Monitor for memo-related errors
tail -f logs/app.log | grep -i memo

# Monitor for validation errors
tail -f logs/app.log | grep -i "MEMO_TOO_LONG\|INVALID_MEMO"

# Monitor for database errors
tail -f logs/app.log | grep -i "database\|sqlite"
```

## Performance Considerations

### Database Indexing

If memo searches are needed:

```sql
-- Create index on memo column (optional)
CREATE INDEX idx_transactions_memo ON transactions(memo);
```

### Caching

Consider caching for frequently accessed data:

```javascript
// Example: Cache recent donations
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

router.get('/donations/recent', (req, res) => {
  const cached = cache.get('recent_donations');
  if (cached) {
    return res.json(cached);
  }
  
  // Fetch from database
  const donations = Transaction.getRecent(10);
  cache.set('recent_donations', donations);
  res.json(donations);
});
```

## Security Hardening

### Production Security Checklist

- [ ] HTTPS enabled (SSL/TLS certificates)
- [ ] Rate limiting configured
- [ ] CORS properly configured
- [ ] Security headers set (Helmet.js)
- [ ] Input validation enabled
- [ ] SQL injection protection verified
- [ ] XSS protection enabled
- [ ] Secrets stored securely (not in code)
- [ ] Database access restricted
- [ ] Logging configured (no sensitive data)
- [ ] Error messages sanitized
- [ ] Dependencies audited

### Recommended Security Headers

```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

## Troubleshooting

### Issue: Migration fails with "column already exists"

**Solution**: This is expected if migration was already run. Verify with:

```bash
sqlite3 data/stellar_donations.db "PRAGMA table_info(transactions);" | grep memo
```

### Issue: Memo validation always fails

**Diagnosis**:
```bash
# Check MemoValidator is imported correctly
grep -r "require.*memoValidator" src/

# Test validator directly
node -e "const MV = require('./src/utils/memoValidator'); console.log(MV.validate('test'));"
```

### Issue: Memos not appearing in API responses

**Diagnosis**:
```bash
# Check database has memo column
sqlite3 data/stellar_donations.db "PRAGMA table_info(transactions);"

# Check if memos are stored
sqlite3 data/stellar_donations.db "SELECT id, memo FROM transactions LIMIT 5;"

# Check Transaction model includes memo
grep -A 10 "create(transactionData)" src/routes/models/transaction.js
```

### Issue: Performance degradation

**Diagnosis**:
```bash
# Check database size
ls -lh data/stellar_donations.db

# Check query performance
sqlite3 data/stellar_donations.db "EXPLAIN QUERY PLAN SELECT * FROM transactions WHERE memo LIKE '%test%';"

# Monitor system resources
top
iostat -x 1
```

## Post-Deployment Tasks

### Day 1
- [ ] Monitor error logs continuously
- [ ] Check API response times
- [ ] Verify memo validation working
- [ ] Monitor database performance
- [ ] Check for any user-reported issues

### Week 1
- [ ] Review error rates and patterns
- [ ] Analyze memo usage statistics
- [ ] Check for any security issues
- [ ] Gather user feedback
- [ ] Optimize if needed

### Month 1
- [ ] Performance review
- [ ] Security audit
- [ ] User satisfaction survey
- [ ] Plan improvements
- [ ] Update documentation

## Support and Maintenance

### Regular Maintenance Tasks

**Daily**:
- Monitor error logs
- Check system health
- Verify backups

**Weekly**:
- Review performance metrics
- Check for security updates
- Analyze usage patterns

**Monthly**:
- Update dependencies
- Security audit
- Performance optimization
- Backup verification

### Getting Help

- Documentation: See MEMO_FEATURE.md
- Security: See MEMO_SECURITY.md
- Issues: GitHub Issues
- Support: support@example.com

## Version History

- **v1.1.0** (2026-02-20): Memo feature deployment
  - Added memo column to transactions table
  - Implemented memo validation
  - Added security measures
  - Updated API endpoints
