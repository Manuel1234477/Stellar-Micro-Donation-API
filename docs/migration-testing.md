# Database Migration Testing

This document describes the migration testing strategy used to ensure database migrations are reliable and reversible.

## Overview

Database migrations are critical for:
- Rolling out schema changes to production
- Maintaining data consistency
- Enabling rollbacks when needed
- Versioning database state

The migration testing framework ensures:
- **Up migrations** work on a fresh database
- **Down migrations** can rollback changes
- **No duplicate** migration version numbers
- **Proper ordering** of migration execution
- **Comprehensive validation** before deployment

## Migration System Architecture

### Components

1. **Migration Runner** (`src/utils/migrationRunner.js`)
   - Executes pending migrations in order
   - Tracks applied migrations in `schema_migrations` table
   - Supports down migrations (rollbacks)
   - Implements distributed locking for multi-instance safety

2. **Migration Test Suite** (`scripts/test-migrations.js`)
   - Tests migrations on a fresh database
   - Validates up and down migrations
   - Detects duplicate version numbers
   - Checks migration ordering

3. **Migration Validation** (`scripts/check-migration-ids.js`)
   - Validates migration file naming
   - Checks for version conflicts
   - Ensures consistent formatting

4. **CI Workflow** (`.github/workflows/migrations-ci.yml`)
   - Runs on PR creation and commit
   - Tests fresh database migrations
   - Validates migration integrity

## Migration File Format

### File Naming Convention

Migrations use a numeric prefix for ordering:

```
src/migrations/
  001_initial_schema.js
  002_add_users_table.js
  003_add_transactions_table.js
  010_add_recurring_donations.js
```

The numeric prefix determines execution order:
- **Must be unique**: No two migrations can have the same prefix
- **Must be ordered**: Prefixes should be in ascending order
- **Format**: `[PREFIX]_[description].js` where PREFIX is 1+ digits

### Migration Module Structure

```javascript
// src/migrations/001_initial_schema.js

module.exports = {
  name: 'initial_schema',  // Unique identifier
  description: 'Create initial database schema',

  /**
   * Run this migration (upgrade)
   * @param {object} db - Database wrapper with run() and query() methods
   */
  async up(db) {
    await db.run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },

  /**
   * Rollback this migration (downgrade)
   * @param {object} db - Database wrapper
   */
  async down(db) {
    await db.run('DROP TABLE IF EXISTS users');
  }
};
```

## Running Migrations

### Automatic Startup

Migrations run automatically when the application starts:

```bash
npm start
# Automatically runs pending migrations before starting server
```

### Manual Migration Commands

```bash
# Apply pending migrations
npm run migrate

# Rollback one migration
npm run migrate:rollback

# Check migration status
npm run migrate:status

# Validate migration IDs (checks for duplicates, ordering)
npm run migrate:check

# Test migrations on fresh database
npm run test:migrations
```

## CI/CD Integration

### Migration Testing in CI

The CI pipeline includes comprehensive migration testing:

1. **Fresh Database Migration** - Test all migrations on a clean database
2. **Migration Validation** - Check for duplicates and proper ordering
3. **Rollback Testing** - Verify down migrations work
4. **Schema Integrity** - Validate resulting schema structure

### Running Migration Tests

```bash
# Test migrations
npm run test:migrations

# Expected output:
# ✓ Should load migration files
# ✓ No duplicate migration prefixes
# ✓ Migrations should be in ascending numeric order
# ✓ All 15 migrations applied successfully
# ✓ Database should have tables after migrations
# ✓ All 15 migrations rolled back successfully
```

### CI Workflow Configuration

```yaml
# .github/workflows/migrations-ci.yml
name: Migration Tests

on:
  pull_request:
    paths:
      - 'src/migrations/**'
      - 'scripts/test-migrations.js'
  push:
    branches: [main]

jobs:
  test-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:migrations
```

## Migration Validation

### Duplicate Detection

The migration system prevents duplicate version numbers:

```bash
# BAD: Duplicate prefix
src/migrations/
  001_initial.js
  002_add_users.js
  002_add_posts.js  # ✗ Duplicate prefix "002"!

# Error when running migrations:
# Duplicate migration prefix "002": "002_add_users.js" and "002_add_posts.js"
```

### Ordering Validation

Migrations must be in ascending numeric order:

```bash
# BAD: Out of order
src/migrations/
  001_initial.js
  003_add_users.js
  002_add_posts.js  # ✗ Out of order!

# Good: Proper order
src/migrations/
  001_initial.js
  002_add_posts.js
  003_add_users.js
```

### Validation Script

```bash
# Check migration IDs for issues
npm run migrate:check

# Output:
# ✓ All migration IDs are valid
# ✓ No duplicate prefixes
# ✓ Migrations in ascending order
```

## Best Practices

### 1. Small, Focused Migrations

Each migration should do one thing:

```javascript
// GOOD: Single responsibility
module.exports = {
  name: 'add_users_table',
  async up(db) {
    await db.run(`CREATE TABLE users (...)`);
  },
  async down(db) {
    await db.run('DROP TABLE users');
  }
};

// BAD: Multiple unrelated changes
module.exports = {
  name: 'multiple_changes',
  async up(db) {
    await db.run('CREATE TABLE users (...)');
    await db.run('CREATE TABLE posts (...)');
    await db.run('CREATE TABLE comments (...)');
  },
};
```

### 2. Always Include Down Migrations

Enable rollbacks by implementing `down()`:

```javascript
async down(db) {
  // Reverse the up migration
  await db.run('DROP TABLE users');
}
```

### 3. Test Reversibility

Ensure migrations can rollback:

```bash
# Test reversibility locally
npm run migrate                    # Apply migrations
npm run migrate:rollback           # Rollback one
npm run migrate                    # Re-apply
```

### 4. Validate Data Migrations

For data changes, test with actual data:

```javascript
module.exports = {
  name: 'migrate_user_data',
  async up(db) {
    // Validate data before and after
    const before = await db.query('SELECT COUNT(*) FROM users');
    
    await db.run(`
      UPDATE users 
      SET email = LOWER(TRIM(email))
      WHERE email IS NOT NULL
    `);
    
    const after = await db.query('SELECT COUNT(*) FROM users');
    if (before[0].count !== after[0].count) {
      throw new Error('Data loss detected during migration');
    }
  }
};
```

### 5. Use Transaction Wrapping

Wrap migrations in transactions for safety:

```javascript
async up(db) {
  // Note: SQLite transactions require raw SQL
  await db.run('BEGIN TRANSACTION');
  try {
    await db.run('CREATE TABLE users (...)');
    await db.run('CREATE INDEX idx_users_email ON users(email)');
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}
```

### 6. Handle Concurrent Migrations

The migration system includes locking:

```javascript
// Automatic locking via migrationRunner
// Lock timeout: 30 seconds (configurable via MIGRATION_LOCK_TIMEOUT_MS)
// Lock poll interval: 500ms (configurable via MIGRATION_LOCK_POLL_INTERVAL_MS)
```

## Common Issues and Solutions

### Issue: Migrations fail on production but pass locally

**Causes:**
- Different database state
- Missing environment-specific data
- Concurrent application instances

**Solutions:**
1. Test on fresh database in CI
2. Use `npm run test:migrations` before deployment
3. Ensure database is backed up
4. Plan deployment window with no concurrent access

### Issue: Duplicate migration prefix error

**Example:**
```
Error: Duplicate migration prefix "005": "005_add_users.js" and "005_add_posts.js"
```

**Solution:**
```bash
# Rename one migration to unique prefix
mv src/migrations/005_add_posts.js src/migrations/006_add_posts.js

# Update the migration name if needed
# Edit 006_add_posts.js: name: 'add_posts'
```

### Issue: Out-of-order migration error

**Example:**
```
Error: Expected migration prefix 006 but found 008
```

**Solution:**
```bash
# Rename migrations to proper order
mv src/migrations/008_*.js src/migrations/006_*.js
mv src/migrations/007_*.js src/migrations/007_*.js
# Continue until order is correct
```

### Issue: Rollback fails

**Causes:**
- `down()` not implemented
- Data constraints prevent rollback
- Migration depends on other migrations

**Solution:**
```javascript
// Implement proper down migration
async down(db) {
  // Must reverse up() exactly
  // Be careful with data - migrations might delete data
  await db.run('DROP TABLE users');
}
```

## Testing Migrations Locally

### Test Up and Down

```bash
# 1. Apply all migrations
npm run migrate

# 2. Check status
npm run migrate:status
# Output: 15 migrations applied

# 3. Rollback one migration
npm run migrate:rollback

# 4. Check status again
npm run migrate:status
# Output: 14 migrations applied

# 5. Re-apply migrations
npm run migrate
```

### Test on Fresh Database

```bash
# 1. Backup current database
cp data/stellar_donations.db data/stellar_donations.db.backup

# 2. Delete database
rm data/stellar_donations.db

# 3. Run migrations on fresh database
npm run migrate

# 4. Verify schema
sqlite3 data/stellar_donations.db ".schema"

# 5. Run migration test
npm run test:migrations
```

## Production Deployment

### Pre-deployment Checklist

- [ ] All migrations tested locally
- [ ] `npm run test:migrations` passes
- [ ] `npm run migrate:check` passes
- [ ] Database backed up
- [ ] Rollback plan documented
- [ ] Team notified of deployment window
- [ ] No concurrent application instances

### Deployment Steps

1. **Backup Database**
   ```bash
   docker-compose exec api cp /app/data/donations.db /app/data/donations.db.backup-$(date +%Y%m%d)
   ```

2. **Deploy New Version**
   ```bash
   git pull && npm install && npm run migrate
   ```

3. **Verify Deployment**
   ```bash
   curl http://localhost:3000/health
   ```

4. **Monitor Logs**
   ```bash
   docker-compose logs -f api | grep -i migration
   ```

### Rollback Procedure

If migrations fail:

1. **Verify** - Check what went wrong in logs
2. **Rollback one** - Run `npm run migrate:rollback`
3. **Test** - Verify application works
4. **Assess** - Determine root cause
5. **Fix** - Update migration and retry

## Environment Variables

### Migration Configuration

```bash
# Timeout for acquiring migration lock (ms)
MIGRATION_LOCK_TIMEOUT_MS=30000

# Poll interval while waiting for lock (ms)
MIGRATION_LOCK_POLL_INTERVAL_MS=500

# Database path
DB_PATH=/app/data/donations.db
```

## References

- **Migration Runner**: See `src/utils/migrationRunner.js`
- **Migration Validation**: See `scripts/check-migration-ids.js`
- **Migration Testing**: See `scripts/test-migrations.js`
- **Migration Examples**: See `src/migrations/`
- **Database Schema**: See `docs/database-schema.md`
- **CI Workflow**: See `.github/workflows/migrations-ci.yml`

## Support

For migration issues:
1. Run `npm run migrate:check` to validate
2. Check logs: `docker-compose logs api | grep -i migration`
3. Test on fresh database: `npm run test:migrations`
4. Review recent migration files for issues
5. Contact database team for assistance
