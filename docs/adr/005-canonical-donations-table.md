# ADR-005: Use `donations_store` as the canonical donation table

**Status:** Proposed  
**Date:** 2026-10-19  
**Deciders:** Backend Team

---

## Context

Donations are written to two different tables depending on the code path:

- `DonationService` writes custodial donations with
  `INSERT INTO transactions (senderId, receiverId, amount, memo, ...)`
  (`src/services/DonationService.js`). Ids are integer autoincrement values.
- `Transaction.create` in `src/models/transaction.js` writes to
  `donations_store (id, donor, recipient, amount_stroops, amount_text, status, ...)`,
  introduced by migration `033_donations_store.js`. Ids are UUID v4 strings.

The split has concrete effects:

- Reads, stats, leaderboards, exports and reconciliation must know which table
  holds a given row, so totals can disagree.
- Id formats differ, which broke GraphQL lookups by id (#1892).
- Column names differ (`senderId` / `receiverId` / `amount` versus `donor` /
  `recipient` / `amount_stroops`), so filters and indexes are duplicated.
- `DonationTotalsRepository.incrementTotal` runs on only one of the two paths.

## Decision

We will use `donations_store` as the single canonical donation table.

It is the better fit: it stores amounts as stroops (see ADR-004), carries status
and timestamp columns for the lifecycle, and uses string ids that do not leak row
counts. Once adopted:

1. Every donation writer goes through one repository that targets
   `donations_store`.
2. A migration copies the remaining rows from `transactions` into
   `donations_store`, mapping ids to stable string ids and recording the mapping
   so existing references stay resolvable.
3. The old `transactions` name becomes a read-only compatibility view for a
   deprecation window, after which it is dropped.
4. A reconciliation test compares totals from REST, GraphQL, stats and exports
   over one seeded dataset.

Nothing in this ADR is implemented yet. The migration, writer change and
reconciliation test are follow-up work tracked under #1893.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Keep `transactions` as canonical | Integer ids, no stroop amounts, and no status timestamps. Moving the richer model onto it would be a larger change than moving the rows. |
| Keep both tables and reconcile in a nightly job | Totals would still disagree between writes and reconciliation, and every reader would still need to know which table to query. |
| Merge the two schemas into a new third table | Adds a migration without removing either old table, so the split would persist. |

## Consequences

**Positive:**
- One source of truth for totals, leaderboards, exports and reconciliation.
- A single id format, which removes the GraphQL id mismatch.
- Filters and indexes need to be defined once.

**Negative / trade-offs:**
- A data migration must run on production SQLite files. It needs a backup step
  and a dry run.
- Until every writer is switched, readers must keep handling both tables. The
  compatibility view limits this to a deprecation window.
- Integer ids already handed to clients stop being the primary identifier. The
  id mapping must be kept for as long as those references exist.
