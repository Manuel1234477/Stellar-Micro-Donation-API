# Requirements Document

## Introduction

This feature adds a bulk wallet import endpoint to the API, allowing organizations migrating from other platforms to register multiple existing Stellar wallets in a single request. The endpoint accepts a list of Stellar public keys, validates each one, checks on-chain status via Horizon, and returns per-wallet results without failing the entire batch on individual errors.

## Glossary

- **API**: The backend service exposing wallet management endpoints.
- **Wallet**: A record representing a Stellar account managed by the API, identified by a Stellar public key.
- **Public_Key**: A Stellar Ed25519 public key in StrKey encoding (starts with "G", 56 characters).
- **Horizon**: The Stellar network's HTTP API used to query account balances and transaction history.
- **Bulk_Import_Request**: An HTTP POST request to `/wallets/bulk-import` containing an array of wallet objects.
- **Import_Result**: A per-wallet object in the response indicating `success`, `duplicate`, or `failed` status.
- **Batch**: The full set of wallet objects submitted in a single Bulk_Import_Request.
- **Duplicate**: A wallet whose Public_Key already exists in the API's data store.
- **Rate_Limiter**: The middleware component that restricts the number of requests per client within a time window.

## Requirements

### Requirement 1: Bulk Import Endpoint

**User Story:** As an organization administrator, I want to submit multiple Stellar public keys in one request, so that I can migrate existing wallets without making individual API calls.

#### Acceptance Criteria

1. THE API SHALL expose a `POST /wallets/bulk-import` endpoint that accepts a JSON request body.
2. WHEN a Bulk_Import_Request is received, THE API SHALL process each wallet object in the request array independently.
3. WHEN a Bulk_Import_Request contains more than 100 wallet objects, THE API SHALL reject the entire request with HTTP 422 and an error message indicating the batch size limit.
4. WHEN a Bulk_Import_Request contains 0 wallet objects, THE API SHALL reject the request with HTTP 422 and an error message indicating the array must not be empty.
5. THE API SHALL require authentication on the `POST /wallets/bulk-import` endpoint and return HTTP 401 for unauthenticated requests.

### Requirement 2: Public Key Validation

**User Story:** As an organization administrator, I want invalid Stellar addresses to be identified per-wallet, so that I can correct them without losing the rest of the batch.

#### Acceptance Criteria

1. WHEN a wallet object contains a Public_Key that does not conform to Stellar StrKey encoding (56-character G-prefixed string), THE API SHALL set that wallet's Import_Result status to `failed` with a reason of `invalid_address`.
2. WHEN a wallet object is missing the `public_key` field, THE API SHALL set that wallet's Import_Result status to `failed` with a reason of `missing_public_key`.
3. THE API SHALL accept no private key fields in wallet objects; WHEN a wallet object contains a `secret_key` or `private_key` field, THE API SHALL set that wallet's Import_Result status to `failed` with a reason of `private_key_not_accepted`.
4. WHEN all wallet objects in a Batch fail validation, THE API SHALL return HTTP 200 with all Import_Results set to `failed`.

### Requirement 3: Horizon Account Verification

**User Story:** As an organization administrator, I want each wallet's on-chain status checked, so that I know whether the imported wallets are active on the Stellar network.

#### Acceptance Criteria

1. WHEN a wallet object passes Public_Key validation, THE API SHALL query Horizon for the account associated with that Public_Key.
2. WHEN Horizon returns account data for a Public_Key, THE API SHALL record the account's XLM balance in the wallet record.
3. WHEN Horizon returns a 404 for a Public_Key, THE API SHALL still create the wallet record and set the Import_Result status to `success` with a note of `unfunded_account`.
4. WHEN Horizon returns an error other than 404, THE API SHALL set that wallet's Import_Result status to `failed` with a reason of `horizon_unavailable`.
5. WHILE processing a Batch, THE API SHALL query Horizon for each valid Public_Key concurrently to minimize total response time.

### Requirement 4: Duplicate Detection

**User Story:** As an organization administrator, I want duplicate wallets to be flagged without stopping the import, so that I can identify already-registered addresses without losing new ones.

#### Acceptance Criteria

1. WHEN a wallet object's Public_Key already exists in the API data store, THE API SHALL set that wallet's Import_Result status to `duplicate` and SHALL NOT create a new wallet record.
2. WHEN a Batch contains the same Public_Key more than once, THE API SHALL process the first occurrence and set all subsequent occurrences' Import_Result status to `duplicate`.
3. WHEN a Batch contains duplicate wallets alongside valid new wallets, THE API SHALL successfully import the valid new wallets and return `duplicate` status for the duplicates.

### Requirement 5: Per-Wallet Import Results

**User Story:** As an organization administrator, I want a detailed result for each submitted wallet, so that I can audit the import and take corrective action on failures.

#### Acceptance Criteria

1. THE API SHALL return HTTP 200 with a JSON response body containing an `results` array where each element corresponds to a wallet object in the request, preserving input order.
2. THE API SHALL include the following fields in each Import_Result: `public_key`, `status` (one of `success`, `duplicate`, `failed`), and `reason` (a string, present when status is `failed` or `duplicate`, null otherwise).
3. WHEN at least one wallet is successfully imported, THE API SHALL include a `summary` object in the response with `total`, `succeeded`, `duplicates`, and `failed` counts.
4. WHEN a wallet is successfully imported, THE API SHALL include the wallet's `id` field in its Import_Result.

### Requirement 6: Security Controls

**User Story:** As a platform operator, I want the bulk import endpoint to be protected against abuse, so that the API remains stable and secure under high request volumes.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL restrict each authenticated client to no more than 10 Bulk_Import_Requests per minute on the `POST /wallets/bulk-import` endpoint.
2. WHEN a client exceeds the rate limit, THE API SHALL return HTTP 429 with a `Retry-After` header indicating when the client may retry.
3. THE API SHALL validate that the request `Content-Type` is `application/json`; WHEN the Content-Type is not `application/json`, THE API SHALL return HTTP 415.
4. THE API SHALL log each Bulk_Import_Request with the authenticated client identifier, batch size, and timestamp, without logging Public_Key values in plaintext at DEBUG level or below.
