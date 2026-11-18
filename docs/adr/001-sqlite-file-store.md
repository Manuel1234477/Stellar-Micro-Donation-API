# ADR-001: Use SQLite as the Primary Data Store

**Status:** Accepted  
**Date:** 2024-01-15  
**Deciders:** Core team

---

## Context

The API needs a durable store for wallets, donations, API keys, audit logs, and recurring
schedules. Early in the project the prototype used plain JSON files under `data/`
(`donations.json`, `users.json`, `wallets.json`). As the data model grew and concurrent
access became a concern, a proper database engine was required.

The service targets self-hosted deployments where operators may not have access to a
managed database, and where operational simplicity is a first-class goal. The expected
scale is tens of thousands of donations and hundreds of wallets per instance — not
millions of concurrent writes.

## Decision

We will use **SQLite** (via the `sqlite3` npm package) as the sole relational store.
The database file path is configured via `DB_PATH` (default: `./data/stellar_donations.db`).

A thin connection-pool layer (`src/utils/database.js`) manages a bounded pool of
in-process connections (`DB_POOL_SIZE`, default 5). All schema changes go through
numbered migration files in `src/migrations/`.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| PostgreSQL / MySQL | Requires a separate server process, significantly raising the operational bar for self-hosted deployments. Premature for the current scale. |
| Plain JSON files | Already in use (prototype). No transactions, no concurrent-write safety, no query language, and no indexing. Untenable as the model grew. |
| In-memory store only | No durability. Acceptable for tests but not for production. |
| Embedded key-value store (LevelDB, LMDB) | No relational query support; would require reinventing joins and indexes. |

## Consequences

**Positive:**
- Zero external dependencies for storage — `sqlite3` ships with the package.
- Single-file backups are trivial (`BACKUP_DIR`, `BACKUP_S3_BUCKET`).
- Familiar SQL semantics for queries, indexes, and transactions.
- SQLite's write serialisation eliminates an entire class of concurrent-write bugs.

**Negative / trade-offs:**
- Write throughput is bounded by SQLite's single-writer model. High-concurrency
  write workloads (> ~hundreds of writes/second) will bottleneck at the WAL.
- Horizontal scaling across multiple processes requires external coordination or
  a migration to a client-server database. The `DB_TYPE` variable is reserved for
  a future driver abstraction but is not yet implemented.
- `DB_POOL_SIZE` is an in-process pool; cross-process connection limits still apply.

**Follow-on tasks:**
- [x] Implement numbered migration runner (`src/scripts/migrate.js`)
- [x] Add `DB_POOL_SIZE`, `DB_ACQUIRE_TIMEOUT`, `DB_QUERY_TIMEOUT_MS` configuration
- [ ] Evaluate read-replica or WAL-mode tuning if write contention is observed in production

---

*See also: `src/utils/database.js`, `src/migrations/`, `docs/configuration.md#5-database`*
