# Database Migration Rollback Guide

This guide explains how to roll back a database migration in this project.
For how migrations are tested, see `docs/MIGRATION_TESTING.md`.

## Overview

Every migration in `src/migrations/` must export both `up(db)` and
`down(db)`. `up()` applies the change; `down()` must reverse exactly what
`up()` did (drop an added column/table, restore a dropped one, remove an
added index, etc.).

## Rolling Back the Last Migration

Use the migration runner's rollback support:

```bash
node -e "require('./src/utils/migrationRunner').rollbackMigration().then(r => { console.log(r); process.exit(0); })"
```

This rolls back the single most-recently-applied migration (the last row in
`schema_migrations`), running its `down(db)` and removing its tracking row.
To roll back multiple migrations, run this command repeatedly.

## Writing a down() Function

- Reverse only what the matching `up()` changed — nothing more.
- Use `IF EXISTS` / `IF NOT EXISTS` guards (`DROP TABLE IF EXISTS`,
  `DROP INDEX IF EXISTS`, checking `PRAGMA table_info` before an
  `ALTER TABLE ... DROP COLUMN`) so `down()` is idempotent: running it twice,
  or running it after the schema is already rolled back, must be a no-op
  rather than an error.
- Drop tables/indexes in the reverse order they were created in `up()`,
  especially when foreign keys are involved.
- If a change genuinely cannot be reversed (e.g. a lossy data backfill),
  document that explicitly in the migration file and in the PR description —
  don't leave `down()` unimplemented.

## CI Enforcement

`scripts/check-migration-down.js` (wired into
`.github/workflows/migration-down-check.yml`) fails CI if any migration file
does not export a `down` function. Run it locally with:

```bash
node scripts/check-migration-down.js
```

## Testing Rollback Locally

`tests/migration/up-down-reup-cycle.test.js` applies every migration's
`up()` in order on an in-memory database, rolls all of them back with
`down()` in reverse order, and re-applies `up()` again, plus a
double-rollback check to confirm `down()` is idempotent. Run it with:

```bash
npx jest tests/migration/up-down-reup-cycle.test.js
```
