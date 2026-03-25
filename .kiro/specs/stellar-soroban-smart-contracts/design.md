# Design Document: Stellar Soroban Smart Contracts

## Overview

This feature extends the Stellar Micro-Donation API with Soroban smart contract support. The implementation adds a Soroban RPC client to `StellarService`, a contract invocation method, an in-memory event store, a new REST endpoint for event retrieval, a JavaScript-simulated `EscrowContract`, and full mock support in `MockStellarService`. No live Stellar network is required for tests.

The Soroban RPC protocol uses JSON-RPC 2.0 over HTTPS. The relevant methods are `simulateTransaction` (dry-run) and `sendTransaction` (submit). For this API layer, invocations are modeled as fire-and-return calls that return a result and any emitted events. The Soroban RPC testnet endpoint is `https://soroban-testnet.stellar.org`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│                   (REST API Consumers)                       │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      EXPRESS APP                             │
│                   (src/routes/app.js)                        │
└──────┬──────────────────────────────────────────────────┬────┘
       │                                                  │
       ▼                                                  ▼
┌─────────────────┐                          ┌───────────────────────┐
│  Existing       │                          │  NEW: contracts.js    │
│  Routes         │                          │  GET /contracts/:id/  │
│  (donation,     │                          │       events          │
│   stats, etc.)  │                          └──────────┬────────────┘
└─────────────────┘                                     │
                                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                           │
│                                                              │
│  StellarService (extended)      MockStellarService (extended)│
│  ─────────────────────────      ──────────────────────────── │
│  + sorobanRpcClient             + contractInvocations Map    │
│  + invokeContract()             + contractEvents Map         │
│  + getContractEvents()          + invokeContract()           │
│  + _storeEvents() (private)     + getContractEvents()        │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    CONTRACT LAYER (NEW)                      │
│              src/contracts/EscrowContract.js                 │
│  + constructor(goalAmount)                                   │
│  + deposit(donorId, amount)                                  │
│  + release(recipientId)                                      │
│  + getState()                                                │
└──────────────────────────────────────────────────────────────┘
```

---

## Components and Interfaces

### 1. StellarService (extended)

**File:** `src/services/StellarService.js`

New constructor parameter:
```js
constructor(config = {})
// config.sorobanRpcUrl — defaults to 'https://soroban-testnet.stellar.org'
// Throws if sorobanRpcUrl is an empty string
```

New methods:
```js
/**
 * Invoke a Soroban smart contract method.
 * @param {string} contractId
 * @param {string} method
 * @param {Array} args
 * @returns {Promise<InvocationResult>}
 */
async invokeContract(contractId, method, args)

/**
 * Retrieve stored events for a contract.
 * @param {string} contractId
 * @param {number} [limit]
 * @returns {Promise<ContractEvent[]>}
 */
async getContractEvents(contractId, limit)
```

Internal state:
```js
this._eventStore = new Map(); // contractId -> ContractEvent[]
```

### 2. MockStellarService (extended)

**File:** `src/services/MockStellarService.js`

New internal state:
```js
this.contractInvocations = new Map(); // contractId -> invocation[]
this.contractEvents = new Map();      // contractId -> ContractEvent[]
```

New methods mirror `StellarService`:
```js
async invokeContract(contractId, method, args) -> InvocationResult
async getContractEvents(contractId, limit) -> ContractEvent[]
```

Simulation rules:
- `method === "deposit"`: always succeeds, emits a `"deposit"` event, accumulates balance in `contractInvocations`.
- `method === "release"` with balance >= goal: succeeds, emits a `"release"` event, resets balance.
- `method === "release"` with balance < goal: returns `{ status: "error", returnValue: "Goal not yet reached", events: [] }`.
- Any other method: returns `{ status: "success", returnValue: null, events: [] }`.

### 3. contracts.js Route

**File:** `src/routes/contracts.js`

```
GET /contracts/:id/events
  Query params: limit (optional, positive integer)
  Response 200: { success: true, data: ContractEvent[], count: number }
  Response 400: { success: false, error: { code: "INVALID_REQUEST", message: string } }
  Response 500: { success: false, error: { code: "FETCH_EVENTS_FAILED", message: string } }
```

### 4. EscrowContract

**File:** `src/contracts/EscrowContract.js`

```js
class EscrowContract {
  constructor(goalAmount)   // goalAmount must be positive
  deposit(donorId, amount)  // amount must be positive; accumulates balance
  release(recipientId)      // throws if balance < goalAmount; returns { recipientId, amount, events }
  getState()                // returns { balance, goalAmount, donors, released }
}
```

---

## Data Models

### ContractEvent
```js
{
  contractId: string,      // The contract that emitted the event
  type: string,            // e.g. "deposit", "release", "transfer"
  topics: string[],        // Indexed topics for filtering
  data: object,            // Arbitrary event payload
  timestamp: string,       // ISO 8601
  ledger: number           // Simulated ledger sequence number
}
```

### InvocationResult
```js
{
  status: "success" | "error",
  returnValue: any,          // Contract return value or error message
  events: ContractEvent[]    // Events emitted during invocation
}
```

### EscrowState
```js
{
  balance: number,
  goalAmount: number,
  donors: { [donorId]: number },  // cumulative per-donor deposits
  released: boolean
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Contract event storage round-trip

*For any* valid `contractId` and sequence of `invokeContract` calls that emit events, calling `getContractEvents(contractId)` must return all stored events for that contract and no events from other contracts.

**Validates: Requirements 3.1, 3.2, 3.3**

---

### Property 2: Event limit is respected

*For any* `contractId` with N stored events and any positive integer `limit`, `getContractEvents(contractId, limit)` must return at most `min(N, limit)` events.

**Validates: Requirements 3.4**

---

### Property 3: Deposit accumulation invariant

*For any* sequence of `deposit(donorId, amount)` calls on an `EscrowContract`, the `balance` in `getState()` must equal the sum of all deposited amounts.

**Validates: Requirements 5.2, 5.6**

---

### Property 4: Escrow release only when goal is met

*For any* `EscrowContract` with a configured `goalAmount`, calling `release` when `balance < goalAmount` must always throw `"Goal not yet reached"`, and calling `release` when `balance >= goalAmount` must always succeed and return the full balance.

**Validates: Requirements 5.3, 5.4, 5.5**

---

### Property 5: MockStellarService deposit/release round-trip

*For any* sequence of mock `invokeContract` deposit calls followed by a release call (once goal is met), the mock must return `status: "success"` for the release and the cumulative deposit events must be retrievable via `getContractEvents`.

**Validates: Requirements 6.2, 6.3, 6.4, 6.6**

---

### Property 6: Validation errors are consistent across real and mock service

*For any* call to `invokeContract` or `getContractEvents` with a missing or empty `contractId`, both `StellarService` and `MockStellarService` must throw an `Error` with the message `"contractId is required"`.

**Validates: Requirements 2.4, 6.7**

---

## Error Handling

| Scenario | Component | Behavior |
|---|---|---|
| Empty `sorobanRpcUrl` | `StellarService` constructor | Throws `Error("sorobanRpcUrl must not be empty")` |
| Missing/empty `contractId` | `invokeContract`, `getContractEvents` | Throws `Error("contractId is required")` |
| Missing/empty `method` | `invokeContract` | Throws `Error("method is required")` |
| Non-array `args` | `invokeContract` | Throws `Error("args must be an array")` |
| RPC error response | `StellarService.invokeContract` | Throws `Error` with RPC error message |
| Goal not reached | `EscrowContract.release` | Throws `Error("Goal not yet reached")` |
| Non-positive deposit amount | `EscrowContract.deposit` | Throws `Error("amount must be positive")` |
| Invalid `limit` query param | `GET /contracts/:id/events` | Returns `400` with `INVALID_REQUEST` |
| Unexpected server error | `GET /contracts/:id/events` | Returns `500` with `FETCH_EVENTS_FAILED` |

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are used. Unit tests cover specific examples, edge cases, and error conditions. Property tests verify universal invariants across many generated inputs.

**Test file:** `tests/stellar-soroban-smart-contracts.test.js`

**Framework:** Jest (already configured in `jest.config.js`)

**Property-based testing library:** `fast-check` — a mature, well-maintained PBT library for JavaScript/Node.js.

Install: `npm install --save-dev fast-check`

### Unit Test Coverage

- `MockStellarService.invokeContract` — deposit success, release success, release failure (goal not met), unknown method
- `MockStellarService.getContractEvents` — returns events, respects limit, empty result, missing contractId
- `MockStellarService` validation errors — missing contractId, missing method, non-array args
- `EscrowContract` — deposit accumulation, release success, release failure, invalid deposit amount, getState
- `GET /contracts/:id/events` — 200 with events, 200 empty, limit filtering, invalid limit (400), server error (500)

### Property-Based Test Configuration

Each property test runs a minimum of 100 iterations via `fast-check`.

Tag format: **Feature: stellar-soroban-smart-contracts, Property {N}: {property_text}**

| Property | Test Description |
|---|---|
| Property 1 | For any contractId and N invocations, getContractEvents returns exactly those events |
| Property 2 | For any N events and limit L, result length ≤ min(N, L) |
| Property 3 | For any sequence of deposits, balance equals sum of amounts |
| Property 4 | Release throws iff balance < goalAmount |
| Property 5 | Mock deposit/release round-trip produces success and retrievable events |
| Property 6 | Missing contractId always throws consistent error in both services |
