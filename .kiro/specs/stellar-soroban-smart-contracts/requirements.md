# Requirements Document

## Introduction

This feature adds Stellar Soroban smart contract support to the existing Stellar Micro-Donation API. Soroban is Stellar's smart contract platform, enabling programmable donation logic such as escrow-based releases (funds released only when a campaign goal is met) and automatic fee distribution. The implementation extends `StellarService` with a Soroban RPC client, adds a `invokeContract` method, exposes a `GET /contracts/:id/events` endpoint for contract event monitoring, provides an example donation escrow contract, and extends `MockStellarService` to simulate all contract interactions without requiring a live network.

## Glossary

- **StellarService**: The real blockchain service class in `src/services/StellarService.js` that interacts with the Stellar network.
- **MockStellarService**: The in-memory mock service class in `src/services/MockStellarService.js` used for testing without network calls.
- **Soroban_RPC_Client**: The HTTP client component within `StellarService` that communicates with a Soroban RPC endpoint.
- **Contract_Invocation**: The act of calling a named method on a deployed Soroban smart contract with a set of arguments, returning a result.
- **Contract_Event**: A structured event emitted by a Soroban smart contract during execution, containing a contract ID, event type, topics, and a data payload.
- **Event_Store**: The in-memory or persistent collection that holds `Contract_Event` records indexed by contract ID.
- **Escrow_Contract**: An example Soroban smart contract (JavaScript simulation) that holds donated funds and releases them only when a configurable campaign goal amount is reached.
- **ContractId**: A string identifier for a deployed Soroban smart contract (e.g., `C...` Stellar contract address format).
- **InvocationResult**: The structured response returned after a successful or failed contract method call, containing a status, return value, and any emitted events.

---

## Requirements

### Requirement 1: Soroban RPC Client Initialization

**User Story:** As a backend developer, I want `StellarService` to initialize a Soroban RPC client on construction, so that all Soroban interactions use a consistent, configurable connection.

#### Acceptance Criteria

1. THE `StellarService` SHALL accept a `sorobanRpcUrl` configuration parameter during construction.
2. WHEN `sorobanRpcUrl` is not provided, THE `StellarService` SHALL default to `https://soroban-testnet.stellar.org`.
3. THE `StellarService` SHALL expose the initialized `Soroban_RPC_Client` as an accessible property for use by contract methods.
4. IF `sorobanRpcUrl` is an empty string, THEN THE `StellarService` SHALL throw an `Error` with the message `"sorobanRpcUrl must not be empty"`.

---

### Requirement 2: Contract Invocation

**User Story:** As a backend developer, I want to invoke Soroban smart contract methods via `StellarService`, so that the API can trigger programmable donation logic on-chain.

#### Acceptance Criteria

1. THE `StellarService` SHALL expose an `invokeContract(contractId, method, args)` method.
2. WHEN `invokeContract` is called with a valid `contractId`, `method`, and `args`, THE `StellarService` SHALL submit the invocation to the Soroban RPC endpoint and return an `InvocationResult`.
3. THE `InvocationResult` SHALL contain a `status` field with value `"success"` or `"error"`, a `returnValue` field, and an `events` array of `Contract_Event` objects emitted during the invocation.
4. IF `contractId` is missing or not a non-empty string, THEN THE `StellarService` SHALL throw an `Error` with the message `"contractId is required"`.
5. IF `method` is missing or not a non-empty string, THEN THE `StellarService` SHALL throw an `Error` with the message `"method is required"`.
6. IF `args` is not an array, THEN THE `StellarService` SHALL throw an `Error` with the message `"args must be an array"`.
7. WHEN the Soroban RPC endpoint returns an error response, THE `StellarService` SHALL throw an `Error` containing the RPC error message.

---

### Requirement 3: Contract Event Monitoring and Storage

**User Story:** As a backend developer, I want contract events to be stored after each invocation, so that they can be retrieved later for auditing and monitoring.

#### Acceptance Criteria

1. WHEN `invokeContract` completes successfully, THE `StellarService` SHALL store all `Contract_Event` objects from the `InvocationResult` in the `Event_Store`, keyed by `contractId`.
2. THE `StellarService` SHALL expose a `getContractEvents(contractId, limit)` method that returns stored events for the given `contractId`.
3. WHEN `getContractEvents` is called with a valid `contractId`, THE `StellarService` SHALL return an array of `Contract_Event` objects in reverse-chronological order (most recent first).
4. WHEN `getContractEvents` is called with a `limit` parameter, THE `StellarService` SHALL return at most `limit` events.
5. WHEN `getContractEvents` is called for a `contractId` with no stored events, THE `StellarService` SHALL return an empty array.
6. IF `contractId` is missing or not a non-empty string in `getContractEvents`, THEN THE `StellarService` SHALL throw an `Error` with the message `"contractId is required"`.

---

### Requirement 4: GET /contracts/:id/events API Endpoint

**User Story:** As an API consumer, I want a REST endpoint to retrieve contract events by contract ID, so that I can monitor smart contract activity without direct blockchain access.

#### Acceptance Criteria

1. THE API SHALL expose a `GET /contracts/:id/events` endpoint.
2. WHEN a `GET /contracts/:id/events` request is received with a valid contract ID, THE API SHALL return a `200` response with a JSON body containing `{ success: true, data: [Contract_Event], count: number }`.
3. WHEN a `GET /contracts/:id/events` request is received and no events exist for the contract ID, THE API SHALL return a `200` response with `{ success: true, data: [], count: 0 }`.
4. WHEN a `GET /contracts/:id/events` request includes a `limit` query parameter, THE API SHALL pass the parsed integer value to `getContractEvents` and return at most that many events.
5. IF the `limit` query parameter is present but not a positive integer, THEN THE API SHALL return a `400` response with `{ success: false, error: { code: "INVALID_REQUEST", message: "limit must be a positive integer" } }`.
6. WHEN an unexpected server error occurs while handling `GET /contracts/:id/events`, THE API SHALL return a `500` response with `{ success: false, error: { code: "FETCH_EVENTS_FAILED", message: <error message> } }`.

---

### Requirement 5: Example Donation Escrow Contract

**User Story:** As a developer, I want an example donation escrow contract implementation, so that I can understand how Soroban enables goal-based donation release logic.

#### Acceptance Criteria

1. THE codebase SHALL include an `EscrowContract` class in `src/contracts/EscrowContract.js` that simulates a Soroban escrow contract in JavaScript.
2. THE `EscrowContract` SHALL expose a `deposit(donorId, amount)` method that adds the `amount` to the escrow balance and records the donor.
3. THE `EscrowContract` SHALL expose a `release(recipientId)` method that transfers the full escrow balance to the recipient when the campaign goal has been met.
4. WHEN `release` is called and the escrow balance is less than the configured `goalAmount`, THE `EscrowContract` SHALL throw an `Error` with the message `"Goal not yet reached"`.
5. WHEN `release` is called and the escrow balance meets or exceeds `goalAmount`, THE `EscrowContract` SHALL return an object containing `{ recipientId, amount, events }` where `events` is an array of `Contract_Event` objects describing the release.
6. THE `EscrowContract` SHALL expose a `getState()` method returning `{ balance, goalAmount, donors, released }`.
7. IF `deposit` is called with a non-positive `amount`, THEN THE `EscrowContract` SHALL throw an `Error` with the message `"amount must be positive"`.

---

### Requirement 6: MockStellarService Contract Simulation

**User Story:** As a test author, I want `MockStellarService` to simulate Soroban contract interactions in memory, so that all tests run without a live Stellar network.

#### Acceptance Criteria

1. THE `MockStellarService` SHALL expose an `invokeContract(contractId, method, args)` method with the same signature as `StellarService`.
2. WHEN `MockStellarService.invokeContract` is called, THE `MockStellarService` SHALL record the invocation in an internal `contractInvocations` map keyed by `contractId`.
3. WHEN `MockStellarService.invokeContract` is called with `method` equal to `"deposit"`, THE `MockStellarService` SHALL simulate a successful deposit and return an `InvocationResult` with `status: "success"` and a mock `Contract_Event` of type `"deposit"`.
4. WHEN `MockStellarService.invokeContract` is called with `method` equal to `"release"` and the simulated balance meets the goal, THE `MockStellarService` SHALL return an `InvocationResult` with `status: "success"` and a mock `Contract_Event` of type `"release"`.
5. WHEN `MockStellarService.invokeContract` is called with `method` equal to `"release"` and the simulated balance does not meet the goal, THE `MockStellarService` SHALL return an `InvocationResult` with `status: "error"` and `returnValue: "Goal not yet reached"`.
6. THE `MockStellarService` SHALL expose a `getContractEvents(contractId, limit)` method that returns stored mock events for the given `contractId`.
7. IF `contractId` is missing or not a non-empty string in either `invokeContract` or `getContractEvents`, THEN THE `MockStellarService` SHALL throw an `Error` with the message `"contractId is required"`.
8. IF `method` is missing or not a non-empty string in `invokeContract`, THEN THE `MockStellarService` SHALL throw an `Error` with the message `"method is required"`.

---

### Requirement 7: Test Coverage

**User Story:** As a developer, I want comprehensive tests for all Soroban contract features, so that the implementation is verifiable without a live Stellar network.

#### Acceptance Criteria

1. THE test file `tests/stellar-soroban-smart-contracts.test.js` SHALL cover all success paths for `invokeContract` and `getContractEvents` on `MockStellarService`.
2. THE test file SHALL cover all validation error paths for `invokeContract` and `getContractEvents` (missing `contractId`, missing `method`, non-array `args`).
3. THE test file SHALL cover the `GET /contracts/:id/events` endpoint for success, empty results, limit filtering, invalid limit, and server error scenarios.
4. THE test file SHALL cover the `EscrowContract` deposit, release (goal met), release (goal not met), and invalid deposit amount scenarios.
5. WHEN all tests in `tests/stellar-soroban-smart-contracts.test.js` are executed, THE test suite SHALL achieve at least 95% statement, branch, function, and line coverage for all new source files.
6. THE test file SHALL use only `MockStellarService` and SHALL NOT make any live network calls.
