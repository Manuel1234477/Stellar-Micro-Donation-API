# Implementation Plan: Stellar Transaction Simulation

## Overview

Implement dry-run transaction simulation for the Stellar integration. This adds `simulateTransaction(xdr)` to `StellarService` and `MockStellarService`, a new `POST /donations/simulate` route, and comprehensive tests — all without ever submitting a transaction to the Stellar network.

## Tasks

- [x] 1. Add `simulateTransaction` stub to `StellarServiceInterface`
  - Add abstract stub method `async simulateTransaction(_xdr)` that throws `'simulateTransaction() must be implemented'`
  - _Requirements: 1.1, 4.1_

- [x] 2. Implement `simulateTransaction` on `StellarService`
  - [x] 2.1 Implement core `simulateTransaction(xdr)` method in `src/services/StellarService.js`
    - Guard: return `success: false` immediately if `xdr` is falsy or not a string
    - Decode via `StellarSdk.TransactionBuilder.fromXDR(xdr, this.networkPassphrase)` in try/catch; return `success: false` with descriptive error on parse failure
    - Fetch fee stats via `this.server.feeStats()` in try/catch; fall back to `StellarSdk.BASE_FEE` (100 stroops) and set `feeWarning` on failure
    - Calculate `estimatedFeeStroops = recommendedFeePerOp * tx.operations.length`
    - Build `estimatedResult` from `tx.operations[0]` (type, source, destination)
    - Return fully-populated `Simulation_Result` with `success: true` and `simulatedAt` ISO 8601 timestamp
    - Add JSDoc comment explicitly stating the method never submits to the network
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.1, 3.2, 3.3, 3.5, 3.6, 7.1_

  - [ ]* 2.2 Write property test: no network submission during simulation (Property 1)
    - **Property 1: No network submission during simulation**
    - Use `fc.string()` as XDR input; assert `server.submitTransaction` spy was never called for any input
    - **Validates: Requirements 1.2, 1.6, 5.1, 5.2**

  - [ ]* 2.3 Write property test: successful simulation result schema (Property 2)
    - **Property 2: Successful simulation result schema**
    - Use a valid XDR generator (build real txs with StellarSdk); assert `success: true`, `estimatedFee.stroops` is positive integer, `estimatedFee.xlm` has 7 decimal places, `estimatedResult` has required fields, `simulatedAt` is ISO 8601
    - **Validates: Requirements 1.3, 3.1, 3.2, 3.3, 3.6**

  - [ ]* 2.4 Write property test: invalid XDR produces failure result (Property 3)
    - **Property 3: Invalid XDR produces failure result**
    - Use `fc.string().filter(s => !isValidXdr(s))`; assert `success: false` and `errors` is a non-empty string array
    - **Validates: Requirements 1.4, 3.4**

  - [ ]* 2.5 Write property test: fee scales linearly with operation count (Property 4)
    - **Property 4: Fee scales linearly with operation count**
    - Generate XDRs with `fc.integer({ min: 1, max: 10 })` operations; assert `estimatedFee.stroops === perOpFee * operationCount`
    - **Validates: Requirements 1.7**

  - [ ]* 2.6 Write unit tests for `StellarService.simulateTransaction`
    - Valid XDR → `success: true`, non-zero `estimatedFee`
    - Invalid XDR → `success: false`, non-empty `errors` array
    - `feeStats()` throws → result includes `feeWarning`, uses 100 stroops/op
    - Multi-operation XDR → fee equals per-op fee × operation count
    - No submission method called (spy assertion)
    - _Requirements: 6.1, 6.2, 6.4_

- [x] 3. Implement `simulateTransaction` on `MockStellarService`
  - [x] 3.1 Add `simulateTransaction(xdr)` method to `src/services/MockStellarService.js`
    - Return `success: false` with descriptive error if `xdr` is falsy/empty/null
    - Return `success: false` with configured failure message if `failureSimulation.enabled`
    - Otherwise return `success: true` with realistic `estimatedFee` based on configured mock fee, `estimatedResult`, and `simulatedAt`
    - Never call any real Horizon endpoint
    - Add JSDoc comment describing behavior and configurable failure modes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 5.5, 7.2_

  - [ ]* 3.2 Write property test: MockStellarService returns valid schema for non-empty XDR (Property 7)
    - **Property 7: MockStellarService returns valid schema for non-empty XDR**
    - Use `fc.string({ minLength: 1 })` with failure simulation disabled; assert `success: true`, `estimatedFee.stroops > 0`, valid `simulatedAt`
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 3.3 Write property test: MockStellarService failure simulation propagates (Property 8)
    - **Property 8: MockStellarService failure simulation propagates to result**
    - Use `fc.string()` with failure simulation enabled; assert `success: false`, `errors.length > 0`
    - **Validates: Requirements 4.4**

  - [ ]* 3.4 Write unit tests for `MockStellarService.simulateTransaction`
    - Non-empty XDR → schema-compliant `Simulation_Result`
    - Empty/null XDR → `success: false` with descriptive error
    - Failure simulation enabled → `success: false` with configured error
    - No real Horizon calls made
    - _Requirements: 6.3, 6.4_

- [x] 4. Checkpoint — Ensure all service-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add `POST /donations/simulate` route handler
  - [x] 5.1 Register the new endpoint in `src/routes/donation.js`
    - Define `simulateSchema` using `validateSchema` with `xdr` as a required, trimmed, non-empty string field
    - Register `router.post('/simulate', payloadSizeLimiter, donationRateLimiter, requireApiKey, simulateSchema, handler)` before the existing `POST /` handler
    - Handler: call `stellarService.simulateTransaction(xdr)`, return 200 on `success: true`, 422 on `success: false`, 500 on unexpected thrown error (no stack trace exposed)
    - Log unexpected errors with `log.error` including `requestId`
    - Add inline documentation describing request schema, response schema, and error codes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.3_

  - [ ]* 5.2 Write property test: endpoint returns 422 for failed simulation (Property 5)
    - **Property 5: Endpoint returns 422 for failed simulation**
    - Mock `simulateTransaction` to return `success: false`; assert HTTP status 422 and body contains `Simulation_Result`
    - **Validates: Requirements 2.4**

  - [ ]* 5.3 Write property test: endpoint returns 400 for missing xdr (Property 6)
    - **Property 6: Endpoint returns 400 for missing xdr**
    - Send requests with missing or empty `xdr` field; assert HTTP status 400 with descriptive error
    - **Validates: Requirements 2.3**

  - [ ]* 5.4 Write unit tests for `POST /donations/simulate`
    - Valid simulation → HTTP 200 with `Simulation_Result`
    - `success: false` simulation → HTTP 422 with `Simulation_Result`
    - Missing `xdr` → HTTP 400
    - Unauthenticated request → HTTP 401
    - Unexpected thrown error → HTTP 500, no stack trace in response body
    - _Requirements: 6.5, 6.6_

- [x] 6. Create feature documentation
  - Create `docs/features/TRANSACTION_SIMULATION.md` describing the endpoint, request/response schema, security assumptions (dry-run isolation, no side effects), and example usage
  - _Requirements: 7.4_

- [x] 7. Final checkpoint — Ensure all tests pass and coverage target is met
  - Ensure all tests pass and coverage for new code is ≥ 95% line and branch coverage, ask the user if questions arise.
  - _Requirements: 6.7_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** with a minimum of 100 iterations each, with a comment referencing the design property number
- The `POST /simulate` route must be registered before `POST /` to avoid route shadowing
