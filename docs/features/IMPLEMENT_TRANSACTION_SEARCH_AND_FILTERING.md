# Transaction Search and Filtering

## Overview

`GET /donations` supports filtering, full-text search, and sorting via query parameters. All parameters are optional and combinable.

## Query Parameters

| Parameter   | Type   | Description |
|-------------|--------|-------------|
| `startDate` | string | ISO date — include donations on or after this date |
| `endDate`   | string | ISO date — include donations on or before this date |
| `minAmount` | number | Minimum donation amount (inclusive) |
| `maxAmount` | number | Maximum donation amount (inclusive) |
| `status`    | string | Exact status: `pending` \| `submitted` \| `confirmed` \| `failed` |
| `donor`     | string | Case-insensitive substring match on donor field |
| `recipient` | string | Case-insensitive substring match on recipient field |
| `memo`      | string | Case-insensitive full-text search on memo field |
| `sortBy`    | string | Sort field: `timestamp` (default) \| `amount` \| `status` |
| `order`     | string | Sort order: `desc` (default) \| `asc` |
| `cursor`    | string | Cursor for pagination (see pagination docs) |
| `limit`     | number | Page size (default: 20, max: 100) |
| `direction` | string | Pagination direction: `next` \| `prev` |

## Response

```json
{
  "success": true,
  "data": [...],
  "count": 2,
  "resultCount": 2,
  "filters": { "status": "confirmed", "donor": "alice" },
  "meta": {
    "limit": 20,
    "direction": "next",
    "next_cursor": null,
    "prev_cursor": null
  }
}
```

- `filters` — the active filters applied to this request
- `resultCount` — total matching records (before pagination)
- `X-Total-Count` response header also reflects the filtered count

## Examples

```bash
# Filter by status
GET /donations?status=confirmed

# Date range
GET /donations?startDate=2024-01-01&endDate=2024-03-31

# Amount range
GET /donations?minAmount=10&maxAmount=100

# Full-text memo search
GET /donations?memo=birthday

# Combine filters
GET /donations?donor=alice&status=confirmed&sortBy=amount&order=desc

# Paginate filtered results
GET /donations?status=confirmed&limit=10
```

## Validation

Invalid parameter values return `400 Bad Request`:

- `status` must be one of `pending`, `submitted`, `confirmed`, `failed`
- `sortBy` must be one of `timestamp`, `amount`, `status`
- `order` must be one of `asc`, `desc`
- `startDate` / `endDate` must be valid ISO date strings
- `startDate` must not be after `endDate`
- `minAmount` / `maxAmount` must be valid numbers
- `minAmount` must not be greater than `maxAmount`

## Implementation

- **Route**: `GET /donations` in `src/routes/donation.js`
- **Service method**: `DonationService.applyFilters(transactions, filters)` — pure filtering/sorting logic
- **Service method**: `DonationService.getPaginatedDonations(pagination, filters)` — combines filtering with cursor pagination
- Filtering is applied in-memory before pagination, so `resultCount` reflects the filtered total
- When `sortBy` is set, the custom sort is preserved on the returned page
