# fix-mockstellarservice-methods Bugfix Design

## Overview

`MockStellarService` extends `StellarServiceInterface` but leaves eleven methods unimplemented — each throws `"must be implemented"`. Any test that exercises these code paths fails immediately. The fix adds in-memory implementations for all eleven methods using the existing `this.wallets` and `this.transactions` maps, consistent with the patterns already established in the class. No live Stellar network is required.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — calling any of the eleven unimplemented methods on `MockStellarService`
- **Property (P)**: The desired behavior — each method returns a meaningful mock value without throwing
- **Preservation**: All currently-implemented methods (`createWallet`, `getBalance`, `sendDonation`, `estimateFee`, `buildAndSubmitFeeBumpTransaction`, `discoverBestPath`, `pathPayment`, `verifyTransaction`, `streamTransactions`, `createClaimableBalance`, `claimBalance`) must continue to work exactly as before
- **MockStellarService**: The class in `src/services/MockStellarService.js` that provides an in-memory Stellar mock for tests
- **StellarServiceInterface**: The abstract base class in `src/services/interfaces/StellarServiceInterface.js` that defines the contract
- **this.wallets**: The `Map<publicKey, walletObject>` used by `MockStellarService` to store account state
- **this.transactions**: The `Map<publicKey, txArray>` used to store transaction records per account
- **stroops**: The smallest unit of XLM; 1 XLM = 10,000,000 stroops

## Bug Details

### Bug Condition

The bug manifests when any of the eleven unimplemented interface methods is called on a `MockStellarService` instance. The base class `StellarServiceInterface` defines these methods to throw `Error: <methodName>() must be implemented`, and `MockStellarService` never overrides them.

**Formal Specification:**
```
FUNCTION isBugCondition(call)
  INPUT: call — a method invocation on a MockStellarService instance
  OUTPUT: boolean

  RETURN call.methodName IN [
    'loadAccount', 'submitTransaction', 'buildPaymentTransaction',
    'getAccountSequence', 'buildTransaction', 'signTransaction',
    'getAccountBalances', 'getTransaction', 'isValidAddress',
    'stroopsToXlm', 'xlmToStroops'
  ]
END FUNCTION
```

### Examples

- `mockService.loadAccount('GABC...')` → throws `Error: loadAccount() must be implemented` (expected: returns mock account object)
- `mockService.isValidAddress('GABC...')` → throws `Error: isValidAddress() must be implemented` (expected: returns `true`)
- `mockService.stroopsToXlm(10000000)` → throws `Error: stroopsToXlm() must be implemented` (expected: returns `'1.0000000'`)
- `mockService.xlmToStroops(1)` → throws `Error: xlmToStroops() must be implemented` (expected: returns `10000000`)
- `mockService.getAccountBalances('GABC...')` → throws `Error: getAccountBalances() must be implemented` (expected: returns array of balance objects)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `createWallet()` must continue to return a new keypair with `publicKey` and `secretKey`
- `getBalance(publicKey)` must continue to return the account's XLM balance
- `sendDonation(params)` must continue to transfer funds and return a transaction result
- `estimateFee(operationCount)` must continue to return fee estimates in stroops and XLM
- `buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret)` must continue to return `{ hash, ledger }`
- `discoverBestPath(params)` must continue to return a path payment quote or `null`
- `pathPayment(...)` must continue to execute the path payment and return a transaction result
- `verifyTransaction(transactionHash)` must continue to return verified transaction details
- `streamTransactions(publicKey, onTransaction)` must continue to register the listener and return an unsubscribe function
- `createClaimableBalance(params)` must continue to return `{ balanceId, transactionId, ledger }`
- `claimBalance(params)` must continue to credit the claimant and return the transaction result
- `isValidAddress(address)` called with an invalid address must return `false` (not throw)

**Scope:**
All existing method calls that do NOT involve the eleven unimplemented methods should be completely unaffected by this fix.

## Hypothesized Root Cause

The root cause is straightforward: the eleven methods were defined in `StellarServiceInterface` but never overridden in `MockStellarService`. There is no complex logic error — the implementations are simply absent.

1. **Missing Overrides**: `MockStellarService` was incrementally extended with higher-level methods (`sendDonation`, `pathPayment`, etc.) but the lower-level interface primitives were never added
2. **No Compile-Time Enforcement**: JavaScript has no abstract method enforcement, so the missing overrides were not caught at class definition time — only at runtime when the methods are called
3. **Test Coverage Gap**: Tests that exercise the higher-level methods passed, masking the absence of the lower-level implementations

## Correctness Properties

Property 1: Bug Condition - Unimplemented Methods Return Mock Values

_For any_ call where the bug condition holds (isBugCondition returns true — i.e., one of the eleven methods is invoked), the fixed `MockStellarService` SHALL return a meaningful mock value appropriate to the method's contract without throwing any error.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11**

Property 2: Preservation - Existing Method Behavior Unchanged

_For any_ call where the bug condition does NOT hold (isBugCondition returns false — i.e., an already-implemented method is invoked), the fixed `MockStellarService` SHALL produce exactly the same result as the original `MockStellarService`, preserving all existing mock behaviors.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**

## Fix Implementation

### Changes Required

**File**: `src/services/MockStellarService.js`

**Specific Changes**:

1. **`loadAccount(publicKey)`**: Look up `this.wallets.get(publicKey)`. If found, return `{ id: publicKey, sequence: wallet.sequence, balances: [{ asset_type: 'native', asset_code: 'XLM', balance: wallet.balance }] }`. If not found, throw `NotFoundError`.

2. **`submitTransaction(transaction)`**: Generate a mock hash, store the transaction in `this.transactions` (keyed by `transaction.source` if present), and return `{ hash, ledger, status: 'confirmed' }`.

3. **`buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options)`**: Return a mock unsigned transaction envelope object: `{ type: 'payment', source: sourcePublicKey, destination: destinationPublicKey, amount, options, _isMockTransaction: true, _unsigned: true }`.

4. **`getAccountSequence(publicKey)`**: Look up `this.wallets.get(publicKey)`. If found, return `wallet.sequence` as a string. If not found, throw `NotFoundError`.

5. **`buildTransaction(sourcePublicKey, operations, options)`**: Return a mock unsigned transaction envelope object: `{ type: 'transaction', source: sourcePublicKey, operations, options, _isMockTransaction: true, _unsigned: true }`.

6. **`signTransaction(transaction, secretKey)`**: Return a copy of the transaction with `_signed: true` and `_secretKey: secretKey` added (no actual cryptographic signing needed for mock).

7. **`getAccountBalances(publicKey)`**: Look up `this.wallets.get(publicKey)`. If found, build an array from `wallet.assetBalances` — native becomes `{ asset_type: 'native', asset_code: 'XLM', balance: wallet.balance }`, non-native entries become `{ asset_type: 'credit_alphanum4', asset_code, balance }`. If not found, throw `NotFoundError`.

8. **`getTransaction(transactionHash)`**: Search all entries in `this.transactions` for a record matching `transactionHash` (check both `tx.transactionId` and `tx.hash` fields since both are used in the existing code). Return the record if found, throw `NotFoundError` otherwise.

9. **`isValidAddress(address)`**: Return `true` if `address` matches `/^G[A-Z2-7]{55}$/`, `false` otherwise. Must not throw. (The existing `_validatePublicKey` helper uses this same regex — reuse the pattern.)

10. **`stroopsToXlm(stroops)`**: Return `(Number(stroops) / 10_000_000).toFixed(7)`.

11. **`xlmToStroops(xlm)`**: Return `Math.round(Number(xlm) * 10_000_000)`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause (missing overrides). If the tests do not fail on unfixed code, the root cause analysis needs revision.

**Test Plan**: Write tests that call each of the eleven methods on an unfixed `MockStellarService` instance and assert they do NOT throw. Run these tests on the UNFIXED code to observe the `"must be implemented"` errors.

**Test Cases**:
1. **loadAccount Test**: Call `loadAccount` with a known public key — will throw on unfixed code
2. **submitTransaction Test**: Call `submitTransaction` with a mock transaction object — will throw on unfixed code
3. **buildPaymentTransaction Test**: Call with valid source, destination, and amount — will throw on unfixed code
4. **getAccountSequence Test**: Call with a known public key — will throw on unfixed code
5. **buildTransaction Test**: Call with valid source and operations array — will throw on unfixed code
6. **signTransaction Test**: Call with a mock transaction and secret key — will throw on unfixed code
7. **getAccountBalances Test**: Call with a known public key — will throw on unfixed code
8. **getTransaction Test**: Call with a known transaction hash — will throw on unfixed code
9. **isValidAddress Test**: Call with a valid Stellar public key — will throw on unfixed code
10. **stroopsToXlm Test**: Call with `10000000` — will throw on unfixed code
11. **xlmToStroops Test**: Call with `1` — will throw on unfixed code

**Expected Counterexamples**:
- All eleven calls throw `Error: <methodName>() must be implemented`
- Confirms root cause: the methods are simply absent from `MockStellarService`

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed methods return correct mock values.

**Pseudocode:**
```
FOR ALL methodName IN buggyMethods DO
  result := MockStellarService_fixed[methodName](validInput)
  ASSERT result does not throw
  ASSERT expectedBehavior(methodName, result)
END FOR
```

**Expected Behavior per method:**
```
FUNCTION expectedBehavior(methodName, result)
  MATCH methodName:
    'loadAccount'              → result.id EXISTS AND result.sequence EXISTS AND result.balances IS ARRAY
    'submitTransaction'        → result.hash EXISTS AND result.ledger IS NUMBER AND result.status EXISTS
    'buildPaymentTransaction'  → result._isMockTransaction IS true AND result._unsigned IS true
    'getAccountSequence'       → result IS STRING
    'buildTransaction'         → result._isMockTransaction IS true AND result._unsigned IS true
    'signTransaction'          → result._signed IS true
    'getAccountBalances'       → result IS ARRAY AND result[0].asset_type EXISTS AND result[0].balance EXISTS
    'getTransaction'           → result.hash OR result.transactionId EXISTS
    'isValidAddress'           → result IS BOOLEAN (true for valid G-key)
    'stroopsToXlm'             → result IS STRING AND parseFloat(result) = stroops / 10000000
    'xlmToStroops'             → result IS INTEGER AND result = xlm * 10000000
END FUNCTION
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed `MockStellarService` produces the same result as the original.

**Pseudocode:**
```
FOR ALL methodName NOT IN buggyMethods DO
  ASSERT MockStellarService_original[methodName](input) = MockStellarService_fixed[methodName](input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior of existing methods on unfixed code first, then write property-based tests capturing that behavior.

**Test Cases**:
1. **createWallet Preservation**: Verify `createWallet()` still returns `{ publicKey, secretKey }` with correct format
2. **getBalance Preservation**: Verify `getBalance(publicKey)` still returns `{ balance, asset }` for known accounts
3. **sendDonation Preservation**: Verify `sendDonation(params)` still transfers funds and returns `{ transactionId, ledger, status, confirmedAt }`
4. **estimateFee Preservation**: Verify `estimateFee(n)` still returns `{ feeStroops, feeXLM, baseFee, surgeProtection, surgeMultiplier }`
5. **isValidAddress false case**: Verify `isValidAddress('invalid')` returns `false` (not throws) — this is a preservation requirement per 3.12

### Unit Tests

- Test each of the eleven methods with valid inputs and assert correct return shape
- Test `loadAccount` and `getAccountSequence` with unknown public key — expect `NotFoundError`
- Test `getTransaction` with unknown hash — expect `NotFoundError`
- Test `isValidAddress` with valid key (starts with G, 56 chars, base32) → `true`
- Test `isValidAddress` with wrong prefix, wrong length, invalid chars → `false`
- Test `stroopsToXlm(10000000)` → `'1.0000000'`; `stroopsToXlm(0)` → `'0.0000000'`
- Test `xlmToStroops(1)` → `10000000`; `xlmToStroops(0.5)` → `5000000`
- Test `getAccountBalances` returns native balance entry for a funded account

### Property-Based Tests

- Generate random valid Stellar public keys (G + 55 base32 chars) and assert `isValidAddress` returns `true` for all
- Generate random invalid addresses (wrong prefix, wrong length, invalid chars) and assert `isValidAddress` returns `false` for all
- Generate random positive integers as stroops and assert `xlmToStroops(stroopsToXlm(n)) ≈ n` (round-trip within floating-point tolerance)
- Generate random XLM amounts and assert `stroopsToXlm(xlmToStroops(x)) ≈ x`
- Generate random existing wallet states and assert `getAccountBalances` always returns an array with at least one native entry

### Integration Tests

- Create a wallet, fund it, call `loadAccount` — verify returned balances match funded amount
- Call `buildPaymentTransaction`, then `signTransaction`, then `submitTransaction` — verify the full pipeline returns a hash
- Call `submitTransaction` with a mock transaction, then `getTransaction` with the returned hash — verify round-trip
- Call `getAccountSequence` before and after `sendDonation` — verify sequence increments
- Verify all existing tests in `tests/MockStellarService.test.js` continue to pass after the fix
