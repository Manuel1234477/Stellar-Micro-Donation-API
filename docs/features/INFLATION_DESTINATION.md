# Stellar Inflation Destination Management

This document describes the API endpoints and logic for managing the inflation destination on Stellar accounts.

## Background

Stellar accounts can designate an inflation destination to participate in the network inflation pool. While inflation is no longer active on the Stellar network, the setOptions operation for inflation destination is still used by some protocols and organizational treasury management workflows. This API exposes inflation destination read and write operations for completeness and compatibility.

## Endpoints

### PUT /wallets/:id/inflation-destination
Sets the inflation destination for a wallet's Stellar account.
- **Body:** `{ destinationPublicKey: string, sourceSecret: string }`
- **Permissions:** Only the account owner (authenticated via API key with `wallets:write` permission) may change the inflation destination.
- **Validation:**
  - Destination must be a valid Stellar public key (starts with `G` and is 56 chars).
  - Only the account owner can set the destination.
- **Response:**
  - `200 OK` with `{ inflationDestination, hash, ledger }` on success
  - `400 Bad Request` for invalid input
  - `403 Forbidden` if not owner
  - `404 Not Found` if wallet does not exist

### GET /wallets/:id/inflation-destination
Returns the current inflation destination set on the wallet's Stellar account.
- **Permissions:** Any authenticated user with `wallets:read` permission.
- **Response:**
  - `200 OK` with `{ inflationDestination }`
  - `404 Not Found` if wallet does not exist

## Service Methods

- `setInflationDestination(sourceSecret, destinationPublicKey)`
- `getInflationDestination(publicKey)`

## Security
- Only the account owner can set the inflation destination.
- All endpoints require authentication and appropriate permissions.

## Tests
See `tests/inflation-destination.test.js` for comprehensive test coverage.

## Historical Context
While inflation is no longer active on Stellar, this feature is maintained for protocol compatibility and treasury workflows.

## JSDoc
All new functions are documented with JSDoc comments in the codebase.
