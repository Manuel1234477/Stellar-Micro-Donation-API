# Requirements Document

## Introduction

This feature adds support for reading and setting the Stellar account inflation destination via the wallet management API. While Stellar's inflation mechanism is deprecated and no longer active, the `inflation_destination` field remains a valid account attribute on the Stellar network. Legacy integrations and completeness of the account management feature set require the ability to read and update this field. The implementation adds a new `PATCH /wallets/:id/inflation-destination` endpoint, extends the `GET /wallets/:id` response to include the inflation destination, and adds a `setInflationDestination` method to `StellarService`. All changes are logged in the audit trail and validated for security.

## Glossary

- **StellarService**: The service class responsible for all interactions with the Stellar network via the Horizon API.
- **WalletService**: The service class responsible for wallet business logic and database operations.
- **AuditLogService**: The service class responsible for recording all significant system actions to the audit trail.
- **Inflation_Destination**: A Stellar account field that designates another Stellar account as the recipient of inflation votes. Deprecated but still a valid on-chain field.
- **Stellar_Public_Key**: A 56-character Base32-encoded string beginning with `G`, representing a valid Stellar account address (e.g., `GABC...XYZ`).
- **Horizon_API**: The Stellar network's HTTP API used to query account state and submit transactions.
- **Validator**: The component responsible for validating input fields such as Stellar public keys.
- **Secret_Key**: A 56-character Base32-encoded string beginning with `S`, representing the private key of a Stellar account. Never stored; used only transiently to sign transactions.

---

## Requirements

### Requirement 1: Set Inflation Destination via API

**User Story:** As an API consumer, I want to set the inflation destination for a wallet, so that I can manage all Stellar account fields through a consistent API.

#### Acceptance Criteria

1. WHEN a `PATCH /wallets/:id/inflation-destination` request is received with a valid `destination` and `sourceSecret`, THE API SHALL submit a `setOptions` transaction to the Stellar network setting the `inflationDest` field to the provided destination.
2. WHEN the inflation destination is set successfully, THE API SHALL return HTTP 200 with a JSON body containing `success: true` and the updated `inflationDestination` value.
3. WHEN a `PATCH /wallets/:id/inflation-destination` request is received with a `destination` that is not a valid Stellar public key, THE Validator SHALL reject the request and THE API SHALL return HTTP 400 with a descriptive error message.
4. WHEN a `PATCH /wallets/:id/inflation-destination` request is received with a missing `destination` field, THE Validator SHALL reject the request and THE API SHALL return HTTP 400 with a descriptive error message.
5. WHEN a `PATCH /wallets/:id/inflation-destination` request is received with a missing `sourceSecret` field, THE Validator SHALL reject the request and THE API SHALL return HTTP 400 with a descriptive error message.
6. WHEN a `PATCH /wallets/:id/inflation-destination` request references a wallet `id` that does not exist in the database, THE API SHALL return HTTP 404 with a descriptive error message.
7. WHEN the Stellar network returns an error during the `setOptions` transaction, THE API SHALL return HTTP 502 with a descriptive error message and THE StellarService SHALL log the error.

---

### Requirement 2: Read Inflation Destination via Wallet Detail

**User Story:** As an API consumer, I want the wallet detail response to include the inflation destination, so that I can inspect all relevant account fields in a single request.

#### Acceptance Criteria

1. WHEN a `GET /wallets/:id` request is received for an existing wallet, THE API SHALL include an `inflationDestination` field in the response `data` object.
2. WHEN the Stellar account has no inflation destination set, THE API SHALL return `inflationDestination: null` in the response.
3. WHEN the Stellar account has an inflation destination set, THE API SHALL return the destination as a valid Stellar public key string in the `inflationDestination` field.
4. IF the Horizon API is unavailable when fetching the inflation destination, THEN THE API SHALL return the wallet record with `inflationDestination: null` and SHALL NOT fail the entire `GET /wallets/:id` request.

---

### Requirement 3: StellarService — setInflationDestination Method

**User Story:** As a developer, I want a `setInflationDestination` method on `StellarService`, so that the inflation destination logic is encapsulated in the service layer and reusable.

#### Acceptance Criteria

1. THE StellarService SHALL expose a `setInflationDestination(sourceSecret, destinationPublicKey)` method.
2. WHEN `setInflationDestination` is called with a valid `sourceSecret` and `destinationPublicKey`, THE StellarService SHALL build and submit a Stellar `setOptions` transaction with `inflationDest` set to `destinationPublicKey`.
3. WHEN `setInflationDestination` is called with a `destinationPublicKey` that is not a valid Stellar public key, THE StellarService SHALL throw a `ValidationError` before submitting any transaction to the network.
4. WHEN the Stellar network rejects the `setOptions` transaction, THE StellarService SHALL propagate the error to the caller with a descriptive message.
5. WHEN `setInflationDestination` completes successfully, THE StellarService SHALL return an object containing the transaction `hash` and `ledger` number.

---

### Requirement 4: Stellar Public Key Validation

**User Story:** As a developer, I want all inflation destination inputs to be validated as proper Stellar public keys, so that invalid data is never submitted to the network.

#### Acceptance Criteria

1. THE Validator SHALL accept a Stellar public key as valid only when the key is a 56-character Base32-encoded string beginning with `G`.
2. WHEN a destination value fails Stellar public key validation, THE Validator SHALL produce an error message that identifies the field name and states the expected format.
3. THE Validator SHALL reject empty strings, null values, and non-string types as invalid Stellar public keys.
4. THE Validator SHALL use the `stellar-sdk` `StrKey.isValidEd25519PublicKey` method as the canonical validation function to ensure consistency with the Stellar protocol.

---

### Requirement 5: Audit Trail Logging

**User Story:** As a system operator, I want all inflation destination changes to be recorded in the audit trail, so that I can track who changed what and when for compliance and debugging.

#### Acceptance Criteria

1. WHEN a `PATCH /wallets/:id/inflation-destination` request succeeds, THE AuditLogService SHALL record an entry with category `WALLET_OPERATION`, action `INFLATION_DESTINATION_UPDATED`, severity `MEDIUM`, and result `SUCCESS`.
2. THE AuditLogService audit entry SHALL include the wallet `id`, the new `inflationDestination` value, the `userId` of the requester, the `requestId`, and the `ipAddress`.
3. WHEN a `PATCH /wallets/:id/inflation-destination` request fails due to a Stellar network error, THE AuditLogService SHALL record an entry with result `FAILURE` and include the error message in the `details` field.
4. THE AuditLogService SHALL record the audit entry after the Stellar transaction is confirmed and before the HTTP response is sent.

---

### Requirement 6: Security Constraints

**User Story:** As a security engineer, I want the inflation destination endpoint to enforce authentication and authorization, so that only permitted callers can modify Stellar account settings.

#### Acceptance Criteria

1. THE API SHALL require a valid authentication token on the `PATCH /wallets/:id/inflation-destination` endpoint.
2. THE API SHALL enforce the `WALLETS_UPDATE` permission on the `PATCH /wallets/:id/inflation-destination` endpoint using the existing RBAC middleware.
3. THE API SHALL enforce the `WALLETS_READ` permission on the `GET /wallets/:id` endpoint using the existing RBAC middleware.
4. THE API SHALL NOT log or persist the `sourceSecret` value in any audit log entry, database record, or application log.
5. WHEN the `sourceSecret` is present in a request, THE API SHALL use it only transiently to sign the Stellar transaction and SHALL discard it immediately after use.

---

### Requirement 7: Test Coverage

**User Story:** As a developer, I want comprehensive tests for the inflation destination feature, so that regressions are caught and the feature behaves correctly under all conditions.

#### Acceptance Criteria

1. THE test suite SHALL include a test verifying that a valid `PATCH /wallets/:id/inflation-destination` request sets the inflation destination and returns HTTP 200.
2. THE test suite SHALL include a test verifying that an invalid destination address returns HTTP 400.
3. THE test suite SHALL include a test verifying that a missing `destination` field returns HTTP 400.
4. THE test suite SHALL include a test verifying that a missing `sourceSecret` field returns HTTP 400.
5. THE test suite SHALL include a test verifying that a non-existent wallet `id` returns HTTP 404.
6. THE test suite SHALL include a test verifying that `GET /wallets/:id` returns the `inflationDestination` field in the response.
7. THE test suite SHALL include a test verifying that a successful `PATCH` request creates an audit log entry with the correct fields.
8. THE test suite SHALL achieve a minimum of 95% line coverage for all new code introduced by this feature.
