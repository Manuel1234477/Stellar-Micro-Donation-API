# Implementation Plan: Stellar Soroban Smart Contracts

## Overview

Implement Soroban smart contract support by extending `StellarService` and `MockStellarService`, adding a new contracts route, creating an `EscrowContract` example, and writing comprehensive tests. All tasks build incrementally — no orphaned code.

## Tasks

- [x] 1. Install fast-check and set up the contracts directory
  - Run `npm install --save-dev fast-check` to add the property-based testing library
  - Create `src/contracts/` directory
  - _Requirements: 7.1_

- [x] 2. Implement EscrowContract
  - [x] 2.1 Create `src/contracts/EscrowContract.js`
    - Implement `constructor(goalAmount)` — validate goalAmount is positive
    - Implement `deposit(donorId, amount)` — validate amount > 0, accumulate balance and per-donor totals
    - Implement `release(recipientId)` — throw `"Goal not yet reached"` if balance < goalAmount; otherwise return `{ recipientId, amount, events }` with a `ContractEvent` of type `"release"`
    - Implement `getState()` — return `{ balance, goalAmount, donors, released }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 2.2 Write property test: deposit accumulation invariant
    - **Property 3: Deposit accumulation invariant**
    - *For any* sequence of positive deposit amounts, `getState().balance` must equal their sum
    - **Validates: Requirements 5.2, 5.6**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 3`

  - [ ]* 2.3 Write property test: release only when goal is met
    - **Property 4: Escrow release only when goal is met**
    - *For any* `goalAmount` and `balance`, release throws iff `balance < goalAmount`; when `balance >= goalAmount` the return value contains `{ recipientId, amount, events }`
    - **Validates: Requirements 5.3, 5.4, 5.5**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 4`

  - [ ]* 2.4 Write unit tests for EscrowContract edge cases
    - Test `deposit` with non-positive amount throws `"amount must be positive"`
    - Test `getState()` shape after construction
    - Test `release` emits a `ContractEvent` with type `"release"`
    - _Requirements: 5.7_

- [x] 3. Extend MockStellarService with contract support
  - [x] 3.1 Add contract state to `MockStellarService` constructor
    - Add `this.contractInvocations = new Map()` and `this.contractEvents = new Map()`
    - _Requirements: 6.2_

  - [x] 3.2 Implement `MockStellarService.invokeContract(contractId, method, args)`
    - Validate `contractId` (non-empty string) — throw `"contractId is required"`
    - Validate `method` (non-empty string) — throw `"method is required"`
    - Validate `args` is an array — throw `"args must be an array"`
    - For `method === "deposit"`: accumulate balance in `contractInvocations`, store a `ContractEvent` of type `"deposit"`, return `{ status: "success", returnValue: null, events: [depositEvent] }`
    - For `method === "release"`: if balance >= goal (from args or default), return `{ status: "success", returnValue: null, events: [releaseEvent] }`; else return `{ status: "error", returnValue: "Goal not yet reached", events: [] }`
    - For any other method: return `{ status: "success", returnValue: null, events: [] }`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8_

  - [x] 3.3 Implement `MockStellarService.getContractEvents(contractId, limit)`
    - Validate `contractId` — throw `"contractId is required"`
    - Return stored events for `contractId` in reverse-chronological order, sliced to `limit` if provided
    - Return empty array if no events exist for `contractId`
    - _Requirements: 6.6, 3.3, 3.4, 3.5_

  - [ ]* 3.4 Write property test: mock deposit records invocation and emits event
    - **Property 6: Mock deposit records invocation and emits event**
    - *For any* `contractId` and positive deposit amount, `invokeContract` returns `status: "success"` and `getContractEvents` returns a deposit event
    - **Validates: Requirements 6.2, 6.3, 6.6**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 6`

  - [ ]* 3.5 Write property test: mock release round-trip
    - **Property 7: Mock deposit/release round-trip**
    - *For any* sequence of deposits that meets the goal, a subsequent release returns `status: "success"` and the release event is retrievable via `getContractEvents`
    - **Validates: Requirements 6.4, 6.5, 6.6**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 7`

  - [ ]* 3.6 Write unit tests for MockStellarService validation errors
    - Test missing/empty `contractId` in `invokeContract` and `getContractEvents`
    - Test missing/empty `method` in `invokeContract`
    - Test non-array `args` in `invokeContract`
    - _Requirements: 6.7, 6.8_

- [ ] 4. Checkpoint — Ensure all tests pass so far
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Extend StellarService with Soroban RPC client and contract methods
  - [x] 5.1 Update `StellarService` constructor to accept and validate `sorobanRpcUrl`
    - Default to `'https://soroban-testnet.stellar.org'` when not provided
    - Throw `Error("sorobanRpcUrl must not be empty")` if empty string is passed
    - Store as `this.sorobanRpcUrl`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 5.2 Implement `StellarService.invokeContract(contractId, method, args)`
    - Apply the same input validation as `MockStellarService` (contractId, method, args)
    - Make a JSON-RPC 2.0 POST to `this.sorobanRpcUrl` using `axios` (already a dependency)
    - On RPC error response, throw `Error` with the RPC error message
    - Store emitted events via `this._storeEvents(contractId, events)`
    - Return `InvocationResult`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 5.3 Implement `StellarService.getContractEvents(contractId, limit)` and `_storeEvents`
    - `_storeEvents(contractId, events)` — append events to `this._eventStore` map
    - `getContractEvents(contractId, limit)` — validate contractId, return events in reverse-chronological order, sliced to limit
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 5.4 Write property test: event storage round-trip
    - **Property 1: Contract event storage round-trip**
    - *For any* `contractId` and N mock invocations that emit events, `getContractEvents(contractId)` returns exactly those events and no events from other contracts
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 1`

  - [ ]* 5.5 Write property test: event limit respected
    - **Property 2: Event limit is respected**
    - *For any* N stored events and positive integer limit L, `getContractEvents(contractId, L)` returns at most `min(N, L)` events
    - **Validates: Requirements 3.4**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 2`

  - [ ]* 5.6 Write property test: InvocationResult shape invariant
    - **Property 1 (mock): InvocationResult shape invariant**
    - *For any* valid `contractId`, `method`, and `args`, `invokeContract` returns an object with `status`, `returnValue`, and `events` fields
    - **Validates: Requirements 2.2, 2.3**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 1`

  - [ ]* 5.7 Write property test: validation error consistency
    - **Property 6: Validation error consistency**
    - *For any* call with missing or empty `contractId`, both `StellarService` and `MockStellarService` throw `Error("contractId is required")`
    - **Validates: Requirements 2.4, 6.7**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property 6`

  - [ ]* 5.8 Write unit tests for StellarService constructor and RPC error propagation
    - Test default `sorobanRpcUrl`
    - Test empty string throws correct error
    - Test RPC error response propagates as thrown Error
    - _Requirements: 1.1, 1.2, 1.4, 2.7_

- [x] 6. Create the contracts route and wire it into the app
  - [x] 6.1 Create `src/routes/contracts.js`
    - Import `getStellarService` from `src/config/stellar.js`
    - Implement `GET /contracts/:id/events`
      - Parse and validate `limit` query param (must be positive integer if present)
      - Call `stellarService.getContractEvents(req.params.id, limit)`
      - Return `{ success: true, data, count: data.length }` on success
      - Return `400` with `INVALID_REQUEST` for invalid limit
      - Return `500` with `FETCH_EVENTS_FAILED` on unexpected error
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 6.2 Register the contracts route in `src/routes/app.js`
    - Add `const contractRoutes = require('./contracts')`
    - Add `app.use('/contracts', contractRoutes)`
    - _Requirements: 4.1_

  - [ ]* 6.3 Write unit tests for GET /contracts/:id/events
    - Test 200 with events returned
    - Test 200 with empty array when no events exist
    - Test limit query param filters results
    - Test 400 for invalid limit (non-integer, zero, negative)
    - Test 500 when service throws
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 6.4 Write property test: API response shape
    - **Property (API): GET /contracts/:id/events response shape**
    - *For any* valid contract ID, the response always has `{ success: true, data: Array, count: number }` where `count === data.length`
    - **Validates: Requirements 4.2, 4.3**
    - Tag: `Feature: stellar-soroban-smart-contracts, Property API`

- [x] 7. Final checkpoint — Ensure all tests pass and coverage meets 95%
  - Ensure all tests pass, ask the user if questions arise.
  - Verify coverage with `npx jest --coverage tests/stellar-soroban-smart-contracts.test.js`

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `MockStellarService` is used for all tests — no live network calls
- `fast-check` property tests run a minimum of 100 iterations each
- Each property test references its design document property number
- The `EscrowContract` is a JavaScript simulation, not a compiled Rust/Wasm contract
