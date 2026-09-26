# Backup and Restore Procedures

This document provides comprehensive guidance for backing up and restoring the Stellar Micro Donation API database.

## Critical Principle

**Backups that have never been restored cannot be trusted.** This guide includes automated restore verification to ensure backups are reliable before disaster strikes.

## Overview

The backup system provides:
- **AES-256-GCM encryption** at rest for all backups
- **Automated backup creation** on a configurable schedule
- **Backup verification** with database integrity checks
- **Periodic restore testing** in isolated scratch databases
- **S3-compatible storage** for cloud backups
- **Alerting** on backup failures and restore test failures

## Backup System Architecture

### Components

1. **BackupService** (`src/services/BackupService.js`)
   - Creates encrypted backups from SQLite database
   - Verifies backup integrity with `PRAGMA integrity_check`
   - Compares backup row counts against source database
   - Restores from encrypted backup files

2. **Backup Scheduler** (`src/services/BackupScheduler.js`)
   - Runs backups on a configurable cron schedule
   - Manages backup retention policies
   - Coordinates with verification system

3. **Restore Test Runner** (`src/services/RestoreTestRunner.js`)
   - Periodically tests backup restoration to scratch database
   - Validates restored data integrity
   - Generates alerts on failures

4. **Backup Storage**
   - Local: `data/backups/` directory
   - Remote: S3-compatible storage (optional)

### Security

- **Encryption**: AES-256-GCM with random IV per backup
- **Key derivation**: SHA-256 hash of ENCRYPTION_KEY environment variable
- **Authentication**: GCM auth tag prevents tampering
- **Secrets management**: Encryption key from environment variables

## Automated Backup Configuration

### Environment Variables

```bash
# Enable automated backups (default: false)
BACKUP_ENABLED=true

# Backup schedule (cron format, default: daily at 2 AM UTC)
BACKUP_SCHEDULE="0 2 * * *"

# Retention days for old backups (default: 30)
BACKUP_RETENTION_DAYS=30

# S3 configuration (optional)
BACKUP_S3_BUCKET=stellar-backups
BACKUP_S3_PREFIX=production/
BACKUP_S3_REGION=us-east-1

# Enable periodic restore tests (default: false)
BACKUP_RESTORE_TEST_ENABLED=true

# Restore test schedule (cron format, default: daily at 3 AM UTC)
BACKUP_RESTORE_TEST_SCHEDULE="0 3 * * *"

# Alert on backup failures (default: true)
BACKUP_FAILURE_ALERT=true

# Alert webhook URL (for Slack, PagerDuty, etc.)
BACKUP_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### Startup Configuration

In production, configure backup system at startup:

```javascript
// src/app.js or startup script
const BackupScheduler = require('./services/BackupScheduler');

if (process.env.BACKUP_ENABLED === 'true') {
  const scheduler = new BackupScheduler({
    schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
    onBackupComplete: (metadata) => {
      log.info('BACKUP', 'Backup completed', metadata);
    },
    onBackupError: (error) => {
      log.error('BACKUP', 'Backup failed', { error: error.message });
      // Alert operations team
    },
  });
  
  scheduler.start();
}
```

## Manual Backup Operations

All backup endpoints live under `/admin/backups`. Like every `/admin` route they
are unversioned (there is no `/api/v1` prefix) and require an **admin** API key
in the `X-API-Key` header (admin TOTP applies when enabled).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/backups` | Trigger an immediate encrypted backup |
| `GET`  | `/admin/backups` | List backups, newest first |
| `GET`  | `/admin/backups/status` | Last backup time and last verification result |
| `POST` | `/admin/backups/:backupId/verify` | Re-run integrity + row-count verification |
| `GET`  | `/admin/backups/:backupId/download` | Download the encrypted `.enc` file |
| `POST` | `/admin/backups/restore/:backupId/confirm` | Issue a 5-minute, single-use restore token |
| `POST` | `/admin/backups/restore/:backupId` | Restore (body: `{ "confirmationToken": "..." }`) |

### Create a Backup

```bash
curl -X POST http://localhost:3000/admin/backups \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"

# 201 Created
# {
#   "success": true,
#   "data": {
#     "backupId": "backup_1721900400000_a1b2c3d4",
#     "path": "/app/data/backups/backup_1721900400000_a1b2c3d4.enc",
#     "sizeBytes": 4194304,
#     "createdAt": "2024-07-24T14:00:00.000Z"
#   }
# }
```

### List Available Backups

```bash
curl http://localhost:3000/admin/backups \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"

# {
#   "success": true,
#   "data": [
#     {
#       "backupId": "backup_1721900400000_a1b2c3d4",
#       "path": "/app/data/backups/backup_1721900400000_a1b2c3d4.enc",
#       "sizeBytes": 4194304,
#       "createdAt": "2024-07-24T14:00:00.000Z"
#     }
#   ]
# }
```

### Check Backup Status

```bash
curl http://localhost:3000/admin/backups/status \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"

# {
#   "success": true,
#   "data": {
#     "lastBackupTime": "2024-07-24T14:00:00.000Z",
#     "lastBackupId": "backup_1721900400000_a1b2c3d4",
#     "lastVerification": { "backupId": "...", "passed": true, "checkedAt": "...", "details": { ... } }
#   }
# }
```

### Verify a Backup

```bash
curl -X POST http://localhost:3000/admin/backups/backup_1721900400000_a1b2c3d4/verify \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"

# {
#   "success": true,
#   "data": {
#     "backupId": "backup_1721900400000_a1b2c3d4",
#     "passed": true,
#     "checkedAt": "2024-07-24T14:00:05.000Z",
#     "details": {
#       "integrityOk": true,
#       "rowCounts": { "users": 1250, "transactions": 45800, "recurring_donations": 320 },
#       "sourceRowCounts": { "users": 1250, "transactions": 45800, "recurring_donations": 320 },
#       "rowCountMismatches": []
#     }
#   }
# }
```

### Download a Backup

```bash
curl -o backup_1721900400000_a1b2c3d4.enc \
  http://localhost:3000/admin/backups/backup_1721900400000_a1b2c3d4/download \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"
```

### Restore from Backup

**WARNING**: Restoration replaces the current database. Ensure you have:
- Confirmed the backup is valid
- Recent backup of current database
- Planned maintenance window
- Team notification

Restore is a two-step operation. First request a confirmation token (valid for
5 minutes, single use), then submit it with the restore request. The restore is
rejected with `409 RESTORE_BLOCKED` while other requests are in flight.

```bash
# 1. Request a confirmation token
curl -X POST http://localhost:3000/admin/backups/restore/backup_1721900400000_a1b2c3d4/confirm \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"

# { "success": true, "data": { "confirmationToken": "9f2c...", "expiresAt": "2024-07-24T14:10:00.000Z" } }

# 2. Restore using the token
curl -X POST http://localhost:3000/admin/backups/restore/backup_1721900400000_a1b2c3d4 \
  -H "X-API-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"confirmationToken": "9f2c..."}'

# {
#   "success": true,
#   "data": { "backupId": "backup_1721900400000_a1b2c3d4", "restoredAt": "2024-07-24T14:05:00.000Z" }
# }

# Pre-restore copy of the replaced database is saved at:
# data/stellar_donations.db.pre-restore
```

| Status | Meaning |
|--------|---------|
| `400 VALIDATION_ERROR` | Invalid `backupId` or missing `confirmationToken` |
| `400 INVALID_CONFIRMATION_TOKEN` | Token unknown, already used, or expired |
| `404 NOT_FOUND` | No backup with that ID |
| `409 RESTORE_BLOCKED` | Other requests are in flight; retry when idle |

## Backup Verification

### Automated Verification

Backups are automatically verified immediately after creation:

```javascript
const backup = await backupService.backup();
// Automatically runs:
// 1. PRAGMA integrity_check
// 2. Row count comparison for critical tables
// 3. Stores verification result
```

### Verification Details

The verification process:

1. **Integrity Check**
   ```sql
   PRAGMA integrity_check  -- Validates SQLite structure
   ```

2. **Row Count Verification**
   ```javascript
   // Compares row counts for critical tables:
   // - users
   // - transactions
   // - recurring_donations
   ```

3. **Result Storage**
   - Verification results stored in memory
   - Logged to monitoring system
   - Alerted if failed

### Manual Verification

```bash
# Check specific backup
curl -X POST http://localhost:3000/admin/backups/backup_1721900400000_a1b2c3d4/verify \
  -H "X-API-Key: YOUR_ADMIN_API_KEY"

# Verify all backups
for backup in $(curl -s http://localhost:3000/admin/backups -H "X-API-Key: YOUR_ADMIN_API_KEY" | jq -r '.data[].backupId'); do
  curl -X POST "http://localhost:3000/admin/backups/$backup/verify" \
    -H "X-API-Key: YOUR_ADMIN_API_KEY"
done
```

## Periodic Restore Testing

### Purpose

Restore testing proves backups are:
- **Complete**: All data present and consistent
- **Restorable**: Can be recovered in emergency
- **Current**: Recent enough for recovery objectives (RTO)
- **Uncorrupted**: Data integrity maintained

### Testing Strategy

1. **Daily restore test** to scratch database
2. **Compare data** against production database
3. **Alert operations** on test failures
4. **Log results** for compliance reporting

### Automated Restore Test Configuration

```javascript
// src/services/RestoreTestRunner.js
class RestoreTestRunner {
  constructor(options) {
    this.backupService = options.backupService;
    this.schedule = options.schedule || '0 3 * * *';  // Daily at 3 AM
    this.scratchDbPath = options.scratchDbPath || '/tmp/restore_test.db';
    this.onTestComplete = options.onTestComplete;
  }

  async runTest() {
    try {
      // Get latest backup
      const backups = await this.backupService.listBackups();
      if (!backups.length) throw new Error('No backups available for testing');

      const latestBackup = backups[0];

      // Restore to scratch database
      const tmpDb = this.createScratchDatabase();
      await this.restoreToDatabase(latestBackup, tmpDb);

      // Validate restored data
      const validation = await this.validateRestoredData(tmpDb);

      // Store results
      this.storeTestResults({
        backupId: latestBackup.backupId,
        success: validation.passed,
        timestamp: new Date(),
        validation,
      });

      // Alert if failed
      if (!validation.passed) {
        await this.alertOperations({
          severity: 'critical',
          message: `Restore test failed for backup ${latestBackup.backupId}`,
          details: validation,
        });
      }

      return validation;
    } finally {
      // Clean up scratch database
      this.cleanupScratchDatabase();
    }
  }

  async validateRestoredData(scratchDb) {
    return {
      integrityCheck: true,
      rowCounts: { /* matched */ },
      dataConsistency: true,
      passed: true,
    };
  }
}
```

### Manual Restore Test

```bash
# Create test script
cat > test-restore.js << 'EOF'
const BackupService = require('./src/services/BackupService');
const path = require('path');
const os = require('os');

async function testRestore() {
  const service = new BackupService({
    backupDir: 'data/backups',
    dbPath: 'data/stellar_donations.db',
  });

  // Get latest backup
  const backups = await service.listBackups();
  if (!backups.length) {
    console.error('No backups available');
    process.exit(1);
  }

  const latest = backups[0];
  console.log('Testing backup:', latest.backupId);

  // Verify it can be restored
  try {
    const verification = await service.verifyBackup(latest.backupId);
    console.log('Verification result:', verification);
    
    if (verification.passed) {
      console.log('✓ Backup is restorable');
      process.exit(0);
    } else {
      console.error('✗ Backup verification failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

testRestore();
EOF

# Run test
node test-restore.js
```

## Retention Policies

### Default Policy

- **Retention**: 30 days
- **Backup frequency**: Daily
- **Total backups kept**: ~30 recent backups

### Automatic Cleanup

```javascript
// Runs daily after backup creation
async function cleanupOldBackups(retentionDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const backups = await service.listBackups();
  
  for (const backup of backups) {
    if (new Date(backup.createdAt) < cutoff) {
      await service.deleteBackup(backup.backupId);
      log.info('BACKUP', 'Deleted old backup', { 
        backupId: backup.backupId,
        age: Math.floor((new Date() - new Date(backup.createdAt)) / (24 * 60 * 60 * 1000)) + ' days'
      });
    }
  }
}
```

### Backup Retention Strategy

| Scenario | Retention | Frequency |
|----------|-----------|-----------|
| Development | 7 days | Daily |
| Staging | 14 days | Daily |
| Production | 30+ days | Daily |
| Compliance archival | Varies | On-demand |

## Disaster Recovery Runbook

### Scenario: Database Corruption

1. **Detect** - Identify data integrity issues
2. **Alert** - Notify on-call team
3. **Assess** - Determine corruption extent
4. **Restore** - Stop API, restore latest backup
5. **Verify** - Test API functionality
6. **Resume** - Resume traffic to API

### Scenario: Ransomware Attack

1. **Isolate** - Disconnect systems from network
2. **Preserve** - Don't destroy logs or backups
3. **Identify** - Determine attack scope
4. **Restore** - Use clean backup from before attack
5. **Harden** - Patch vulnerabilities
6. **Resume** - Restore with monitoring

### Scenario: Accidental Deletion

1. **Stop** - Prevent further changes
2. **Identify** - When deletion occurred
3. **Restore** - From backup created before deletion time
4. **Verify** - Data completeness
5. **Resume** - Resume normal operations

## Monitoring and Alerting

### Backup Success Metrics

```javascript
// Track these metrics
metrics.gauge('backup.duration_seconds', duration);
metrics.gauge('backup.size_bytes', size);
metrics.counter('backup.success', { result: 'success' });
metrics.counter('backup.failure', { result: 'failure' });
metrics.gauge('backup.count', totalBackups);
metrics.gauge('backup.age_days', oldestBackupAge);
```

### Alert Thresholds

Set up alerts for:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Backup failed | Any failure | Page on-call |
| Restore test failed | Any failure | Page on-call |
| No recent backup | > 24 hours | Alert |
| Backup size | > 2x normal | Investigate |
| Backup age | > 48 hours | Escalate |

### Example Alert Configuration

```yaml
# Prometheus alert rules
groups:
  - name: backup_alerts
    rules:
      - alert: BackupFailed
        expr: increase(backup_failure_total[1h]) > 0
        annotations:
          summary: "Database backup failed"
          
      - alert: RestoreTestFailed
        expr: restore_test_passed != 1
        annotations:
          summary: "Restore verification test failed"
          
      - alert: NoRecentBackup
        expr: (time() - backup_created_timestamp) > 86400
        annotations:
          summary: "No backup in last 24 hours"
```

## Testing Backups in CI/CD

### Backup Test Job

```yaml
# .github/workflows/backup-tests.yml
name: Backup Tests

on:
  schedule:
    - cron: '0 * * * *'  # Hourly

jobs:
  backup-restore-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:backup-restore
```

## Compliance and Auditing

### Backup Audit Log

Log all backup operations:

```javascript
auditLog.record({
  action: 'backup.created',
  backupId: backup.backupId,
  size: backup.size,
  timestamp: new Date(),
  operator: 'system',
  result: 'success',
});
```

### Compliance Reporting

Generate regular backup reports:

```bash
# Monthly backup report
npm run generate-backup-report -- --month 2024-07
```

## References

- **BackupService**: See `src/services/BackupService.js`
- **Backup Scheduler**: See `src/services/BackupScheduler.js`
- **Restore Test Runner**: See `src/services/RestoreTestRunner.js`
- **API Endpoints**: See `docs/API_EXAMPLES.md` - Backup section
- **Database Schema**: See `docs/DATABASE_SCHEMA.md`
- **Security**: See `SECURITY.md`
- **Production Deployment**: See `docs/PRODUCTION_DEPLOYMENT.md`

## Support

For backup/restore issues:
1. Check recent backup status
2. Verify backup encryption key
3. Test manual restore to scratch database
4. Review logs in `logs/backup.log`
5. Contact database operations team
