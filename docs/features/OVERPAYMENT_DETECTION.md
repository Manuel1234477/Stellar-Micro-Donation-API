# Overpayment Detection

## Overview

When a donor sends more than the required amount (donation + analytics fee), the excess is automatically detected, recorded on the transaction, and made visible via the stats API.

---

## How It Works

The expected total for any donation is:

```
expectedTotal = donationAmount + analyticsFee
```

If `receivedAmount > expectedTotal`, the transaction is flagged as an overpayment and the excess is stored.

---

## New Fields on Transaction Records

| Field | Type | Description |
|---|---|---|
| `overpaymentFlagged` | boolean | `true` when an overpayment was detected |
| `overpaymentDetails` | object \| null | Full overpayment breakdown, or `null` |

`overpaymentDetails` shape:

```json
{
  "flagged": true,
  "expectedTotal": 10.2,
  "receivedAmount": 12.0,
  "excessAmount": 1.8,
  "overpaymentPercentage": 17.647,
  "detectedAt": "2026-03-23T10:00:00.000Z"
}
```

---

## API Usage

### Create a donation with a received amount

Pass `receivedAmount` alongside `amount` when calling `createDonationRecord`. If omitted, `receivedAmount` defaults to `amount` (no overpayment).

### View overpayments

```
GET /stats/overpayments
GET /stats/overpayments?startDate=2026-01-01&endDate=2026-03-31
```

Response:

```json
{
  "success": true,
  "data": {
    "totalOverpayments": 3,
    "totalExcessAmount": 5.4,
    "averageExcessAmount": 1.8,
    "transactions": [
      {
        "id": "...",
        "donor": "...",
        "donationAmount": 10,
        "analyticsFee": 0.2,
        "expectedTotal": 10.2,
        "receivedAmount": 12,
        "excessAmount": 1.8,
        "overpaymentPercentage": 17.647,
        "detectedAt": "2026-03-23T10:00:00.000Z",
        "timestamp": "2026-03-23T10:00:00.000Z"
      }
    ]
  },
  "metadata": {
    "note": "Overpayments occur when received amount exceeds donation + analytics fee"
  }
}
```

---

## Implementation

- Utility: `src/utils/overpaymentDetector.js`
- Detection: `src/services/DonationService.js` → `createDonationRecord()`
- Stats: `src/services/StatsService.js` → `getOverpaymentStats()`
- Endpoint: `src/routes/stats.js` → `GET /stats/overpayments`
- Tests: `tests/overpayment-detection.test.js`
