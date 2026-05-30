# Crowdfunding — All-or-Nothing Mode

Campaigns can optionally use an **all-or-nothing** funding model where donations are held in escrow and only released to the recipient if the goal is reached by the deadline. If the goal is not met, every donor is fully refunded.

## Funding Models

| `funding_model` | Behaviour |
|---|---|
| `keep-what-you-raise` (default) | Donations go directly to the recipient regardless of goal progress |
| `all-or-nothing` | Donations are held in escrow; released on goal completion, refunded on failure |

## API Endpoints

### Create an all-or-nothing campaign

```http
POST /campaigns
Authorization: X-API-Key <admin-key>
Content-Type: application/json

{
  "name": "Build a School",
  "goal_amount": 5000,
  "end_date": "2026-06-01T00:00:00Z",
  "funding_model": "all-or-nothing"
}
```

### Pledge a donation (held in escrow)

```http
POST /campaigns/:id/pledge
Authorization: X-API-Key <key>
Content-Type: application/json

{
  "donor_id": 42,
  "amount": 250
}
```

Response:
```json
{
  "success": true,
  "data": {
    "pledgeId": 7,
    "campaignId": 3,
    "donorId": 42,
    "amount": 250,
    "status": "held"
  }
}
```

### Inspect escrow state

```http
GET /campaigns/:id/escrow
Authorization: X-API-Key <key>
```

Response:
```json
{
  "success": true,
  "data": {
    "campaign": { "id": 3, "goal_amount": 5000, "current_amount": 3200, ... },
    "pledges": [
      { "id": 1, "donor_id": 42, "amount": 250, "status": "held" },
      ...
    ],
    "totalHeld": 3200,
    "goalMet": false
  }
}
```

### Settle a campaign (admin only)

Settle is idempotent — calling it multiple times is safe.

```http
POST /campaigns/:id/settle
Authorization: X-API-Key <admin-key>
```

Response when goal met:
```json
{ "success": true, "data": { "outcome": "released", "totalAmount": 5200, "count": 18 } }
```

Response when goal not met:
```json
{ "success": true, "data": { "outcome": "refunded", "totalAmount": 3200, "count": 12 } }
```

## Lifecycle

```
Campaign created (funding_model: all-or-nothing)
        │
        ▼
Donors pledge → funds held in escrow (status: held)
        │
        ▼
Deadline passes or admin triggers settle
        │
   ┌────┴────┐
   │         │
goal met   goal not met
   │         │
   ▼         ▼
released   refunded
(funds →   (funds →
recipient) donors)
```

## Database Schema

### `campaigns` table (new column)

```sql
ALTER TABLE campaigns ADD COLUMN funding_model TEXT NOT NULL DEFAULT 'keep-what-you-raise';
```

### `escrow_pledges` table

```sql
CREATE TABLE escrow_pledges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  donor_id    INTEGER NOT NULL REFERENCES users(id),
  amount      REAL    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'held',  -- held | released | refunded
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Run the migration:

```bash
node src/scripts/migrations/addCrowdfunding.js
```

## Security Assumptions

- **Escrow key management**: In this implementation escrow is tracked in the database. In a production deployment with real Stellar transactions, the escrow wallet's secret key must be stored in a KMS (e.g. AWS Secrets Manager) and never logged. The `EscrowContract` in `src/contracts/EscrowContract.js` provides the on-chain simulation.
- **Refund atomicity**: The `settle()` function updates all pledge rows and the campaign row in two sequential SQL statements. For strict atomicity wrap them in a SQLite `BEGIN`/`COMMIT` transaction if the database layer supports it.
- **No user input in pledge status**: The `status` field is set exclusively by the service layer, never from request bodies.
- **Idempotency**: `settle()` is idempotent — repeated calls on an already-settled campaign return the existing result without side effects.

## Running Tests

```bash
npm test tests/crowdfunding.test.js
```
