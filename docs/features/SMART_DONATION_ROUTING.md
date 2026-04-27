# Smart Donation Routing

Automatically routes pooled donations to recipients using configurable strategies. When a donor does not specify a recipient, the API selects one from a named pool based on the active strategy.

## Strategies

### `round-robin`
Cycles through recipients in order. Each recipient is selected once before any is repeated.

**Example pool:** `[A, B, C]`  
**Selections:** A → B → C → A → B → C …

### `weighted`
Selects recipients by weighted random distribution. A recipient with `weight: 3` is three times as likely to be selected as one with `weight: 1`. Missing or zero weights default to `1`.

**Example pool:**
```json
[
  { "id": "charity-a", "weight": 3 },
  { "id": "charity-b", "weight": 1 }
]
```
Charity A receives ~75% of donations, Charity B ~25%.

### `priority`
Always selects the recipient with the highest `priority` value (numeric, higher = more urgent). Ties are broken by lexicographically smallest `id`. Missing priority defaults to `0`.

**Example pool:**
```json
[
  { "id": "urgent",  "priority": 10 },
  { "id": "normal",  "priority": 1  }
]
```
`urgent` is always selected until its priority is lowered.

## API Endpoints

All endpoints require an **admin** API key.

### Configure active strategy

```
POST /admin/routing/strategies
```

**Body:**
```json
{
  "poolName": "general-fund",
  "strategy": "round-robin"
}
```

Valid strategy values: `round-robin`, `weighted`, `priority`, `highest-need`, `geographic`, `campaign-urgency`

**Response:**
```json
{
  "success": true,
  "data": { "poolName": "general-fund", "strategy": "round-robin" }
}
```

### Retrieve current configuration

```
GET /admin/routing/strategies
GET /admin/routing/strategies?poolName=general-fund
```

Without `poolName`, returns all configured pools. With `poolName`, returns the strategy for that pool (404 if not configured).

**Response (all):**
```json
{
  "success": true,
  "count": 2,
  "data": [
    { "poolName": "general-fund", "strategy": "round-robin", "updatedAt": "..." },
    { "poolName": "emergency-pool", "strategy": "priority", "updatedAt": "..." }
  ]
}
```

### Query routing decision history

```
GET /admin/routing/decisions
GET /admin/routing/decisions?poolName=general-fund&page=1&limit=20
GET /admin/routing/decisions?strategy=round-robin
GET /admin/routing/decisions?donationId=don-abc123
```

**Query parameters:**

| Parameter  | Description                                  | Default |
|------------|----------------------------------------------|---------|
| `poolName` | Filter by pool                               | —       |
| `strategy` | Filter by strategy name                      | —       |
| `donationId` | Filter by donation ID                      | —       |
| `page`     | Page number (1-based)                        | `1`     |
| `limit`    | Results per page (max 100)                   | `20`    |

**Response:**
```json
{
  "success": true,
  "count": 20,
  "total": 143,
  "page": 1,
  "limit": 20,
  "data": [
    {
      "id": "uuid",
      "donationId": "don-abc123",
      "poolName": "general-fund",
      "strategy": "round-robin",
      "selectedId": "charity-b",
      "candidates": ["charity-a", "charity-b", "charity-c"],
      "excluded": [],
      "decidedAt": "2026-03-30T10:00:00.000Z",
      "createdAt": "2026-03-30T10:00:00.001Z"
    }
  ]
}
```

## Pool Management

Pools are managed via existing endpoints:

```
POST   /admin/routing/pools                    — create pool
GET    /admin/routing/pools/:name              — list members
POST   /admin/routing/pools/:name/members      — add members
DELETE /admin/routing/pools/:name/members      — remove members
DELETE /admin/routing/pools/:name              — delete pool
```

**Member fields:**

| Field              | Type    | Used by strategy       | Default |
|--------------------|---------|------------------------|---------|
| `id`               | string  | all                    | required |
| `displayName`      | string  | all (display only)     | null    |
| `weight`           | number  | `weighted`             | `1`     |
| `priority`         | number  | `priority`             | `0`     |
| `latitude`         | number  | `geographic`           | null    |
| `longitude`        | number  | `geographic`           | null    |
| `campaignDeadline` | ISO date | `campaign-urgency`    | null    |

## Routing Decision Log

Every routing decision is persisted in the `routing_decisions` table with:

- `id` — UUID
- `donation_id` — the donation being routed
- `pool_name` — pool used
- `strategy` — strategy applied
- `selected_id` — chosen recipient
- `candidates` — all pool members at decision time
- `excluded` — members excluded with reasons
- `decided_at` — timestamp of the decision

Records are immutable after creation (insert-only).

## Security

- All strategy configuration and decision history endpoints require the `admin` role.
- Non-admin requests receive `403 Forbidden`.
- Routing decisions are append-only for auditability — no updates or deletes.

## Database Tables

Created by migrations `005_add_smart_donation_routing.js` and `006_add_routing_config.js`:

- `recipient_pools` — named pools
- `recipient_pool_members` — pool members with strategy-specific fields
- `round_robin_state` — per-pool round-robin index
- `routing_decisions` — immutable audit log
- `routing_config` — active strategy per pool
