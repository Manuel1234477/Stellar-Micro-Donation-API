# ADR-002: Introduce a Mock Stellar Service Layer

**Status:** Accepted  
**Date:** 2024-02-01  
**Deciders:** Core team

---

## Context

The application interacts with the Stellar network for every donation submission,
transaction verification, wallet creation, and balance check. In CI and local
development, making real outbound calls to Horizon is problematic:

- Requires a funded testnet account for every developer and every CI runner.
- Flaky network or Horizon availability causes unrelated test failures.
- Testnet friendbot has rate limits that break parallel test suites.
- Real Stellar transactions are irreversible and carry finality semantics that make
  teardown in tests difficult.

## Decision

We will maintain a **pluggable Stellar service interface** with two implementations:

1. **Mock implementation** (`src/services/MockStellarService.js`) — returns
   deterministic in-memory responses. Activated by `MOCK_STELLAR=true` (default in
   development and all CI runs).
2. **Real implementation** (`src/services/StellarService.js`) — makes live Horizon
   calls. Used only when `MOCK_STELLAR=false` and a real Stellar account is configured.

The service container (`src/config/serviceContainer.js`) selects the implementation at
startup based on `MOCK_STELLAR`. All application code depends on the interface, never on
the concrete implementation.

`MOCK_STELLAR_LATENCY_MS` can inject artificial latency into the mock to exercise
timeout and retry paths without real network round-trips.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Always use testnet | Flaky, requires funded accounts, slow, cannot run offline |
| HTTP record/replay (nock, VCR) | Cassettes go stale, hard to maintain for streaming SSE responses, and don't cover Stellar SDK internals |
| Run a local Stellar core node | Massive operational overhead for development; Docker image is 2+ GB and takes minutes to sync |
| Conditional mocking per test | Duplicates branching logic everywhere; harder to reason about |

## Consequences

**Positive:**
- All tests run offline and without any Stellar account. CI requires no secrets beyond
  `ENCRYPTION_KEY` and `API_KEYS`.
- Mock responses are deterministic, making assertions reliable.
- The mock can be swapped for a real client in integration/e2e test tiers without
  changing application code.
- `MOCK_STELLAR_LATENCY_MS` enables chaos-style latency testing cheaply.

**Negative / trade-offs:**
- The mock must be kept in sync with real Stellar SDK behaviour. Drift between mock and
  real can hide bugs until deployment.
- End-to-end tests that verify real transaction submission require a funded testnet
  account and run in a separate nightly pipeline (`e2e-nightly.yml`), not on every
  PR commit.

**Follow-on tasks:**
- [x] Nightly e2e pipeline (`e2e-nightly.yml`) with a real testnet account
- [x] `MOCK_STELLAR_LATENCY_MS` support for latency injection
- [ ] Contract test or schema check to detect mock/real drift automatically

---

*See also: `src/services/MockStellarService.js`, `src/services/StellarService.js`,
`src/config/serviceContainer.js`, `docs/configuration.md#4-stellar--horizon`*
