# Implementation Plan: Bulk Wallet Import

## Overview

Implement the `POST /wallets/bulk-import` endpoint using a layered approach: rate limiter middleware, a new `BulkWalletImportService`, a thin `StellarService.getAccountInfo` wrapper, a new `WalletService.createWalletRecord` method, and a new audit log action constant. Each layer is wired together in the route handler.

## Tasks

- [x] 1. Add `getAccountInfo` to StellarService
  - [x] 1.1 Implement `getAccountInfo(publicKey)` in `src/services/StellarService.js`
    - Wrap `server.loadAccount(publicKey)` and normalise outcomes into `{ balance }`, `{ notFound: true }`, or `{ error: true }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ]* 1.2 Write unit tests for `StellarService.getAccountInfo`
    - Test success (balance returned), 404 (notFound), and non-404 error (error) outcomes
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. Add `createWalletRecord` to WalletService
  - [x] 2.1 Implement `createWalletRecord(publicKey, balance)` in `src/services/WalletService.js`
    - Create a wallet record via `Wallet.create` with `address`, `balance`, `importedVia: "bulk-import"`, without triggering Friendbot or sponsorship
    - _Requirements: 3.2, 3.3_
  - [ ]* 2.2 Write unit tests for `WalletService.createWalletRecord`
    - Test record creation with a balance value and with `null` balance
    - _Requirements: 3.2, 3.3_

- [x] 3. Implement `BulkWalletImportService`
  - [x] 3.1 Create `src/services/BulkWalletImportService.js` with `_validateWallet(wallet, index)`
    - Check in order: private key fields present → `private_key_not_accepted`; missing/non-string `public_key` → `missing_public_key`; invalid StrKey → `invalid_address`
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ]* 3.2 Write property test for `_validateWallet` — Property 3
    - **Property 3: Validation failures produce correct status and reason**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [x] 3.3 Implement intra-batch duplicate detection in `BulkWalletImportService`
    - Build a seen-set after validation; mark subsequent occurrences of the same `public_key` as `duplicate`
    - _Requirements: 4.2_
  - [ ]* 3.4 Write property test for intra-batch duplicate detection — Property 9
    - **Property 9: Intra-batch duplicate — first wins, rest are duplicate**
    - **Validates: Requirements 4.2**
  - [x] 3.5 Implement data-store duplicate check in `BulkWalletImportService`
    - Call `WalletService.getWalletByAddress` for all valid, non-intra-batch-duplicate keys; mark matches as `duplicate`
    - _Requirements: 4.1, 4.3_
  - [ ]* 3.6 Write property test for data-store duplicate detection — Property 8
    - **Property 8: Data-store duplicate is flagged without creating a new record**
    - **Validates: Requirements 4.1**
  - [x] 3.7 Implement concurrent Horizon queries in `BulkWalletImportService`
    - Call `StellarService.getAccountInfo` for all remaining valid keys via `Promise.allSettled`; map outcomes to per-wallet results (`success`, `unfunded_account`, `horizon_unavailable`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ]* 3.8 Write property test for Horizon unfunded account — Property 6
    - **Property 6: Unfunded account still succeeds**
    - **Validates: Requirements 3.3**
  - [ ]* 3.9 Write property test for Horizon non-404 error — Property 7
    - **Property 7: Non-404 Horizon error produces failed result**
    - **Validates: Requirements 3.4**
  - [x] 3.10 Implement `importBatch(wallets, clientId)` — assemble results and summary
    - Call wallet creation for each passing wallet, assemble `results` array in original input order, compute `summary` object
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ]* 3.11 Write property test for results order and structure — Property 10
    - **Property 10: Results array preserves order and structure**
    - **Validates: Requirements 5.1, 5.2, 5.4**
  - [ ]* 3.12 Write property test for summary consistency — Property 11
    - **Property 11: Summary counts are consistent with results**
    - **Validates: Requirements 5.3**
  - [ ]* 3.13 Write property test for independent per-wallet processing — Property 2
    - **Property 2: Independent per-wallet processing**
    - **Validates: Requirements 1.2, 4.3**
  - [ ]* 3.14 Write property test for all-failed batch returns HTTP 200 — Property 4
    - **Property 4: All-failed batch returns HTTP 200**
    - **Validates: Requirements 2.4**

- [x] 4. Checkpoint — Ensure all service-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add `bulkImportRateLimiter` to rate limiter middleware
  - [x] 5.1 Add `bulkImportRateLimiter` instance to `src/middleware/rateLimiter.js`
    - Configure `windowMs: 60000`, `max: 10`, `keyGenerator` using `req.apiKey?.id || req.ip`, return 429 with `Retry-After` header on limit exceeded
    - _Requirements: 6.1, 6.2_
  - [ ]* 5.2 Write unit test for rate limiter — 11th request returns 429 with `Retry-After`
    - _Requirements: 6.1, 6.2_

- [x] 6. Add `BULK_WALLET_IMPORT` action to AuditLogService
  - [x] 6.1 Add `BULK_WALLET_IMPORT: 'BULK_WALLET_IMPORT'` constant to `src/services/AuditLogService.js`
    - _Requirements: 6.4_

- [x] 7. Wire up the route handler in `src/routes/wallet.js`
  - [x] 7.1 Add `POST /wallets/bulk-import` route with middleware chain and handler
    - Apply `requireApiKey`, `bulkImportRateLimiter`, Content-Type check (415), batch size validation (422 for 0 or >100), `checkPermission(PERMISSIONS.WALLETS_CREATE)`, then call `BulkWalletImportService.importBatch`; log audit entry; return 200 `{ results, summary }`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 6.3, 6.4_
  - [ ]* 7.2 Write property test for oversized batch rejection — Property 1
    - **Property 1: Oversized batch is rejected**
    - **Validates: Requirements 1.3**
  - [ ]* 7.3 Write property test for non-JSON Content-Type returns 415 — Property 12
    - **Property 12: Non-JSON Content-Type returns 415**
    - **Validates: Requirements 6.3**
  - [ ]* 7.4 Write property test for audit log correctness — Property 13
    - **Property 13: Audit log contains required fields without public keys**
    - **Validates: Requirements 6.4**
  - [ ]* 7.5 Write property test for funded account balance recorded — Property 5
    - **Property 5: Funded account balance is recorded**
    - **Validates: Requirements 3.2**
  - [ ]* 7.6 Write unit tests for route handler
    - Test: no API key → 401; `text/plain` Content-Type → 415; empty array → 422; batch of 100 accepted; batch of 101 rejected; mixed batch returns correct per-wallet results; successful import persists wallet record with correct `address` and `balance`; unfunded account creates record with `balance: null`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.4, 3.2, 3.3, 6.3_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
