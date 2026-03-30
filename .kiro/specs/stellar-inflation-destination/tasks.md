# Implementation Plan: Stellar Inflation Destination

## Overview

Implement read and write support for the Stellar `inflation_destination` account field. The work spans the service layer (`StellarService`, `MockStellarService`, `StellarServiceInterface`), the wallet route handler, schema validation, audit logging, and tests.

## Tasks

- [x] 1. Add `INFLATION_DESTINATION_UPDATED` action constant to AuditLogService
  - Add `INFLATION_DESTINATION_UPDATED: 'INFLATION_DESTINATION_UPDATED'` to the actions map in `src/services/AuditLogService.js`
  - _Requirements: 5.1_

- [x] 2. Extend StellarServiceInterface with new method stubs
  - [x] 2.1 Add `setInflationDestination` and `getInflationDestination` abstract stubs to `src/services/interfaces/StellarServiceInterface.js`
    - Each stub should throw `Error('method() must be implemented')`
    - _Requirements: 3.1_

- [x] 3. Implement `StellarService` methods
  - [x] 3.1 Implement `getInflationDestination(publicKey)` in `src/services/StellarService.js`
    - Load account via `_executeWithRetry`, return `account.inflation_destination || null`
    - On any error, return `null` (graceful degradation)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.2 Write property test for `getInflationDestination` graceful degradation
    - **Property 4: GET /wallets/:id always includes inflationDestination field**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [x] 3.3 Implement `setInflationDestination(sourceSecret, destinationPublicKey)` in `src/services/StellarService.js`
    - Validate `destinationPublicKey` with `StellarSdk.StrKey.isValidEd25519PublicKey`; throw `ValidationError` if invalid
    - Derive keypair, load source account, build `setOptions({ inflationDest })` transaction, sign and submit
    - Return `{ hash, ledger }` on success; propagate Stellar errors as `BusinessLogicError`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.4_

  - [ ]* 3.4 Write property test for `setInflationDestination` — invalid key throws before network call
    - **Property 5: setInflationDestination with invalid key throws ValidationError before network call**
    - **Validates: Requirements 3.3, 4.1, 4.4**

  - [ ]* 3.5 Write property test for `setInflationDestination` — valid inputs return hash and ledger
    - **Property 6: setInflationDestination with valid inputs returns hash and ledger**
    - **Validates: Requirements 3.1, 3.2, 3.5**

- [x] 4. Implement `MockStellarService` methods
  - [x] 4.1 Add `getInflationDestination(publicKey)` to `src/services/MockStellarService.js`
    - Look up wallet by public key; return `wallet.inflationDestination || null`; return `null` if not found
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 Add `setInflationDestination(sourceSecret, destinationPublicKey)` to `src/services/MockStellarService.js`
    - Validate `destinationPublicKey` format; throw `ValidationError` if invalid
    - Find source wallet by secret; store `inflationDestination` on wallet object
    - Return `{ hash: 'mock_<hex>', ledger: <random> }`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1_

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Add PATCH route and extend GET route in `src/routes/wallet.js`
  - [ ] 6.1 Add `inflationDestinationSchema` using `validateSchema` for the PATCH body (`destination`, `sourceSecret` both required strings)
    - _Requirements: 1.3, 1.4, 1.5, 4.2_

  - [ ] 6.2 Add `PATCH /wallets/:id/inflation-destination` route handler
    - Apply auth middleware and `checkPermission(WALLETS_UPDATE)`
    - Apply `inflationDestinationSchema` validation middleware
    - Call `WalletService.getWalletById(id)`; return 404 if not found
    - Call `StellarService.setInflationDestination(sourceSecret, destination)`
    - On success: log audit entry (`INFLATION_DESTINATION_UPDATED`, `SUCCESS`) then return 200 `{ success: true, data: { inflationDestination } }`
    - On Stellar error: log audit entry (`FAILURE`) then return 502
    - Never include `sourceSecret` in audit log details
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.4, 6.5_

  - [ ] 6.3 Extend existing `GET /wallets/:id` handler to include `inflationDestination`
    - After fetching the wallet record, call `StellarService.getInflationDestination(wallet.address)`
    - Merge result into response `data`; default to `null` if call fails
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.3_

- [ ] 7. Write unit and integration tests
  - [ ] 7.1 Write unit tests for the PATCH endpoint covering all Requirement 7 cases
    - Valid PATCH returns 200 with `inflationDestination` in body (Req 7.1)
    - Invalid `destination` returns 400 (Req 7.2)
    - Missing `destination` returns 400 (Req 7.3)
    - Missing `sourceSecret` returns 400 (Req 7.4)
    - Non-existent wallet `id` returns 404 (Req 7.5)
    - Stellar network error returns 502
    - Unauthenticated request returns 401
    - Insufficient permissions returns 403
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 7.2 Write unit tests for the GET endpoint and audit log
    - `GET /wallets/:id` includes `inflationDestination` field (Req 7.6)
    - Successful PATCH creates audit log entry with correct fields (Req 7.7)
    - `sourceSecret` is absent from all audit log fields after a PATCH
    - _Requirements: 7.6, 7.7_

  - [ ]* 7.3 Write property test — valid PATCH sets inflation destination and returns correct response
    - **Property 1: Valid PATCH sets inflation destination and returns correct response**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 7.4 Write property test — invalid public key strings are rejected with 400
    - **Property 2: Invalid public key strings are rejected with 400**
    - **Validates: Requirements 1.3, 4.1, 4.2, 4.3**

  - [ ]* 7.5 Write property test — non-existent wallet ID returns 404
    - **Property 3: Non-existent wallet ID returns 404**
    - **Validates: Requirements 1.6**

  - [ ]* 7.6 Write property test — successful PATCH creates audit log with all required fields
    - **Property 7: Successful PATCH creates audit log with all required fields**
    - **Validates: Requirements 5.1, 5.2, 5.4**

  - [ ]* 7.7 Write property test — sourceSecret never appears in audit log entries
    - **Property 8: sourceSecret never appears in audit log entries**
    - **Validates: Requirements 6.4**

- [ ] 8. Final checkpoint — Ensure all tests pass and coverage ≥ 95%
  - Ensure all tests pass, ask the user if questions arise.
  - Verify line coverage for all new code meets the ≥ 95% target (Req 7.8)

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use **fast-check** with a minimum of 100 iterations each
- Each property test must include a comment: `// Feature: stellar-inflation-destination, Property N: <title>`
- `sourceSecret` must never appear in logs, audit entries, or responses — enforced at the route handler level
