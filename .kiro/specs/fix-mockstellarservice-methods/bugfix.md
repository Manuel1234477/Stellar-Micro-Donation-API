# Bugfix Requirements Document

## Introduction

`MockStellarService` extends `StellarServiceInterface` but leaves eleven interface methods unimplemented. Calling any of these methods throws a `"must be implemented"` error, causing test suites that exercise those code paths to fail unexpectedly. The fix implements all missing methods with realistic in-memory mock behaviour so tests can run without a live Stellar network.

Missing methods: `loadAccount`, `submitTransaction`, `buildPaymentTransaction`, `getAccountSequence`, `buildTransaction`, `signTransaction`, `getAccountBalances`, `getTransaction`, `isValidAddress`, `stroopsToXlm`, `xlmToStroops`.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `loadAccount(publicKey)` is called on `MockStellarService` THEN the system throws `Error: loadAccount() must be implemented`

1.2 WHEN `submitTransaction(transaction)` is called on `MockStellarService` THEN the system throws `Error: submitTransaction() must be implemented`

1.3 WHEN `buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options)` is called on `MockStellarService` THEN the system throws `Error: buildPaymentTransaction() must be implemented`

1.4 WHEN `getAccountSequence(publicKey)` is called on `MockStellarService` THEN the system throws `Error: getAccountSequence() must be implemented`

1.5 WHEN `buildTransaction(sourcePublicKey, operations, options)` is called on `MockStellarService` THEN the system throws `Error: buildTransaction() must be implemented`

1.6 WHEN `signTransaction(transaction, secretKey)` is called on `MockStellarService` THEN the system throws `Error: signTransaction() must be implemented`

1.7 WHEN `getAccountBalances(publicKey)` is called on `MockStellarService` THEN the system throws `Error: getAccountBalances() must be implemented`

1.8 WHEN `getTransaction(transactionHash)` is called on `MockStellarService` THEN the system throws `Error: getTransaction() must be implemented`

1.9 WHEN `isValidAddress(address)` is called on `MockStellarService` THEN the system throws `Error: isValidAddress() must be implemented`

1.10 WHEN `stroopsToXlm(stroops)` is called on `MockStellarService` THEN the system throws `Error: stroopsToXlm() must be implemented`

1.11 WHEN `xlmToStroops(xlm)` is called on `MockStellarService` THEN the system throws `Error: xlmToStroops() must be implemented`

### Expected Behavior (Correct)

2.1 WHEN `loadAccount(publicKey)` is called with a known public key THEN the system SHALL return a mock account object containing `id`, `sequence`, and `balances` without throwing

2.2 WHEN `submitTransaction(transaction)` is called with a mock transaction object THEN the system SHALL store the transaction and return a result object with `hash`, `ledger`, and `status` without throwing

2.3 WHEN `buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options)` is called with valid arguments THEN the system SHALL return a mock unsigned transaction envelope object without throwing

2.4 WHEN `getAccountSequence(publicKey)` is called with a known public key THEN the system SHALL return the account's current sequence number as a string without throwing

2.5 WHEN `buildTransaction(sourcePublicKey, operations, options)` is called with valid arguments THEN the system SHALL return a mock unsigned transaction envelope object without throwing

2.6 WHEN `signTransaction(transaction, secretKey)` is called with a mock transaction and a valid secret key THEN the system SHALL return a signed mock transaction object without throwing

2.7 WHEN `getAccountBalances(publicKey)` is called with a known public key THEN the system SHALL return an array of balance objects (each with `asset_type`, `asset_code`, and `balance`) without throwing

2.8 WHEN `getTransaction(transactionHash)` is called with a known transaction hash THEN the system SHALL return the stored transaction record without throwing

2.9 WHEN `isValidAddress(address)` is called with a valid Stellar public key (starts with `G`, 56 characters, base32 alphabet) THEN the system SHALL return `true` without throwing

2.10 WHEN `stroopsToXlm(stroops)` is called with a numeric stroops value THEN the system SHALL return the equivalent XLM amount as a string with 7 decimal places (stroops / 10,000,000) without throwing

2.11 WHEN `xlmToStroops(xlm)` is called with a numeric XLM value THEN the system SHALL return the equivalent stroops amount as an integer (xlm × 10,000,000) without throwing

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `createWallet()` is called THEN the system SHALL CONTINUE TO return a new keypair with `publicKey` and `secretKey`

3.2 WHEN `getBalance(publicKey)` is called with a known public key THEN the system SHALL CONTINUE TO return the account's XLM balance

3.3 WHEN `sendDonation(params)` is called with valid parameters THEN the system SHALL CONTINUE TO transfer funds and return a transaction result

3.4 WHEN `estimateFee(operationCount)` is called THEN the system SHALL CONTINUE TO return fee estimates in stroops and XLM

3.5 WHEN `buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret)` is called THEN the system SHALL CONTINUE TO return a fee bump result with `hash` and `ledger`

3.6 WHEN `discoverBestPath(params)` is called THEN the system SHALL CONTINUE TO return a path payment quote or `null`

3.7 WHEN `pathPayment(...)` is called with valid parameters THEN the system SHALL CONTINUE TO execute the path payment and return a transaction result

3.8 WHEN `verifyTransaction(transactionHash)` is called with a known hash THEN the system SHALL CONTINUE TO return the verified transaction details

3.9 WHEN `streamTransactions(publicKey, onTransaction)` is called THEN the system SHALL CONTINUE TO register the listener and return an unsubscribe function

3.10 WHEN `createClaimableBalance(params)` is called THEN the system SHALL CONTINUE TO create a claimable balance and return `balanceId`, `transactionId`, and `ledger`

3.11 WHEN `claimBalance(params)` is called THEN the system SHALL CONTINUE TO credit the claimant and return the transaction result

3.12 WHEN `isValidAddress(address)` is called with an invalid address (wrong prefix, wrong length, or invalid characters) THEN the system SHALL return `false` without throwing
