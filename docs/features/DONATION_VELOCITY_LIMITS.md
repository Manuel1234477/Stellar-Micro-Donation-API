# Donation Velocity Limits

Prevents donation flooding by capping how much a single donor can send to a specific recipient within a rolling time window.

## Database Tables

### `donation_velocity`
Tracks per-donor/recipient totals within each window.

| Column | Type | Description |
|---|---|---|
| donorId | INTEGER | Donor user ID |
| recipientId | INTEGER | Recipient user ID |
| windowStart | DATETIME | Start of the current window (UTC) |
| totalAmount | REAL | Cumulative amount in this window |
| count | INTEGER | Number of donations in this window |

### `recipient_velocity_limits`
Stores configurable limits per recipient.

| Column | Type | Description |
|---|---|---|
| recipientId | INTEGER | Recipient user ID (unique) |
| maxAmount | REAL | Max total amount per window (null = no limit) |
| maxCount | INTEGER | Max donation count per window (null = no limit) |
| windowType | TEXT | `daily`, `weekly`, or `monthly` |

## Admin API

### Set limits
```
POST /admin/recipients/:id/limits
Authorization: X-API-Key (admin)

{
  "maxAmount": 500,
  "maxCount": 10,
  "windowType": "daily"
}
```

### Get limits
```
GET /admin/recipients/:id/limits
Authorization: X-API-Key (admin)
```

## Enforcement

Limits are checked in `DonationService.sendCustodialDonation()` **before** any Stellar transaction is submitted. If a limit is exceeded, the service throws an error with HTTP status `429` and the `X-Limit-Reset` header set to the ISO timestamp when the window resets.

## Window Types

| Type | Window Start | Resets |
|---|---|---|
| `daily` | Midnight UTC | Every 24 hours |
| `weekly` | Monday midnight UTC | Every 7 days |
| `monthly` | 1st of month UTC | Every calendar month |

## Error Response

```json
HTTP 429 Too Many Requests
X-Limit-Reset: 2025-06-16T00:00:00.000Z

{
  "success": false,
  "error": {
    "code": "VELOCITY_LIMIT_EXCEEDED",
    "message": "Donation would exceed the per-recipient amount limit of 500 per daily window.",
    "details": {
      "limit": 500,
      "used": 480,
      "amount": 30,
      "resetAt": "2025-06-16T00:00:00.000Z"
    }
  }
}
```
