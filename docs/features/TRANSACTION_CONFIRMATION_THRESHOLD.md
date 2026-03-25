# Transaction Confirmation Threshold

## Overview

Ensures transactions are sufficiently confirmed on the Stellar network before being marked as final. A transaction is only advanced to `confirmed` state once a configurable number of ledgers have closed after the transaction's ledger.

---

## How It Works

Stellar closes a ledger roughly every 5 seconds. When a transaction is included in ledger `L`, the confirmation depth is:

```
confirmations = currentLedger - transactionLedger
```

A transaction is marked `confirmed` only when:

```
confirmations >= CONFIRMATION_LEDGER_THRESHOLD
```

If the threshold is not yet met, the transaction remains in `submitted` state and can be re-checked later via `DonationService.confirmTransaction()`.

---

## Environment Variable

| Variable | Default | Min | Description |
|---|---|---|---|
| `CONFIRMATION_LEDGER_THRESHOLD` | `1` | `1` | Number of ledgers that must close after the transaction's ledger |

A threshold of `1` (default) means at least one subsequent ledger must have closed — the minimum safe confirmation for Stellar. Increase for higher-value transactions.

---

## New Transaction Fields (on confirmed records)

| Field | Type | Description |
|---|---|---|
| `confirmations` | number | Ledger depth at time of confirmation |
| `confirmationThreshold` | number | Threshold that was required |

---

## API

### `sendCustodialDonation` response

```json
{
  "stellarTxId": "...",
  "ledger": 1000000,
  "status": "submitted",
  "confirmed": false,
  "confirmations": 0,
  "confirmationThreshold": 1
}
```

When `confirmed: false`, the transaction is on-chain but not yet final. Poll `confirmTransaction` or the verify endpoint until `confirmed: true`.

### `DonationService.confirmTransaction(transactionId, currentLedger, threshold?)`

Re-checks a submitted transaction against the latest ledger. Advances to `confirmed` if the threshold is met.

---

## Implementation

- Config: `src/config/confirmationThreshold.js`
- Utility: `src/utils/confirmationChecker.js` — `checkConfirmations()`, `assertConfirmed()`
- Service: `src/services/DonationService.js` — `sendCustodialDonation` (gated), `confirmTransaction()`
- Tests: `tests/transaction-confirmation-threshold.test.js`

---

## Security Notes

- Premature confirmation is prevented — a transaction cannot move to `confirmed` until the ledger depth requirement is satisfied.
- The threshold is validated on startup; invalid values fall back to the safe default of `1`.
- `assertConfirmed()` can be used anywhere in the codebase to hard-fail on unconfirmed transactions.
