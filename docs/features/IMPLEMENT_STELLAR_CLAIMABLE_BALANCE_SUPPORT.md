# Stellar Claimable Balance Support

## Overview

Claimable balances allow sending XLM to an account that doesn't exist yet, or with
time-based conditions. Key use cases:

- Donations to unactivated (unfunded) Stellar accounts
- Scheduled / time-locked donations (claimable after a date)
- Conditional grants (claimable before an expiry)

---

## New API Endpoints

### `POST /donations/claimable`

Create a claimable balance. The specified amount is held on-chain until an eligible
claimant claims it.

**Request**
```json
{
  "sourceSecret": "S...",
  "amount": "10",
  "claimants": [
    { "destination": "G..." }
  ],
  "predicate": {
    "notBefore": 1700000000000,
    "notAfter":  1800000000000
  }
}
```

- `claimants` — array of `{ destination: publicKey }`, max 10
- `predicate` — optional; `notBefore` / `notAfter` are Unix millisecond timestamps

**Response `201`**
```json
{
  "success": true,
  "data": {
    "balanceId": "00000000...",
    "transactionId": "abc123...",
    "ledger": 1234567
  }
}
```

---

### `POST /donations/claimable/:id/claim`

Claim a claimable balance by its ID.

**Request**
```json
{ "claimantSecret": "S..." }
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "transactionId": "def456...",
    "ledger": 1234568,
    "amount": "10"
  }
}
```

**Error cases**

| Condition | HTTP |
|-----------|------|
| Balance not found | 404 |
| Already claimed | 400 |
| Claimant not eligible | 400 |
| `notBefore` not yet reached | 400 |
| `notAfter` exceeded (expired) | 400 |

---

## New Service Methods

### `StellarService.createClaimableBalance({ sourceSecret, amount, claimants, predicate })`

Builds and submits a `CreateClaimableBalance` operation. Converts `notBefore`/`notAfter`
ms timestamps to Stellar `predicateBeforeAbsoluteTime` / `predicateNot` predicates.

### `StellarService.claimBalance({ balanceId, claimantSecret })`

Builds and submits a `ClaimClaimableBalance` operation.

### `MockStellarService` — same interface

Full in-memory implementation with predicate enforcement, double-claim prevention,
and auto-creation of unactivated claimant wallets.

---

## Time Predicates

```
predicate.notBefore  — Unix ms timestamp; balance not claimable before this time
predicate.notAfter   — Unix ms timestamp; balance expires after this time
```

Both are optional. Omitting both creates an unconditional balance.

---

## Security Assumptions

- `sourceSecret` is never stored; it is used only to sign the transaction in memory.
- Claimable balance IDs are public (they appear on-chain); access control is enforced
  by the Stellar network via the claimants list.
- Time predicates are enforced by the Stellar network (not just the API).

---

## Running Tests

```bash
npm test tests/implement-stellar-claimable-balance-support.test.js
```

No live Stellar network required. All tests use `MockStellarService`.
