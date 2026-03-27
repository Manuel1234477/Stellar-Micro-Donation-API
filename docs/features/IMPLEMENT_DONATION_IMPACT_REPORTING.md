# Donation Impact Reporting

Allows organisations to define real-world impact metrics per campaign (e.g. "$10 = 1 meal") and automatically calculate the impact of individual donations or entire campaigns.

## Database

### `impact_metrics` table

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `campaign_id` | INTEGER FK | References `campaigns(id)` |
| `unit` | TEXT | Human-readable label (e.g. "meal") |
| `amount_per_unit` | REAL | Donation amount required for one unit |
| `description` | TEXT | Optional longer description |
| `created_at` | DATETIME | Auto-set |
| `updated_at` | DATETIME | Auto-set |

Migration: `src/scripts/migrations/addImpactMetricsTable.js`

## API Endpoints

### POST /admin/impact-metrics
Create an impact metric for a campaign. Requires admin API key.

**Body**
```json
{
  "campaign_id": 1,
  "unit": "meal",
  "amount_per_unit": 10,
  "description": "Feeds one person for a day"
}
```

**Response 201**
```json
{ "success": true, "data": { "id": 1, "campaign_id": 1, "unit": "meal", "amount_per_unit": 10, ... } }
```

### GET /admin/impact-metrics
List all impact metrics. Optional `?campaign_id=` filter.

### GET /admin/impact-metrics/:id
Get a specific impact metric.

### GET /donations/:id/impact
Calculate the impact of a specific donation.

**Response 200**
```json
{
  "success": true,
  "data": {
    "donation_id": "abc123",
    "amount": 50,
    "campaign_id": 1,
    "impact": [
      { "unit": "meal", "amount_per_unit": 10, "units_delivered": 5, "description": "Feeds one person" }
    ]
  }
}
```

Returns `impact: []` with a message if the donation has no associated campaign.

### GET /campaigns/:id/impact
Aggregate impact summary for a campaign based on `current_amount`.

**Response 200**
```json
{
  "success": true,
  "data": {
    "campaign_id": 1,
    "total_donated": 300,
    "impact": [
      { "unit": "meal", "amount_per_unit": 10, "units_delivered": 30, "description": "..." }
    ]
  }
}
```

## Calculation Logic

`units_delivered = Math.floor(donation_amount / amount_per_unit)`

Fractional units are always floored — partial units are not counted. A donation of $25 against a $10/meal metric delivers 2 meals, not 2.5.

## Service

`src/services/ImpactMetricService.js` — all static methods, no Stellar network dependency.

| Method | Description |
|---|---|
| `create(params)` | Create a new metric |
| `getById(id)` | Fetch by ID |
| `getByCampaign(campaign_id)` | List metrics for a campaign |
| `calculateDonationImpact(amount, campaign_id)` | Per-donation impact breakdown |
| `calculateCampaignImpact(campaign_id)` | Aggregate campaign impact |

## Security

- All admin write endpoints require `requireAdmin()` middleware (admin API key).
- Read endpoints on `/campaigns/:id/impact` are public (consistent with existing campaign routes).
- Read endpoints on `/donations/:id/impact` require `DONATIONS_READ` permission.
- No Stellar network calls are made — impact is calculated purely from DB data.

## Tests

```
npm test tests/implement-donation-impact-reporting.test.js
```

Covers: CRUD, calculation accuracy, fractional units, zero amounts, missing campaigns, multiple metrics, edge cases.
