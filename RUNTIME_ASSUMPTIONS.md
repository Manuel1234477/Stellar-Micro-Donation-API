# Runtime Environment Assumptions

**Last Updated:** 2026-02-26  
**Version:** 1.0.0  
**Status:** ✅ Validated

## Table of Contents

- [Introduction](#introduction)
- [Quick Reference](#quick-reference)
- [Network Configuration](#network-configuration)
- [Persistence Layer](#persistence-layer)
- [Background Services](#background-services)
- [Resource Requirements](#resource-requirements)
- [Configuration Reference](#configuration-reference)
- [Test Environment](#test-environment)
- [Production Deployment](#production-deployment)
- [Operational Procedures](#operational-procedures)

## Introduction

### Purpose

This document makes explicit all runtime environment assumptions for the Stellar Micro-Donation API. Understanding these assumptions is critical for:

- **Operators**: Deploying and configuring the system correctly
- **Developers**: Writing code that aligns with system expectations
- **SREs**: Monitoring, troubleshooting, and maintaining production deployments

### Audience

- System operators responsible for deployment and configuration
- DevOps engineers managing infrastructure
- Developers contributing to the codebase
- Site Reliability Engineers monitoring production systems

### Document Conventions

- **Configuration values**: Displayed in code blocks with explicit units
- **Environment variables**: Shown in `CONSTANT_CASE` with default values
- **⚠️ Warnings**: Production-critical information highlighted
- **Examples**: Provided in fenced code blocks
- **Cross-references**: Internal links to related sections

## Quick Reference

Critical runtime values at a glance:

| Configuration Item | Default Value | Environment Variable | Configurable | Section |
|-------------------|---------------|---------------------|--------------|---------|
| Stellar SDK Timeout | 30 seconds | N/A | No | [Network Configuration](#network-configuration) |
| Stellar Retry Attempts | 3 attempts | N/A | No | [Network Configuration](#network-configuration) |
| Retry Initial Backoff | 1 second | N/A | No | [Network Configuration](#network-configuration) |
| Retry Max Backoff | 30 seconds | N/A | No | [Network Configuration](#network-configuration) |
| Database Path | `./donations.db` | `DB_PATH` | Yes | [Persistence Layer](#persistence-layer) |
| JSON Storage Path | `./data/donations.json` | `DB_JSON_PATH` | Yes | [Persistence Layer](#persistence-layer) |
| Recurring Donation Check | 60 seconds | N/A | No | [Background Services](#background-services) |
| Transaction Reconciliation | 5 minutes | N/A | No | [Background Services](#background-services) |
| Abuse Detection Cleanup | 10 minutes | N/A | No | [Background Services](#background-services) |
| Replay Detection Cleanup | Configurable | `cleanupIntervalSeconds` | Yes | [Background Services](#background-services) |
| Jest Test Timeout | 10 seconds | N/A | No | [Test Environment](#test-environment) |
| Mock Stellar Mode | `false` | `MOCK_STELLAR` | Yes | [Test Environment](#test-environment) |

## Network Configuration

### Timeouts

#### Stellar SDK Timeout

**Value:** 30 seconds  
**Configurable:** No  
**Location:** `src/services/StellarService.js`

```javascript
.setTimeout(30)
```

The Stellar SDK enforces a 30-second timeout for all blockchain operations including:
- Account loading
- Balance queries
- Transaction submission
- Transaction verification
- Transaction history retrieval

**Infrastructure Considerations:**
- Load balancers should have timeouts > 30 seconds
- Reverse proxies should allow at least 35 seconds
- API gateways should configure 40+ second timeouts to account for retry logic

#### HTTP Request Timeout

**Value:** No explicit timeout configured  
**Behavior:** Relies on Node.js default socket timeout (2 minutes)  
**Configurable:** No (would require code changes)

#### Database Connection Timeout

**Value:** SQLite default (no explicit timeout)  
**Behavior:** Immediate connection or failure  
**Configurable:** No

### Retry Logic

#### Stellar Operations Retry Policy

**Max Attempts:** 3  
**Backoff Strategy:** Exponential with jitter  
**Initial Delay:** 1 second  
**Max Delay:** 30 seconds  
**Multiplier:** 2x  
**Location:** `src/services/StellarService.js`

**Retry Sequence Example:**
1. Attempt 1: Immediate
2. Attempt 2: After ~1 second (1s + jitter)
3. Attempt 3: After ~2 seconds (2s + jitter)

**Retryable Errors:**
- Network timeouts
- Connection refused
- Socket hang up
- Network errors
- Service unavailable (503)

**Non-Retryable Errors:**
- Invalid account (404)
- Insufficient balance
- Bad sequence number (requires fresh account load)
- Invalid transaction format

#### Recurring Donation Retry Policy

**Max Attempts:** 3  
**Backoff Strategy:** Exponential with jitter  
**Initial Delay:** 1 second  
**Max Delay:** 30 seconds  
**Multiplier:** 2x  
**Location:** `src/services/RecurringDonationScheduler.js`

**Jitter Calculation:**
```javascript
const jitter = Math.random() * 0.3 * backoff;
const actualDelay = backoff + jitter;
```

Jitter prevents thundering herd problems when multiple operations retry simultaneously.

#### Operations Without Retry Logic

The following operations fail immediately without retry:
- Database queries (fail fast to detect issues quickly)
- Configuration validation (deterministic, no benefit from retry)
- API key validation (deterministic)
- Manual API requests (client responsible for retry)

### External Dependencies

#### Stellar Horizon API (Required)

**Testnet Endpoint:** `https://horizon-testnet.stellar.org`  
**Mainnet Endpoint:** `https://horizon.stellar.org`  
**Futurenet Endpoint:** `https://horizon-futurenet.stellar.org`

**Configuration:**
```bash
# Use testnet (default for development)
STELLAR_NETWORK=testnet

# Use mainnet (production)
STELLAR_NETWORK=mainnet

# Override with custom endpoint
HORIZON_URL=https://custom-horizon.example.com
```

**Network Connectivity:** The system requires persistent network connectivity to the Stellar Horizon API for normal operation. Transient network failures are handled through retry logic, but prolonged outages will prevent:
- New donation processing
- Balance queries
- Transaction verification
- Recurring donation execution

**Behavior When Unavailable:**
- Operations fail after 3 retry attempts
- Error messages indicate network connectivity issues
- Background services continue attempting on their schedules
- System remains operational for non-blockchain operations

**DNS Requirements:**
- Must resolve `horizon-testnet.stellar.org` (testnet)
- Must resolve `horizon.stellar.org` (mainnet)
- No hardcoded IP addresses (uses DNS resolution)

**Proxy Support:**
- Not explicitly configured
- Respects system-level HTTP_PROXY/HTTPS_PROXY environment variables (Node.js default behavior)

#### Mock Mode for Testing

**Environment Variable:** `MOCK_STELLAR`  
**Values:** `true` | `false`  
**Default:** `false`

```bash
# Enable mock mode (no real network calls)
MOCK_STELLAR=true
```

⚠️ **Production Warning:** Never set `MOCK_STELLAR=true` in production. This disables all real blockchain operations and simulates responses.

## Persistence Layer

### Database Configuration

#### SQLite Database

**Default Path:** `./donations.db`  
**Environment Variable:** `DB_PATH`  
**Type:** SQLite 3  
**Location:** Relative to project root

```bash
# Default (relative path)
DB_PATH=./donations.db

# Absolute path
DB_PATH=/var/lib/stellar-donations/db.sqlite

# Custom location
DB_PATH=/data/donations/production.db
```

**Directory Auto-Creation:** No  
The system does NOT automatically create parent directories. Ensure the directory exists before starting:

```bash
mkdir -p /var/lib/stellar-donations
```

**Required File Permissions:**
- Directory: `rwx` (700 or 755)
- Database file: `rw-` (600 or 644)
- User: Process owner must have read/write access

**Verification:**
```bash
# Check directory permissions
ls -ld /var/lib/stellar-donations

# Check file permissions
ls -l /var/lib/stellar-donations/db.sqlite
```

⚠️ **Production Warning:** SQLite is NOT recommended for high-concurrency production environments. SQLite uses file-level locking which can cause contention under heavy load. Consider PostgreSQL or MySQL for production deployments with > 100 concurrent users.

#### Optional JSON Storage

**Default Path:** `./data/donations.json`  
**Environment Variable:** `DB_JSON_PATH`  
**Usage:** Optional backup/export format

```bash
# Configure JSON storage path
DB_JSON_PATH=./data/donations.json
```

### Storage Requirements

#### Minimum Disk Space

**Installation:** ~50MB (including node_modules)  
**Database (empty):** ~100KB  
**Minimum Free Space:** 1GB recommended for operation

#### Database Growth Rates

**Per Transaction:** ~1-2KB  
**Estimated Growth:**
- Low volume (10 tx/day): ~7MB/year
- Medium volume (100 tx/day): ~70MB/year
- High volume (1000 tx/day): ~700MB/year

**Monitoring Recommendation:**
```bash
# Check database size
du -h ./donations.db

# Check available disk space
df -h .
```

### Backup Strategies

#### Recommended Backup Frequency

- **Development:** Not required
- **Staging:** Daily
- **Production:** Hourly + transaction log backup

#### Backup Methods

**Method 1: File System Snapshot**
```bash
# Stop the application first for consistency
systemctl stop stellar-donation-api

# Copy database file
cp ./donations.db ./backups/donations-$(date +%Y%m%d-%H%M%S).db

# Restart application
systemctl start stellar-donation-api
```

**Method 2: SQLite Backup API (Hot Backup)**
```bash
# Using SQLite CLI (no downtime required)
sqlite3 ./donations.db ".backup './backups/donations-$(date +%Y%m%d-%H%M%S).db'"
```

**Method 3: Automated Backup Script**
```bash
#!/bin/bash
# backup-db.sh
BACKUP_DIR="/var/backups/stellar-donations"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 ./donations.db ".backup '${BACKUP_DIR}/donations-${TIMESTAMP}.db'"
# Keep only last 30 days
find ${BACKUP_DIR} -name "donations-*.db" -mtime +30 -delete
```

#### Restoration Procedures

```bash
# Stop application
systemctl stop stellar-donation-api

# Restore from backup
cp ./backups/donations-20260226-120000.db ./donations.db

# Verify integrity
sqlite3 ./donations.db "PRAGMA integrity_check;"

# Restart application
systemctl start stellar-donation-api
```

#### Testing Backup Integrity

```bash
# Test backup file
sqlite3 ./backups/donations-backup.db "PRAGMA integrity_check;"

# Expected output: "ok"
```

## Background Services

### Service Inventory

| Service Name | Interval | Auto-Start | Configurable | Description |
|-------------|----------|------------|--------------|-------------|
| Recurring Donation Scheduler | 60 seconds | Yes | No | Processes due recurring donation schedules |
| Transaction Reconciliation | 5 minutes | Yes | No | Verifies pending transactions against blockchain |
| Abuse Detection Cleanup | 10 minutes | Yes | No | Removes old abuse detection tracking data |
| Replay Detection Cleanup | Configurable | Yes | Yes (`cleanupIntervalSeconds`) | Removes old replay detection fingerprints |
| Idempotency Cleanup | Manual | No | N/A | Purges expired idempotency records |

### Service Details

#### Recurring Donation Scheduler

**Interval:** 60 seconds  
**Auto-Start:** Yes (starts automatically with application)  
**Configurable:** No  
**Location:** `src/services/RecurringDonationScheduler.js`

**Behavior:**
- Checks for due recurring donations every 60 seconds
- Executes donations concurrently with duplicate prevention
- Retries failed donations up to 3 times with exponential backoff
- Logs all execution attempts to `recurring_donation_logs` table

**Overlap Handling:** Skip  
If a check cycle takes longer than 60 seconds, the next cycle waits until the current one completes. No concurrent executions of the same schedule.

**Dependencies:**
- Stellar Horizon API (for transaction submission)
- Database (for schedule queries and logging)

#### Transaction Reconciliation Service

**Interval:** 5 minutes (300 seconds)  
**Auto-Start:** Yes  
**Configurable:** No  
**Location:** `src/services/TransactionReconciliationService.js`

**Behavior:**
- Queries pending/submitted transactions from database
- Verifies each transaction against Stellar network
- Updates transaction status to confirmed if found on blockchain
- Skips reconciliation if previous cycle still running

**Overlap Handling:** Skip  
Sets `reconciliationInProgress` flag to prevent concurrent executions.

#### Abuse Detection Cleanup

**Interval:** 10 minutes (600 seconds)  
**Auto-Start:** Yes (except in test environment)  
**Configurable:** No  
**Location:** `src/utils/abuseDetector.js`

**Behavior:**
- Removes tracking data older than configured windows
- Cleans up flagged IPs after cooldown period (1 hour)
- Runs in background without blocking operations

#### Replay Detection Cleanup

**Interval:** Configurable via `cleanupIntervalSeconds`  
**Auto-Start:** Yes  
**Configurable:** Yes  
**Location:** `src/utils/replayDetector.js`

**Configuration:**
```javascript
// In src/config/replayDetection.js
{
  cleanupIntervalSeconds: 300, // 5 minutes default
  windowSeconds: 300 // 5 minute detection window
}
```

**Behavior:**
- Removes request fingerprints older than detection window
- Prevents memory growth from tracking store
- Logs cleanup statistics

#### Idempotency Cleanup

**Trigger:** Manual (admin endpoint)  
**Auto-Start:** No  
**Endpoint:** `POST /api-keys/cleanup`  
**Location:** `src/services/IdempotencyService.js`

**Usage:**
```bash
curl -X POST http://localhost:3000/api-keys/cleanup \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"retentionDays": 90}'
```

**Behavior:**
- Deletes idempotency records older than retention period
- Default retention: 90 days
- Requires admin role

### Service Lifecycle

#### Startup Sequence

1. Application starts
2. Database initialized
3. Background services start automatically:
   - Recurring Donation Scheduler
   - Transaction Reconciliation Service
   - Replay Detection Cleanup
   - Abuse Detection Cleanup (if not test environment)
4. Services begin their first execution cycle immediately
5. Subsequent cycles run at configured intervals

#### Shutdown Sequence

1. Application receives SIGTERM or SIGINT
2. HTTP server stops accepting new requests
3. Background services receive stop signal
4. Services complete current execution cycle (max 10 seconds wait)
5. Database connections closed
6. Application exits

**Impact of Stopping Services:**
- Recurring donations: Missed executions will be caught on next startup
- Transaction reconciliation: Pending transactions remain pending until next cycle
- Cleanup services: Old data accumulates until next cleanup

**Impact of Restarting Services:**
- All services resume normal operation
- No data loss (state persisted in database)
- Missed recurring donations execute on next check cycle

## Resource Requirements

### Minimum Requirements

**Memory:** 256MB RAM minimum, 512MB recommended  
**Disk:** 100MB for installation + database growth  
**Network:** Persistent connectivity, 1Mbps minimum bandwidth  
**CPU:** 1 core minimum, 2 cores recommended  
**Node.js:** v18.x or higher

### Requirements by Deployment Scale

#### Low Volume (< 100 transactions/day)

| Resource | Requirement |
|----------|-------------|
| Memory | 256MB RAM |
| Disk | 100MB + 10MB/year growth |
| CPU | 1 core |
| Network | 1Mbps, < 200ms latency to Horizon API |
| Concurrent Users | < 10 |

**Use Case:** Development, testing, small pilot projects

#### Medium Volume (100-1000 transactions/day)

| Resource | Requirement |
|----------|-------------|
| Memory | 512MB RAM |
| Disk | 100MB + 100MB/year growth |
| CPU | 2 cores |
| Network | 5Mbps, < 100ms latency to Horizon API |
| Concurrent Users | 10-50 |

**Use Case:** Small production deployments, staging environments

#### High Volume (> 1000 transactions/day)

| Resource | Requirement |
|----------|-------------|
| Memory | 1GB+ RAM |
| Disk | 100MB + 1GB/year growth |
| CPU | 4+ cores |
| Network | 10Mbps+, < 50ms latency to Horizon API |
| Concurrent Users | 50+ |

**Use Case:** Production deployments, high-traffic applications

⚠️ **Note:** High-volume deployments should consider migrating from SQLite to PostgreSQL or MySQL for better concurrency handling.

### Network Requirements

**Bandwidth:** Minimum 1Mbps for API communication  
**Latency:** < 200ms to Stellar Horizon API recommended  
**Connectivity:** Persistent connection required  
**Protocols:** HTTPS (port 443) for Horizon API

**Firewall Rules:**
```bash
# Outbound HTTPS to Stellar Horizon
Allow outbound TCP port 443 to horizon-testnet.stellar.org
Allow outbound TCP port 443 to horizon.stellar.org
```

### Impact of Insufficient Resources

#### Insufficient Memory

**Symptoms:**
- Application crashes with "Out of Memory" errors
- Slow response times
- Process killed by OS (OOM killer)

**Mitigation:**
- Increase available memory
- Reduce concurrent request limits
- Monitor memory usage with `process.memoryUsage()`

#### Insufficient Disk Space

**Symptoms:**
- Database write failures
- Application crashes
- "ENOSPC: no space left on device" errors

**Mitigation:**
- Implement disk space monitoring
- Set up automated cleanup of old logs
- Implement database backup rotation
- Alert when disk usage > 80%

#### Insufficient Network Bandwidth

**Symptoms:**
- Slow transaction processing
- Timeout errors
- Failed Stellar API calls

**Mitigation:**
- Increase network bandwidth
- Reduce transaction frequency
- Implement request queuing
- Monitor network latency

#### Insufficient CPU

**Symptoms:**
- High response times
- Background services delayed
- Request timeouts

**Mitigation:**
- Add more CPU cores
- Optimize database queries
- Reduce concurrent operations
- Implement request throttling

### Resource Monitoring

**Recommended Metrics:**
```javascript
// Memory usage
const memUsage = process.memoryUsage();
console.log(`Memory: ${memUsage.heapUsed / 1024 / 1024}MB`);

// CPU usage (requires monitoring tool)
// Use tools like: pm2, New Relic, DataDog

// Disk usage
const { execSync } = require('child_process');
const diskUsage = execSync('df -h .').toString();
```

**Monitoring Tools:**
- PM2 for process monitoring
- Prometheus + Grafana for metrics
- CloudWatch (AWS)
- DataDog, New Relic (APM)

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Type | Validation | Description |
|----------|----------|---------|------|------------|-------------|
| `PORT` | No | `3000` | number | 1-65535 | HTTP server port |
| `NODE_ENV` | No | `development` | string | development\|production\|test | Runtime environment |
| `STELLAR_NETWORK` | No | `testnet` | string | testnet\|mainnet\|futurenet | Stellar network to use |
| `HORIZON_URL` | No | Auto-detected | string | Valid URL | Custom Horizon endpoint |
| `MOCK_STELLAR` | No | `false` | boolean | true\|false | Enable mock Stellar mode |
| `DB_TYPE` | No | `sqlite` | string | sqlite | Database type |
| `DB_PATH` | No | `./donations.db` | path | Writable path | SQLite database file path |
| `DB_JSON_PATH` | No | `./data/donations.json` | path | Writable path | Optional JSON storage path |
| `API_KEYS` | Yes | N/A | string | Comma-separated | Legacy API keys |
| `ENCRYPTION_KEY` | Production only | N/A | string | Non-empty | Encryption key for sensitive data |
| `MIN_DONATION_AMOUNT` | No | `0.01` | number | >= 0 | Minimum donation in XLM |
| `MAX_DONATION_AMOUNT` | No | `10000` | number | >= 0 | Maximum donation in XLM |
| `MAX_DAILY_DONATION_PER_DONOR` | No | `0` | number | >= 0 | Daily cap per donor (0=disabled) |
| `RATE_LIMIT` | No | `100` | number | >= 1 | Max requests per window |
| `LOG_TO_FILE` | No | `false` | boolean | true\|false | Enable file logging |
| `LOG_DIR` | No | `./logs` | path | Writable path | Log file directory |
| `LOG_VERBOSE` | No | `false` | boolean | true\|false | Enable verbose logging |
| `DEBUG_MODE` | No | `false` | boolean | true\|false | Enable debug mode |

### Validation Rules

#### Startup Validation

The system validates configuration at startup and exits with error if validation fails:

**Required Variables:**
- `API_KEYS` must be set and non-empty
- `ENCRYPTION_KEY` must be set in production (`NODE_ENV=production`)

**Numeric Ranges:**
- `PORT`: 1-65535
- `MIN_DONATION_AMOUNT`: >= 0
- `MAX_DONATION_AMOUNT`: >= 0
- `MAX_DAILY_DONATION_PER_DONOR`: >= 0
- `RATE_LIMIT`: >= 1

**String Values:**
- `STELLAR_NETWORK`: Must be `testnet`, `mainnet`, or `futurenet`
- `MOCK_STELLAR`: Must be `true` or `false`
- `HORIZON_URL`: Must be valid URL format if provided

**Path Validation:**
- `DB_PATH`: Parent directory must exist and be writable
- `LOG_DIR`: Directory must be writable if `LOG_TO_FILE=true`

### Configuration Examples

#### Development Environment

```bash
# .env.development
NODE_ENV=development
PORT=3000
STELLAR_NETWORK=testnet
MOCK_STELLAR=false
DB_PATH=./donations.db
API_KEYS=dev_key_1234567890
DEBUG_MODE=true
LOG_VERBOSE=true
```

#### Test Environment

```bash
# .env.test
NODE_ENV=test
PORT=3001
STELLAR_NETWORK=testnet
MOCK_STELLAR=true
DB_PATH=./test-donations.db
API_KEYS=test_key_1234567890
DEBUG_MODE=false
```

#### Production Environment

```bash
# .env.production
NODE_ENV=production
PORT=3000
STELLAR_NETWORK=mainnet
MOCK_STELLAR=false
DB_PATH=/var/lib/stellar-donations/production.db
API_KEYS=prod_key_secure_random_string
ENCRYPTION_KEY=production_encryption_key_32_chars_min
LOG_TO_FILE=true
LOG_DIR=/var/log/stellar-donations
LOG_VERBOSE=false
DEBUG_MODE=false
MIN_DONATION_AMOUNT=1.00
MAX_DONATION_AMOUNT=10000
MAX_DAILY_DONATION_PER_DONOR=50000
RATE_LIMIT=1000
```

#### High-Availability Production

```bash
# .env.production-ha
NODE_ENV=production
PORT=3000
STELLAR_NETWORK=mainnet
MOCK_STELLAR=false
DB_PATH=/mnt/shared-storage/stellar-donations/production.db
API_KEYS=prod_key_1,prod_key_2,prod_key_3
ENCRYPTION_KEY=production_encryption_key_secure_random
LOG_TO_FILE=true
LOG_DIR=/var/log/stellar-donations
RATE_LIMIT=5000
# Consider PostgreSQL instead of SQLite for HA
```

## Test Environment

### Test-Specific Configuration

#### Jest Test Timeout

**Value:** 10 seconds (10,000 milliseconds)  
**Location:** `jest.config.js`  
**Configurable:** Yes (modify jest.config.js)

```javascript
// jest.config.js
module.exports = {
  testTimeout: 10000, // 10 seconds
  // ...
};
```

**When to Adjust:**
- Slow CI/CD environments: Increase to 15-20 seconds
- Integration tests with real network calls: Increase to 30 seconds
- Fast local development: Can reduce to 5 seconds

#### Mock Stellar Mode

**Environment Variable:** `MOCK_STELLAR`  
**Test Value:** `true`  
**Purpose:** Disable real Stellar network calls during testing

```bash
# Enable for unit tests
MOCK_STELLAR=true npm test

# Disable for integration tests
MOCK_STELLAR=false npm test
```

**Mock Behavior:**
- Simulates Stellar API responses
- No real blockchain transactions
- Predictable test data
- Fast execution (no network latency)
- Supports failure simulation for testing error handling

### Test vs Production Differences

| Aspect | Test Environment | Production Environment |
|--------|------------------|------------------------|
| `MOCK_STELLAR` | `true` | `false` |
| `STELLAR_NETWORK` | `testnet` | `mainnet` |
| Test Timeout | 10 seconds | N/A |
| Database | In-memory or temp file | Persistent file |
| Background Services | Often disabled | Always enabled |
| Retry Logic | Same as production | 3 attempts |
| Validation | Relaxed for some tests | Strict |

### Slow Environment Guidance

If tests timeout in slow environments (CI/CD, low-spec machines):

**Option 1: Increase Jest Timeout**
```javascript
// jest.config.js
module.exports = {
  testTimeout: 20000, // 20 seconds
};
```

**Option 2: Per-Test Timeout**
```javascript
test('slow operation', async () => {
  // Test code
}, 30000); // 30 second timeout for this test only
```

**Option 3: Use Mock Mode**
```bash
# Faster tests with mocked Stellar
MOCK_STELLAR=true npm test
```

**Option 4: Skip Slow Tests**
```javascript
test.skip('slow integration test', async () => {
  // Skipped in CI
});
```

## Production Deployment

### Production Warnings

⚠️ **SQLite Concurrency Limitations**

SQLite uses file-level locking and is NOT suitable for high-concurrency production environments. Symptoms of SQLite contention:
- "Database is locked" errors
- Slow write operations
- Request timeouts

**Recommendation:** For production deployments with > 100 concurrent users or > 1000 transactions/day, migrate to PostgreSQL or MySQL.

⚠️ **Mock Stellar Mode**

NEVER set `MOCK_STELLAR=true` in production. This completely disables real blockchain operations and simulates all Stellar API responses. Transactions will appear successful but will NOT be submitted to the blockchain.

**Verification:**
```bash
# Check production configuration
grep MOCK_STELLAR .env
# Should be: MOCK_STELLAR=false or not set
```

⚠️ **Default Configurations**

Default configurations are optimized for development, not production:
- Default API keys are insecure
- Default rate limits may be too low
- Default paths may not be appropriate
- Encryption key is optional in development but REQUIRED in production

⚠️ **Security Implications**

- **API Keys:** Use strong, randomly generated keys in production
- **Encryption Key:** Must be set in production for sensitive data encryption
- **File Permissions:** Restrict database file access to application user only
- **Network Security:** Use HTTPS for all external API access
- **Secrets Management:** Never commit secrets to version control

### Production Readiness Checklist

Use this checklist before deploying to production:

- [ ] **Database Backup Strategy Implemented**
  - Automated backups configured
  - Backup retention policy defined
  - Restoration procedure tested
  - Backup integrity verification scheduled

- [ ] **Monitoring Configured for All Background Services**
  - Recurring donation scheduler monitored
  - Transaction reconciliation monitored
  - Cleanup services monitored
  - Alerts configured for service failures

- [ ] **Log Retention Policy Defined**
  - Log rotation configured
  - Disk space monitoring enabled
  - Log archival strategy defined
  - Compliance requirements met

- [ ] **Resource Requirements Met for Expected Scale**
  - Memory allocation appropriate for volume
  - Disk space sufficient with growth buffer
  - Network bandwidth adequate
  - CPU cores match workload

- [ ] **Network Connectivity Verified**
  - Stellar Horizon API accessible
  - DNS resolution working
  - Firewall rules configured
  - SSL/TLS certificates valid

- [ ] **Configuration Validation Passes**
  - All required environment variables set
  - Numeric values within acceptable ranges
  - Database paths writable
  - No validation errors on startup

- [ ] **Graceful Shutdown Tested**
  - SIGTERM handling verified
  - Background services stop cleanly
  - Database connections close properly
  - No data loss on shutdown

- [ ] **Security Review Completed**
  - Strong API keys generated
  - Encryption key set and secured
  - File permissions restricted
  - Secrets not in version control
  - HTTPS enforced for external APIs

### Monitoring Recommendations

#### Background Service Monitoring

**Metrics to Track:**
- Execution frequency (should match configured intervals)
- Execution duration (should be < interval)
- Success/failure rates
- Error types and frequencies

**Alerting Thresholds:**
- Service hasn't executed in 2x interval period
- Error rate > 5%
- Execution duration > 80% of interval

**Tools:**
- Application logs (structured JSON recommended)
- APM tools (New Relic, DataDog, Prometheus)
- Custom health check endpoints

#### Database Monitoring

**Metrics to Track:**
- Database size growth rate
- Query performance
- Lock contention (SQLite)
- Connection pool usage

**Alerting Thresholds:**
- Disk usage > 80%
- Query duration > 1 second
- Lock wait time > 100ms

#### Network Monitoring

**Metrics to Track:**
- Stellar Horizon API response times
- Network error rates
- Retry attempt frequencies

**Alerting Thresholds:**
- Horizon API latency > 5 seconds
- Network error rate > 1%
- Retry rate > 10%

#### Resource Monitoring

**Metrics to Track:**
- Memory usage
- CPU utilization
- Disk I/O
- Network bandwidth

**Alerting Thresholds:**
- Memory usage > 80%
- CPU usage > 80% sustained
- Disk I/O wait > 20%

### Log Retention Policies

**Recommended Retention:**
- **Application Logs:** 30 days
- **Error Logs:** 90 days
- **Audit Logs:** 1 year (or per compliance requirements)
- **Debug Logs:** 7 days (disable in production if possible)

**Disk Space Considerations:**
- Estimate: ~100MB/day for medium-volume deployments
- Implement log rotation (daily or size-based)
- Compress old logs (gzip)
- Archive to cold storage if needed

**Log Rotation Example:**
```bash
# /etc/logrotate.d/stellar-donations
/var/log/stellar-donations/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 stellar-app stellar-app
    sharedscripts
    postrotate
        systemctl reload stellar-donation-api
    endscript
}
```

## Operational Procedures

### Graceful Shutdown

#### Signals Handled

The system handles the following shutdown signals:
- **SIGTERM** (15): Graceful shutdown (recommended)
- **SIGINT** (2): Graceful shutdown (Ctrl+C)

```bash
# Graceful shutdown
kill -TERM <pid>

# Or using systemd
systemctl stop stellar-donation-api
```

#### Shutdown Sequence

1. **Stop Accepting New Requests** (immediate)
   - HTTP server stops accepting new connections
   - Existing connections remain open

2. **Wait for In-Flight Operations** (max 10 seconds)
   - HTTP requests complete
   - Database transactions finish
   - Current background service cycles complete

3. **Stop Background Services** (graceful)
   - Recurring donation scheduler stops
   - Transaction reconciliation stops
   - Cleanup services stop
   - Services complete current operations before stopping

4. **Close Database Connections**
   - All database connections closed cleanly
   - No pending transactions

5. **Exit**
   - Process exits with code 0 (success)

**Maximum Shutdown Time:** 10 seconds  
After 10 seconds, the system forces shutdown to prevent hanging.

#### Verification

**Check Exit Code:**
```bash
echo $?
# Should be 0 for successful shutdown
```

**Check Logs:**
```bash
tail -f /var/log/stellar-donations/app.log
# Look for:
# "SHUTDOWN: HTTP server closed"
# "SHUTDOWN: Background services stopped"
# "SHUTDOWN: Database connections closed"
```

**Verify No Orphaned Processes:**
```bash
ps aux | grep stellar-donation
# Should return no results
```

#### Database Connection Shutdown

- All active connections closed
- Pending transactions committed or rolled back
- SQLite database file closed cleanly
- No database locks remain

⚠️ **Warning: SIGKILL Risks**

**NEVER use SIGKILL (kill -9) unless absolutely necessary.**

```bash
# DANGEROUS - bypasses graceful shutdown
kill -9 <pid>
```

**Risks of SIGKILL:**
- In-flight transactions may be lost
- Database may be left in inconsistent state
- Background services interrupted mid-operation
- Recurring donations may be partially executed
- No cleanup performed

**When SIGKILL is Acceptable:**
- Process is completely hung and unresponsive
- After graceful shutdown has been attempted and failed
- Emergency situations only

**Recovery After SIGKILL:**
1. Check database integrity: `sqlite3 donations.db "PRAGMA integrity_check;"`
2. Review logs for incomplete operations
3. Manually verify recent transactions on Stellar network
4. Check for orphaned recurring donation executions

### Troubleshooting Guide

#### Timeout Issues

**Symptom:** Operations timing out after 30 seconds

**Possible Causes:**
- Stellar Horizon API slow or unavailable
- Network connectivity issues
- High network latency

**Solutions:**
1. Check Stellar Horizon API status: https://status.stellar.org
2. Test network connectivity: `curl -w "@curl-format.txt" https://horizon-testnet.stellar.org`
3. Check network latency: `ping horizon-testnet.stellar.org`
4. Review retry logic in logs
5. Consider using MOCK_STELLAR for testing if network is unavailable

#### Database Connection Issues

**Symptom:** "Database is locked" or "SQLITE_BUSY" errors

**Possible Causes:**
- High concurrency (SQLite limitation)
- Long-running transactions
- Insufficient file permissions

**Solutions:**
1. Check concurrent request count
2. Review slow queries in logs
3. Verify file permissions: `ls -l donations.db`
4. Consider migrating to PostgreSQL for high concurrency
5. Implement connection pooling

#### Background Service Failures

**Symptom:** Recurring donations not executing or reconciliation not running

**Possible Causes:**
- Service crashed or stopped
- Database unavailable
- Stellar network unavailable

**Solutions:**
1. Check service status in logs
2. Verify services started: Check startup logs for "Scheduler started"
3. Check for errors in execution logs
4. Verify database connectivity
5. Verify Stellar network connectivity
6. Restart application if services stopped

#### Configuration Validation Errors

**Symptom:** Application exits immediately on startup with configuration error

**Possible Causes:**
- Missing required environment variables
- Invalid configuration values
- Unwritable database paths

**Solutions:**
1. Review error message for specific issue
2. Check `.env` file exists and is readable
3. Verify all required variables are set
4. Check numeric values are within acceptable ranges
5. Verify database path is writable: `touch /path/to/donations.db`
6. See [Configuration Reference](#configuration-reference) for valid values

#### High Memory Usage

**Symptom:** Application using excessive memory or crashing with OOM errors

**Possible Causes:**
- Memory leak
- Too many concurrent requests
- Large result sets from database

**Solutions:**
1. Monitor memory usage: `process.memoryUsage()`
2. Reduce concurrent request limits
3. Implement pagination for large queries
4. Restart application periodically
5. Increase available memory
6. Profile application for memory leaks

#### Disk Space Issues

**Symptom:** "ENOSPC: no space left on device" errors

**Possible Causes:**
- Database growth
- Log file accumulation
- Insufficient disk space provisioned

**Solutions:**
1. Check disk usage: `df -h`
2. Check database size: `du -h donations.db`
3. Implement log rotation
4. Clean up old backups
5. Increase disk space
6. Implement automated cleanup

---

## Additional Resources

- **Stellar Documentation:** https://developers.stellar.org
- **Stellar Horizon API:** https://developers.stellar.org/api
- **Stellar Status Page:** https://status.stellar.org
- **Project Repository:** [Link to your repository]
- **Issue Tracker:** [Link to your issue tracker]

---

**Document Maintenance:**
- Review quarterly or when runtime assumptions change
- Update after major version releases
- Validate against codebase regularly
- Keep synchronized with actual implementation

**Feedback:**
If you find inaccuracies or have suggestions for improving this documentation, please open an issue or submit a pull request.

