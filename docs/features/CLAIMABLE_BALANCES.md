# Stellar Claimable Balances

Stellar claimable balances allow funds to be locked on-chain with conditions (time bounds, claimant list) and claimed later by authorized accounts. This enables conditional donation release and escrow-like workflows without smart contracts.

## API Endpoints

### Create Claimable Balance
- **POST /claimable-balances**
- Requires `donations:write` permission
- Request body:
  - `sourceSecret`: string (source account secret key)
  - `asset`: object (asset to lock, e.g. `{ type: 'native', code: 'XLM', issuer: null }`)
  - `amount`: string (amount to lock)
  - `claimants`: array of `{ destination, predicate }` objects
- Response: `{ balanceId, transactionId, ledger }`

### Claim a Balance
- **POST /claimable-balances/:id/claim**
- Request body:
  - `claimantSecret`: string (claimant's secret key)
- Response: `{ transactionId, ledger }`
- Returns 403 if not an authorized claimant

### List Claimable Balances
- **GET /claimable-balances**
- Lists balances claimable by the authenticated wallet
- Response: array of claimable balance objects

## Acceptance Criteria
- Only authorized claimants can claim a balance
- Unauthorized claim returns 403
- Listing returns only balances claimable by the wallet
- Full lifecycle is simulated in MockStellarService

## Example Claimant Object
```
{
  "destination": "G...", // Stellar public key
  "predicate": null // or predicate object for time bounds, etc.
}
```

## JSDoc
All new methods are documented with JSDoc comments in the codebase.

## Test Coverage
- Creation, claiming, unauthorized claim, and listing are covered in tests/claimable-balances-extended.test.js
- Minimum 95% test coverage for new code
