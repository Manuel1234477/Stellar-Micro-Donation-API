# Stellar Inflation Destination Management

Stellar accounts can designate an inflation destination for compatibility with legacy protocols and treasury workflows. While inflation is no longer active, the field is still supported on-chain.

## API Endpoints

### Set Inflation Destination
- **PATCH /wallets/:id/inflation-destination**
- Requires `wallets:write` permission
- Request body:
  - `destination`: string (Stellar public key)
  - `sourceSecret`: string (account secret key)
- Response: `{ success: true, inflationDestination, result }`

### Get Inflation Destination
- **GET /wallets/:id/inflation-destination**
- Requires `wallets:read` permission
- Response: `{ inflationDestination }`

## Security
- Only the account owner (authenticated) can set the destination
- Destination must be a valid Stellar public key

## MockStellarService
- Tracks and returns inflation destination state for each wallet

## Test Coverage
- Setting and getting inflation destination
- Invalid public key returns 400
- Unauthorized request returns error
- State changes are tracked

## JSDoc
All new methods are documented with JSDoc comments in the codebase.

## Historical Context
Stellar inflation is deprecated, but the field remains for protocol compatibility.
