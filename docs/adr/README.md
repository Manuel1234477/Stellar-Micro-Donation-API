# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Stellar
Micro-Donation API. ADRs capture the "why" behind consequential design decisions so
future contributors can understand the constraints, evaluate whether they still hold, and
avoid relitigating settled questions.

## What is an ADR?

An ADR is a short document (roughly one page) that records a single architectural
decision. It covers:

- **Context** — the forces that made a decision necessary
- **Decision** — what was chosen, stated clearly
- **Alternatives considered** — what was rejected and why
- **Consequences** — what becomes easier or harder as a result

## Index

| # | Title | Status |
|---|---|---|
| [000](./000-adr-template.md) | ADR Template | — |
| [001](./001-sqlite-file-store.md) | Use SQLite as the primary data store | Accepted |
| [002](./002-mock-vs-real-stellar.md) | Introduce a mock Stellar service layer | Accepted |
| [003](./003-signing-provider-strategy.md) | Pluggable signing-provider strategy | Accepted |
| [004](./004-money-as-stroops.md) | Represent monetary amounts as stroops internally | Accepted |
| [005](./005-canonical-donations-table.md) | Use `donations_store` as the canonical donation table | Proposed |

## When to write an ADR

Write an ADR for any decision that:

- Affects the overall structure of the application (persistence, transport, auth)
- Chooses between two or more seriously considered alternatives
- Imposes constraints on future work (e.g. "we can't easily switch away from X")
- Would be puzzling to a new contributor without context

Tactical decisions (which library to use for date formatting, minor refactors) do not
need ADRs.

## How to write an ADR

1. Copy `000-adr-template.md` to `NNN-short-title.md` (use the next available number).
2. Fill in all sections. Keep it to one page.
3. Set **Status** to `Proposed`.
4. Open a PR and link the ADR in the description. The PR review is the decision process.
5. Merge and update **Status** to `Accepted`.

If a later decision supersedes this one, update the old ADR's **Status** to
`Superseded by ADR-NNN` and create the new ADR that references it.

## Relationship to PRs

When a PR implements a decision that warrants an ADR, the PR description should either
link an existing ADR or include a new one. Reviewers are encouraged to ask "does this
need an ADR?" for significant architectural changes.
