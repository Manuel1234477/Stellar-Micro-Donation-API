# Requirements Document

## Introduction

This feature adds transaction simulation (dry-run) support to the Stellar integration. Clients can submit a transaction XDR to a simulation endpoint and receive a validation result — including estimated fee and expected outcome — without the transaction ever being submitted to the Stellar network. This reduces failed transaction fees and improves client confidence before committing a donation.

## Glossary

- **StellarService**: The server-side service that wraps the Stellar Horizon SDK and handles all network interactions.
- **MockStellarService**: A test-double implementation of StellarService used in unit and integration tests.
- **Simulation**: A dry-run evaluation of a Stellar transaction XDR that validates the transaction and returns an estimated result without submitting to the network.
- **XDR**: External Data Representation — the binary-encoded format used to represent Stellar transactions.
- **Horizon**: The Stellar network's HTTP API server used for submitting transactions and querying network state.
- **Fee Stats**: Network fee statistics returned by Horizon, used to estimate the recommended transaction fee.
- **Stroops**: The smallest unit of XLM (1 XLM = 10,000,000 stroops).
- **Simulation_Controller**: The HTTP route handler that exposes the simulation endpoint.
- **Simulation_Result**: The structured response object returned by a simulation call, containing success status, estimated fee, expected result, and any errors.

## Requirements

### Requirement 1: Transaction Simulation Core Method

**User Story:** As a backend developer, I want a `simulateTransaction(xdr)` method on StellarService, so that I can validate a transaction and retrieve fee estimates without submitting it to the network.

#### Acceptance Criteria

1. THE StellarService SHALL expose a `simulateTransaction(xdr)` method that accepts a base64-encoded XDR string.
2. WHEN `simulateTransaction` is called with a valid XDR, THE StellarService SHALL decode and validate the transaction structure without submitting it to the Stellar network.
3. WHEN `simulateTransaction` is called with a valid XDR, THE StellarService SHALL return a Simulation_Result containing: `success: true`, `estimatedFee` (in stroops and XLM), and `estimatedResult` describing the expected operation outcomes.
4. WHEN `simulateTransaction` is called with a malformed or invalid XDR, THE StellarService SHALL return a Simulation_Result containing `success: false` and a descriptive `errors` array identifying the specific validation failure.
5. WHEN `simulateTransaction` is called and Horizon fee stats are unavailable, THE StellarService SHALL fall back to the Stellar base fee (100 stroops per operation) and include a `feeWarning` field in the Simulation_Result.
6. THE StellarService SHALL never call `server.submitTransaction` or any equivalent network-submission method during simulation.
7. WHEN `simulateTransaction` is called with an XDR containing multiple operations, THE StellarService SHALL calculate the estimated fee as the per-operation fee multiplied by the operation count.

### Requirement 2: Simulation HTTP Endpoint

**User Story:** As a client developer, I want a `POST /donations/simulate` endpoint, so that I can verify a donation transaction will succeed before committing it.

#### Acceptance Criteria

1. THE Simulation_Controller SHALL expose a `POST /donations/simulate` endpoint that accepts the same request schema as `POST /donations`.
2. WHEN a valid simulation request is received, THE Simulation_Controller SHALL invoke `StellarService.simulateTransaction` and return the Simulation_Result with HTTP status 200.
3. WHEN a simulation request is received with a missing or empty `xdr` field, THE Simulation_Controller SHALL return HTTP status 400 with a descriptive error message.
4. WHEN `StellarService.simulateTransaction` returns `success: false`, THE Simulation_Controller SHALL return HTTP status 422 with the Simulation_Result body so clients can inspect the errors.
5. IF an unexpected server error occurs during simulation, THEN THE Simulation_Controller SHALL return HTTP status 500 and log the error without exposing internal stack traces to the client.
6. THE Simulation_Controller SHALL apply the same authentication and rate-limiting middleware as the existing donation endpoints.

### Requirement 3: Simulation Result Schema

**User Story:** As a client developer, I want a consistent and descriptive simulation response, so that I can take actionable steps when a simulation fails.

#### Acceptance Criteria

1. THE Simulation_Result SHALL contain a boolean `success` field indicating whether the transaction is expected to succeed.
2. THE Simulation_Result SHALL contain an `estimatedFee` object with `stroops` (integer) and `xlm` (string, 7 decimal places) fields.
3. WHEN `success` is `true`, THE Simulation_Result SHALL contain an `estimatedResult` object describing the expected operation type, source account, and destination account.
4. WHEN `success` is `false`, THE Simulation_Result SHALL contain an `errors` array where each entry is a string describing a specific, actionable validation failure.
5. WHERE fee stats are unavailable, THE Simulation_Result SHALL contain a `feeWarning` string indicating that the fee estimate is based on the network base fee.
6. THE Simulation_Result SHALL contain a `simulatedAt` ISO 8601 timestamp indicating when the simulation was performed.

### Requirement 4: MockStellarService Simulation Support

**User Story:** As a test author, I want MockStellarService to implement `simulateTransaction`, so that unit and integration tests can exercise simulation logic without hitting the Stellar network.

#### Acceptance Criteria

1. THE MockStellarService SHALL implement a `simulateTransaction(xdr)` method with the same signature and return schema as StellarService.
2. WHEN `simulateTransaction` is called on MockStellarService with a non-empty XDR string, THE MockStellarService SHALL return a Simulation_Result with `success: true` and a realistic `estimatedFee` based on the configured mock fee.
3. WHEN `simulateTransaction` is called on MockStellarService with an empty or null XDR, THE MockStellarService SHALL return a Simulation_Result with `success: false` and an `errors` array containing a descriptive message.
4. WHEN failure simulation is enabled on MockStellarService, THE MockStellarService SHALL return a Simulation_Result with `success: false` and a descriptive error reflecting the configured failure type.
5. THE MockStellarService SHALL never invoke any real Horizon network calls during `simulateTransaction`.

### Requirement 5: No-Submission Enforcement

**User Story:** As a security reviewer, I want simulation to be strictly isolated from network submission, so that no simulated transaction can accidentally be broadcast to the Stellar network.

#### Acceptance Criteria

1. THE StellarService SHALL perform simulation using only local XDR decoding and Horizon fee stats queries — no transaction submission calls SHALL be made.
2. WHEN a simulation is performed, THE StellarService SHALL not call `server.submitTransaction`, `server.submitAsyncTransaction`, or any equivalent Horizon submission endpoint.
3. THE MockStellarService SHALL not call any real Horizon endpoints during `simulateTransaction`.
4. WHEN tests verify simulation behavior, THE tests SHALL assert that no submission method was called during the simulation lifecycle.

### Requirement 6: Test Coverage

**User Story:** As a quality engineer, I want comprehensive tests for transaction simulation, so that regressions are caught and the feature meets the 95% coverage requirement.

#### Acceptance Criteria

1. THE test suite SHALL include a test verifying that a successful simulation returns a Simulation_Result with `success: true` and a non-zero `estimatedFee`.
2. THE test suite SHALL include a test verifying that simulation with an invalid XDR returns a Simulation_Result with `success: false` and a non-empty `errors` array.
3. THE test suite SHALL include a test verifying that MockStellarService returns realistic simulation results matching the Simulation_Result schema.
4. THE test suite SHALL include a test verifying that no network submission method is called during simulation.
5. THE test suite SHALL include a test verifying that the `POST /donations/simulate` endpoint returns HTTP 422 when simulation returns `success: false`.
6. THE test suite SHALL include a test verifying that the `POST /donations/simulate` endpoint returns HTTP 400 when the `xdr` field is missing.
7. THE test suite SHALL achieve a minimum of 95% line and branch coverage for all new code introduced by this feature.

### Requirement 7: Documentation

**User Story:** As a developer integrating this feature, I want clear documentation and JSDoc comments, so that I can understand how to use and maintain the simulation feature.

#### Acceptance Criteria

1. THE StellarService `simulateTransaction` method SHALL include a JSDoc comment describing its parameters, return type, and the guarantee that it never submits to the network.
2. THE MockStellarService `simulateTransaction` method SHALL include a JSDoc comment describing its behavior and any configurable failure modes.
3. THE Simulation_Controller endpoint SHALL include inline documentation describing the request schema, response schema, and error codes.
4. THE documentation file `docs/features/TRANSACTION_SIMULATION.md` SHALL describe the endpoint, request/response schema, security assumptions (dry-run isolation, no side effects), and example usage.
