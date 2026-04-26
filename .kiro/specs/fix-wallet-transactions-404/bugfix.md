# Bugfix Requirements Document

## Introduction

The `GET /wallets/:publicKey/transactions` endpoint accepts a Stellar public key as a path parameter. However, the database stores transactions by wallet ID (integer foreign key referencing the `users` table), not by public key. The endpoint must first resolve the public key to a wallet ID via a lookup query, then use that ID to query transactions. When this lookup is missing or incorrect, the endpoint returns a 404 or an empty result for valid public keys that do have transactions.

Additionally, there are two duplicate route registrations for `GET /:publicKey/transactions` in `src/routes/wallet.js`. The second registration shadows the first, and its behavior diverges — it silently returns an empty array instead of a proper 404 when the wallet is not found.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a valid Stellar public key is provided that exists in the database THEN the system returns an empty transactions array instead of the wallet's actual transactions, because the duplicate route handler queries by `publicKey` directly against the `transactions` table (which stores only integer IDs)

1.2 WHEN a Stellar public key is provided that does not exist in the database THEN the system returns `200 OK` with `{ success: true, data: [], count: 0 }` instead of a `404` error with a "Wallet not found" message

1.3 WHEN two route handlers are registered for the same path `GET /:publicKey/transactions` THEN the second registration silently overrides the first, making the first handler's correct lookup logic unreachable

### Expected Behavior (Correct)

2.1 WHEN a valid Stellar public key is provided that exists in the database THEN the system SHALL first look up the wallet by public key to obtain its integer ID, then query the `transactions` table using that ID, and return the matching transactions

2.2 WHEN a Stellar public key is provided that does not exist in the database THEN the system SHALL return `404` with the message `"Wallet not found"`

2.3 WHEN a valid Stellar public key is provided that exists but has no transactions THEN the system SHALL return `200 OK` with an empty array `[]`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a valid public key with existing transactions is queried THEN the system SHALL CONTINUE TO return those transactions with the correct fields (id, sender, receiver, amount, memo, timestamp)

3.2 WHEN pagination parameters (`limit`, `cursor`) are provided THEN the system SHALL CONTINUE TO apply cursor-based pagination correctly

3.3 WHEN the request lacks the required `WALLETS_READ` permission THEN the system SHALL CONTINUE TO reject the request with a `403` response

3.4 WHEN a soft-deleted wallet is queried THEN the system SHALL CONTINUE TO return `404` (not expose deleted wallet data)
