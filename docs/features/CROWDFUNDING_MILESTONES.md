# Crowdfunding Campaign Milestones

Milestone-based fund release for crowdfunding campaigns. Funds are held until an admin verifies each milestone.

## Overview

Campaign creators define milestones with target amounts and descriptions. Funds are held in escrow (claimable balance) and released to the campaign owner only when an admin verifies each milestone.

## Database Table

```sql
CREATE TABLE campaign_milestones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id     INTEGER NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  target_amount   REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  verified_at     DATETIME,
  verified_by     TEXT,
  fund_release_tx TEXT,
  createdAt       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);
```

## Endpoints

### Create a Milestone

```
POST /campaigns/:id/milestones
X-API-Key: <admin-key>

{
  "title": "Phase 1 — Infrastructure",
  "description": "Build core infrastructure",
  "target_amount": 250
}
```

Response `201`:
```json
{
  "success": true,
  "data": { "id": 1, "campaign_id": 5, "title": "Phase 1", "target_amount": 250, "status": "pending" }
}
```

### List Milestones

```
GET /campaigns/:id/milestones
X-API-Key: <any-key>
```

Response `200`:
```json
{
  "success": true,
  "data": [
    { "id": 1, "title": "Phase 1", "target_amount": 250, "status": "verified", "verified_at": "..." },
    { "id": 2, "title": "Phase 2", "target_amount": 500, "status": "pending" }
  ],
  "count": 2
}
```

### Verify a Milestone (Admin)

```
POST /campaigns/admin/:id/milestones/:milestoneId/verify
X-API-Key: <admin-key>
```

Marks the milestone as verified and triggers fund release to the campaign owner.

Response `200`:
```json
{
  "success": true,
  "message": "Milestone verified. Funds of 250 XLM released to campaign owner.",
  "data": {
    "milestone": { "id": 1, "status": "verified", "verified_at": "...", "fund_release_tx": "mock_release_..." },
    "fundReleaseTx": "mock_release_1234_milestone_1"
  }
}
```

Errors:
- `403` — non-admin key
- `404` — campaign or milestone not found
- `409` — milestone already verified

### Get Campaign Progress

```
GET /campaigns/:id/progress
X-API-Key: <any-key>
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "campaignId": 5,
    "name": "My Campaign",
    "goalAmount": 1000,
    "currentAmount": 500,
    "remaining": 500,
    "progressPercent": 50,
    "status": "active",
    "milestones": {
      "total": 2,
      "verified": 1,
      "pending": 1,
      "totalReleased": 250,
      "items": [...]
    }
  }
}
```

## Fund Release Flow

```
Campaign Created
      │
      ▼
Milestone Defined ──► status: pending
      │
      ▼ (admin verifies)
Milestone Verified ──► status: verified
      │                fund_release_tx recorded
      ▼
Funds Released to Campaign Owner
```

## Permissions

| Endpoint | Required |
|----------|----------|
| `POST /campaigns/:id/milestones` | admin |
| `GET /campaigns/:id/milestones` | any authenticated key |
| `POST /campaigns/admin/:id/milestones/:milestoneId/verify` | admin |
| `GET /campaigns/:id/progress` | any authenticated key |
